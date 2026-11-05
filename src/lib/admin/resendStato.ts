/**
 * LA CASELLA RESEND — il lavoro vero (5/11/2026). Le regole stanno in
 * `resendRegole.ts`; qui le letture e le scritture.
 *
 * ⚠️ La chiave non esce MAI da qui: allo schermo va solo `re_••••xxxx` e da
 * dove viene. Si puo' sostituire, non rileggere.
 */
import { supabaseAdmin } from "../db";
import { cifra, cifraturaPronta } from "../segreti";
import {
  configResend,
  dimenticaConfigResend,
  resendCon,
  chiaveDAmbiente,
  mittenteDAmbiente,
  meseCorrente,
  contaEmail,
} from "../emailResend";
import { statoQuota } from "./newsletterQuota";
import { motivoInvio } from "../esitoEmail";
import {
  CHIAVE_RESEND,
  K_MITTENTE_EMAIL,
  K_MITTENTE_NOME,
  chiaveMascherata,
  chiaveValida,
  dominioDi,
  emailDelMittente,
  emailValida,
  livelloResend,
  nomeDelMittente,
  statoDominio,
  type FonteValore,
  type Livello,
  type StatoDominio,
} from "./resendRegole";

export interface StatoResend {
  chiave: { fonte: FonteValore; mascherata: string; rotta: boolean; inEnv: boolean; cifratura: boolean };
  mittente: { fonte: FonteValore; nome: string; email: string; dallEnv: string };
  dominio: { nome: string; stato: StatoDominio };
  conteggi: { mese: string; transazionali: number | null; newsletter: number | null };
  /** La #95 c'e'? Senza, la casella non puo' scrivere. */
  tabella: boolean;
  casella: { livello: Livello; daFare: number };
}

/** Una promessa che non aspetta piu' di `ms`: Resend lento non blocca la casella. */
function entro<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/**
 * I domini dell'account. `null` = non si e' potuto chiedere: la chiave e'
 * «sending access» (quella giusta per un cliente: puo' solo mandare), o
 * Resend non risponde. La verifica allora la fa l'e-mail di prova.
 */
async function dominiAccount(chiave: string): Promise<{ name: string; status: string }[] | null> {
  if (!chiave) return null;
  try {
    const r = await entro(resendCon(chiave).domains.list(), 5000);
    if (!r || r.error || !r.data) return null;
    const lista = (r.data as { data?: { name: string; status: string }[] }).data ?? [];
    return lista.map((d) => ({ name: String(d.name), status: String(d.status) }));
  } catch {
    return null;
  }
}

async function tabellaPresente(): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("brand_secrets").select("key", { head: true, count: "exact" });
    return !error;
  } catch {
    return false;
  }
}

async function transazionaliDelMese(mese: string): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin.from("email_counter").select("sent").eq("month", mese).maybeSingle();
    if (error) return null;
    return Number((data as { sent?: unknown } | null)?.sent ?? 0);
  } catch {
    return null;
  }
}

export async function statoResend(): Promise<StatoResend> {
  dimenticaConfigResend(); // la casella guarda il vero, non la cache
  const cfg = await configResend();
  const mese = await meseCorrente();
  const [domini, tabella, transazionali, quota] = await Promise.all([
    dominiAccount(cfg.chiave),
    tabellaPresente(),
    transazionaliDelMese(mese),
    statoQuota().then((q) => q.sent_this_month).catch(() => null),
  ]);
  const dominio = dominioDi(cfg.mittente);
  const stDominio = statoDominio(domini, dominio);
  const env = mittenteDAmbiente();
  return {
    chiave: { fonte: cfg.fonteChiave, mascherata: chiaveMascherata(cfg.chiave), rotta: cfg.rotta, inEnv: !!chiaveDAmbiente(), cifratura: cifraturaPronta() },
    mittente: {
      fonte: cfg.fonteMittente,
      nome: cfg.fonteMittente === "env" ? nomeDelMittente(cfg.mittente) : cfg.nome,
      email: emailDelMittente(cfg.mittente),
      dallEnv: env,
    },
    dominio: { nome: dominio, stato: stDominio },
    conteggi: { mese, transazionali, newsletter: quota },
    tabella,
    casella: livelloResend({ fonteChiave: cfg.fonteChiave, rotta: cfg.rotta, fonteMittente: cfg.fonteMittente, dominio: stDominio }),
  };
}

export type EsitoResend = { ok: true } | { ok: false; errore: "chiave" | "email" | "cifratura" | "tabella" | "niente" | "invio"; messaggio?: string };

async function scriviChiave(chiave: string, chi: string): Promise<EsitoResend> {
  if (!chiaveValida(chiave)) return { ok: false, errore: "chiave" };
  if (!cifraturaPronta()) return { ok: false, errore: "cifratura" };
  const { error } = await supabaseAdmin
    .from("brand_secrets")
    .upsert({ key: CHIAVE_RESEND, value: cifra(chiave.trim()), updated_at: new Date().toISOString(), updated_by: chi }, { onConflict: "key" });
  if (error) return { ok: false, errore: "tabella" };
  return { ok: true };
}

async function scriviMittente(nome: string, email: string): Promise<EsitoResend> {
  if (!emailValida(email)) return { ok: false, errore: "email" };
  const { error } = await supabaseAdmin.from("app_config").upsert(
    [
      { key: K_MITTENTE_NOME, value: nome.replace(/[<>"\r\n]/g, "").trim().slice(0, 120) },
      { key: K_MITTENTE_EMAIL, value: email.trim().slice(0, 200) },
    ],
    { onConflict: "key" },
  );
  if (error) return { ok: false, errore: "tabella" };
  return { ok: true };
}

/** Salvataggio parziale: si scrive solo quello che c'e' nel body. */
export async function salvaResend(body: { chiave?: unknown; nome?: unknown; email?: unknown }, chi: string): Promise<EsitoResend> {
  let fatto = false;
  if (body.chiave !== undefined && String(body.chiave).trim()) {
    const e = await scriviChiave(String(body.chiave), chi);
    if (!e.ok) return e;
    fatto = true;
  }
  if (body.email !== undefined) {
    const e = await scriviMittente(String(body.nome ?? ""), String(body.email));
    if (!e.ok) return e;
    fatto = true;
  }
  dimenticaConfigResend();
  return fatto ? { ok: true } : { ok: false, errore: "niente" };
}

/** «Importer depuis le .env»: copia nella casella quello che le manca. */
export async function importaDaEnv(chi: string): Promise<EsitoResend> {
  const cfg = await configResend();
  let fatto = false;
  const k = chiaveDAmbiente();
  if (k && cfg.fonteChiave !== "casella") {
    const e = await scriviChiave(k, chi);
    if (!e.ok) return e;
    fatto = true;
  }
  const m = mittenteDAmbiente();
  if (m && cfg.fonteMittente !== "casella") {
    const e = await scriviMittente(nomeDelMittente(m), emailDelMittente(m));
    if (!e.ok) return e;
    fatto = true;
  }
  dimenticaConfigResend();
  return fatto ? { ok: true } : { ok: false, errore: "niente" };
}

/** Toglie chiave e mittente dalla casella: torna a valere il `.env`. */
export async function togliResend(): Promise<EsitoResend> {
  const [a, b] = await Promise.all([
    supabaseAdmin.from("brand_secrets").delete().eq("key", CHIAVE_RESEND),
    supabaseAdmin.from("app_config").delete().in("key", [K_MITTENTE_NOME, K_MITTENTE_EMAIL]),
  ]);
  dimenticaConfigResend();
  if (a.error || b.error) return { ok: false, errore: "tabella" };
  return { ok: true };
}

/** L'e-mail di prova, al super admin che preme il bottone. */
export async function inviaProva(dest: string, nomeCliente: string): Promise<EsitoResend> {
  dimenticaConfigResend();
  const cfg = await configResend();
  if (!cfg.chiave || !cfg.mittente) return { ok: false, errore: "niente" };
  if (!emailValida(dest)) return { ok: false, errore: "email" };
  try {
    const esito = await resendCon(cfg.chiave).emails.send({
      from: cfg.mittente,
      to: dest,
      subject: `Test Resend — ${nomeCliente}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111;padding:24px">
        <p style="margin:0 0 12px"><b>${esc(nomeCliente)}</b> — e-mail de test RestoHub.</p>
        <p style="margin:0;color:#666">Expéditeur : ${esc(cfg.mittente)}</p></div>`,
    });
    const motivo = motivoInvio(esito);
    if (motivo) return { ok: false, errore: "invio", messaggio: motivo };
    contaEmail(1);
    return { ok: true };
  } catch (e) {
    return { ok: false, errore: "invio", messaggio: e instanceof Error ? e.message : String(e) };
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A che punto e' il dominio di un indirizzo mittente qualunque (la casella
 * Newsletter chiede quello della newsletter, che puo' non essere il mittente
 * di base). "ignoto" con una chiave «sending access».
 */
export async function statoDominioDi(mittente: string): Promise<{ dominio: string; stato: StatoDominio }> {
  const cfg = await configResend();
  const dominio = dominioDi(mittente);
  return { dominio, stato: statoDominio(await dominiAccount(cfg.chiave), dominio) };
}
