/**
 * LA CASELLA STRIPE — il lavoro vero (5/11/2026). Le regole stanno in
 * `stripeRegole.ts`; qui le letture, le scritture e le chiamate a Stripe.
 *
 * ⚠️ Nessun segreto esce da qui: allo schermo vanno solo `sk_live_••••xxxx`,
 * da dove viene, e quello che Stripe dice del conto.
 */
import Stripe from "stripe";
import { supabaseAdmin } from "../db";
import { cifra, cifraturaPronta, decifra } from "../segreti";
import {
  elencoSedi,
  fonteSegreto,
  leggiSegreto,
  segretoDAmbiente,
  segretoDelMarchio,
  scordaSegreti,
  contoAttivo,
  PRINCIPALE,
} from "./sede";
import { SEDE_UNICA, sede, pagamentoOnlinePronto, type Ambito, type Fonte } from "./sedeRegole";
import { sitoRaggiungibile } from "./supabaseRegole";
import {
  EVENTI_WEBHOOK,
  K_CHIAVE,
  K_FIRMA,
  chiavePubblicabile,
  chiaveStripeMascherata,
  chiaveStripeValida,
  firmaValida,
  livelloStripe,
  modoChiave,
  urlWebhook,
  webhookGiusto,
  type Livello,
  type RiepilogoLivello,
  type StatoWebhook,
} from "./stripeRegole";

function sitoPubblico(): string {
  return String(import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? "").trim();
}

function ambitoDi(livello: string): Ambito {
  return livello === "marchio" ? SEDE_UNICA : sede(livello);
}

/** Il livello esiste? «marchio» o l'id di una sede attiva. */
async function livelloValido(livello: string): Promise<boolean> {
  if (livello === "marchio") return true;
  return (await elencoSedi()).some((s) => s.id === livello);
}

/** Cosa c'e' scritto PROPRIO a questo livello (non ereditato), decifrato. */
async function proprio(livello: string, chiave: string): Promise<string | null> {
  if (livello === "marchio") return segretoDelMarchio(chiave);
  try {
    const { data } = await supabaseAdmin
      .from("location_secrets").select("value").eq("location_id", livello).eq("key", chiave).maybeSingle();
    if (!data) return null;
    return decifra(String((data as { value?: unknown }).value ?? ""));
  } catch {
    return null;
  }
}

async function riepilogo(id: string, nome: string): Promise<RiepilogoLivello> {
  const amb = ambitoDi(id);
  const [fonteChiave, fonteFirma, attivo] = await Promise.all([fonteSegreto(amb, K_CHIAVE), fonteSegreto(amb, K_FIRMA), contoAttivo(amb)]);
  // ⚠️ «Pronto» e' del conto ATTIVO: e' su quello che si incassa adesso.
  return { id, nome, fonteChiave, fonteFirma, pronto: attivo.pronto, attivo: attivo.id };
}

/** Un conto alternativo (#96), cosi' come sta nella tabella. */
interface Alternativo { id: string; nome: string; chiave: string; firma: string; rotta: boolean }

/** I conti alternativi PROPRI di un livello (non quelli ereditati), decifrati. */
async function alternativiDi(livello: string): Promise<Alternativo[]> {
  try {
    let q = supabaseAdmin.from("stripe_accounts").select("id, name, secret_key, webhook_secret")
      .order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    q = livello === "marchio" ? q.is("location_id", null) : q.eq("location_id", livello);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []).map((r) => {
      const chiave = decifra(String(r.secret_key ?? ""));
      const firma = r.webhook_secret ? decifra(String(r.webhook_secret)) : "";
      return { id: String(r.id), nome: String(r.name ?? ""), chiave, firma, rotta: !chiave || (!!r.webhook_secret && !firma) };
    });
  } catch {
    return [];
  }
}

async function contiTabellaPresente(): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("stripe_accounts").select("id", { head: true, count: "exact" });
    return !error;
  } catch {
    return false;
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

/** Quello che Stripe dice del conto di una chiave. `null` = non risponde o rifiuta. */
export interface Verifica {
  conto: { nome: string; paese: string; incassi: boolean } | null;
  errore: string; // il motivo di Stripe, se la chiave e' rifiutata
  webhook: { stato: StatoWebhook; url: string; domini: string[] };
}

function entro<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error("Stripe ne répond pas")), ms))]);
}

async function verifica(chiave: string): Promise<Verifica> {
  const sito = sitoPubblico();
  const online = sitoRaggiungibile(sito);
  const fuori: Verifica = { conto: null, errore: "", webhook: { stato: "ignoto", url: online ? urlWebhook(sito) : "", domini: [] } };
  if (!chiave) return fuori;
  const sp = new Stripe(chiave);
  const [conto, endpoints] = await Promise.allSettled([
    entro(sp.accounts.retrieve(null), 6000),
    entro(sp.webhookEndpoints.list({ limit: 100 }), 6000),
  ]);
  if (conto.status === "fulfilled") {
    const a = conto.value;
    fuori.conto = {
      nome: a.settings?.dashboard?.display_name || a.business_profile?.name || a.email || a.id,
      paese: a.country ?? "",
      incassi: !!a.charges_enabled,
    };
  } else {
    fuori.errore = conto.reason instanceof Error ? conto.reason.message : String(conto.reason);
  }
  const lista = endpoints.status === "fulfilled"
    ? endpoints.value.data.map((e) => ({ id: e.id, url: e.url, status: e.status, enabled_events: e.enabled_events }))
    : null;
  const w = webhookGiusto(lista, sito, online);
  fuori.webhook = { stato: w.stato, url: fuori.webhook.url, domini: w.domini };
  return fuori;
}

/** Un conto nella fila di pillole del livello. */
export interface VoceConto { id: string; nome: string; pronto: boolean; attivo: boolean; modo: "live" | "test" | "" }

export interface StatoLivello extends RiepilogoLivello {
  /** Il conto aperto: "principale", l'id di un alternativo, o "nuovo". */
  conto: string;
  /** I conti di questo livello: il principale e i suoi alternativi. */
  conti: VoceConto[];
  /** Il nome (solo per un alternativo). */
  nomeConto: string;
  /** Scritto PROPRIO qui: «suo», «illeggibile», o niente (eredita). */
  propriaChiave: "suo" | "rotto" | "";
  propriaFirma: "suo" | "rotto" | "";
  mascherata: string;
  modo: "live" | "test" | "";
  verifica: Verifica | null;
}

export interface StatoStripe {
  livelli: RiepilogoLivello[];
  casella: { livello: Livello; pronti: number; totale: number; daEnv: boolean };
  /** Il livello aperto nel modale, con le chiamate a Stripe. */
  scelto: StatoLivello | null;
  env: { chiave: boolean; firma: boolean };
  cifratura: boolean;
  tabella: boolean;
  /** La #96 c'e'? Senza, niente conti alternativi. */
  tabellaConti: boolean;
  sito: { online: boolean };
}

/**
 * Lo stato. `livello` = quello aperto nel modale, `conto` = il conto aperto
 * dentro il livello (si chiama Stripe solo per lui).
 */
export async function statoStripe(livello?: string, conto = PRINCIPALE): Promise<StatoStripe> {
  scordaSegreti(); // la casella guarda il vero, non la cache
  const sedi = await elencoSedi();
  const livelli = await Promise.all([riepilogo("marchio", ""), ...sedi.map((s) => riepilogo(s.id, s.name))]);
  let scelto: StatoLivello | null = null;
  if (livello && livelli.some((l) => l.id === livello)) {
    const base = livelli.find((l) => l.id === livello)!;
    const [pc, pf, alternativi] = await Promise.all([proprio(livello, K_CHIAVE), proprio(livello, K_FIRMA), alternativiDi(livello)]);
    let chiaveP = "";
    try { chiaveP = await leggiSegreto(ambitoDi(livello), K_CHIAVE); } catch { /* illeggibile: niente verifica */ }
    const conti: VoceConto[] = [
      { id: PRINCIPALE, nome: "", pronto: pagamentoOnlinePronto(base.fonteChiave, base.fonteFirma), attivo: base.attivo === PRINCIPALE, modo: modoChiave(chiaveP) },
      ...alternativi.map((a) => ({ id: a.id, nome: a.nome, pronto: !!a.chiave && !!a.firma, attivo: base.attivo === a.id, modo: modoChiave(a.chiave) })),
    ];
    const alt = alternativi.find((a) => a.id === conto);
    if (alt) {
      // Un alternativo e' tutto suo: chiave e firma stanno nella stessa riga.
      const fa: Fonte = alt.chiave ? (livello === "marchio" ? "marchio" : "sede") : "nessuna";
      const ff: Fonte = alt.firma ? fa : "nessuna";
      scelto = {
        ...base, fonteChiave: fa, fonteFirma: ff, pronto: !!alt.chiave && !!alt.firma,
        conto: alt.id, conti, nomeConto: alt.nome,
        propriaChiave: alt.chiave ? "suo" : "rotto",
        propriaFirma: alt.firma ? "suo" : alt.rotta ? "rotto" : "",
        mascherata: chiaveStripeMascherata(alt.chiave),
        modo: modoChiave(alt.chiave),
        verifica: await verifica(alt.chiave),
      };
    } else if (conto === "nuovo") {
      scelto = {
        ...base, fonteChiave: "nessuna", fonteFirma: "nessuna", pronto: false,
        conto: "nuovo", conti, nomeConto: "", propriaChiave: "", propriaFirma: "", mascherata: "", modo: "", verifica: null,
      };
    } else {
      scelto = {
        ...base,
        pronto: pagamentoOnlinePronto(base.fonteChiave, base.fonteFirma),
        conto: PRINCIPALE, conti, nomeConto: "",
        propriaChiave: pc ? "suo" : pc === "" ? "rotto" : "",
        propriaFirma: pf ? "suo" : pf === "" ? "rotto" : "",
        mascherata: chiaveStripeMascherata(chiaveP),
        modo: modoChiave(chiaveP),
        verifica: await verifica(chiaveP),
      };
    }
  }
  return {
    livelli,
    casella: livelloStripe(livelli),
    scelto,
    env: { chiave: !!segretoDAmbiente(K_CHIAVE), firma: !!segretoDAmbiente(K_FIRMA) },
    cifratura: cifraturaPronta(),
    tabella: await tabellaPresente(),
    tabellaConti: await contiTabellaPresente(),
    sito: { online: sitoRaggiungibile(sitoPubblico()) },
  };
}

export type EsitoStripe =
  | { ok: true; conto?: string }
  | { ok: false; errore: "livello" | "conto" | "nome" | "chiave" | "pubblicabile" | "firma" | "cifratura" | "tabella" | "niente" | "localhost" | "ereditata" | "stripe"; messaggio?: string };

/** Scrive un segreto PROPRIO di un livello, cifrato. Vuoto = lo toglie. */
async function scrivi(livello: string, chiave: string, valore: string, chi: string): Promise<EsitoStripe> {
  const adesso = new Date().toISOString();
  if (!valore) {
    const { error } = livello === "marchio"
      ? await supabaseAdmin.from("brand_secrets").delete().eq("key", chiave)
      : await supabaseAdmin.from("location_secrets").delete().eq("location_id", livello).eq("key", chiave);
    scordaSegreti();
    return error ? { ok: false, errore: "tabella" } : { ok: true };
  }
  // ⚠️ Mai in chiaro: senza SECRETS_KEY si rifiuta (vedi segreti.ts).
  if (!cifraturaPronta()) return { ok: false, errore: "cifratura" };
  const { error } = livello === "marchio"
    ? await supabaseAdmin.from("brand_secrets").upsert({ key: chiave, value: cifra(valore), updated_at: adesso, updated_by: chi }, { onConflict: "key" })
    : await supabaseAdmin.from("location_secrets").upsert({ location_id: livello, key: chiave, value: cifra(valore), updated_at: adesso }, { onConflict: "location_id,key" });
  // La chiave nuova deve valere SUBITO: mezzo minuto di pagamenti sul conto
  // vecchio non si recupera.
  scordaSegreti();
  return error ? { ok: false, errore: "tabella" } : { ok: true };
}

const nomeConto = (v: unknown) => String(v ?? "").replace(/[<>\r\n]/g, "").trim().slice(0, 60);

/**
 * Scrive un conto ALTERNATIVO (#96): «nuovo» lo crea, un id lo aggiorna.
 * Chiave e firma cifrate come quelle del principale; mai in chiaro.
 */
async function scriviAlternativo(
  livello: string,
  conto: string,
  campi: { nome?: string; chiave?: string; firma?: string },
  chi: string,
): Promise<EsitoStripe> {
  if ((campi.chiave || campi.firma) && !cifraturaPronta()) return { ok: false, errore: "cifratura" };
  const adesso = new Date().toISOString();
  const riga: Record<string, unknown> = { updated_at: adesso, updated_by: chi };
  if (campi.nome) riga.name = campi.nome;
  if (campi.chiave) riga.secret_key = cifra(campi.chiave);
  if (campi.firma) riga.webhook_secret = cifra(campi.firma);
  if (conto === "nuovo") {
    const { data, error } = await supabaseAdmin
      .from("stripe_accounts")
      .insert({ ...riga, location_id: livello === "marchio" ? null : livello })
      .select("id")
      .single();
    scordaSegreti();
    if (error || !data) return { ok: false, errore: "tabella" };
    return { ok: true, conto: String((data as { id: string }).id) };
  }
  if (!(await alternativiDi(livello)).some((a) => a.id === conto)) return { ok: false, errore: "conto" };
  const { error } = await supabaseAdmin.from("stripe_accounts").update(riga).eq("id", conto);
  scordaSegreti();
  return error ? { ok: false, errore: "tabella" } : { ok: true, conto };
}

/**
 * Salvataggio parziale: chiave e/o firma (e il nome, per un alternativo).
 * `conto`: "principale" (default), l'id di un alternativo, o "nuovo".
 */
export async function salvaStripe(
  livello: string,
  body: { conto?: unknown; nome?: unknown; chiave?: unknown; firma?: unknown },
  chi: string,
): Promise<EsitoStripe> {
  if (!(await livelloValido(livello))) return { ok: false, errore: "livello" };
  const conto = String(body.conto ?? PRINCIPALE);
  const k = String(body.chiave ?? "").trim();
  const w = String(body.firma ?? "").trim();
  const nome = nomeConto(body.nome);
  if (k && chiavePubblicabile(k)) return { ok: false, errore: "pubblicabile" };
  if (k && !chiaveStripeValida(k)) return { ok: false, errore: "chiave" };
  if (w && !firmaValida(w)) return { ok: false, errore: "firma" };
  if (conto === PRINCIPALE) {
    if (!k && !w) return { ok: false, errore: "niente" };
    if (k) { const e = await scrivi(livello, K_CHIAVE, k, chi); if (!e.ok) return e; }
    if (w) { const e = await scrivi(livello, K_FIRMA, w, chi); if (!e.ok) return e; }
    return { ok: true, conto };
  }
  if (conto === "nuovo") {
    if (!nome) return { ok: false, errore: "nome" };
    if (!k) return { ok: false, errore: "chiave" };
  } else if (!k && !w && !nome) {
    return { ok: false, errore: "niente" };
  }
  return scriviAlternativo(livello, conto, { nome, chiave: k, firma: w }, chi);
}

/**
 * Toglie un conto. Il principale: chiave e firma PROPRIE del livello, che
 * torna a ereditare. Un alternativo: la riga. Su Stripe non si tocca niente.
 * ⚠️ Se era il conto attivo, si torna da soli al principale (`contoAttivo`).
 */
export async function togliStripe(livello: string, conto = PRINCIPALE): Promise<EsitoStripe> {
  if (!(await livelloValido(livello))) return { ok: false, errore: "livello" };
  if (conto !== PRINCIPALE) {
    if (!(await alternativiDi(livello)).some((a) => a.id === conto)) return { ok: false, errore: "conto" };
    const { error } = await supabaseAdmin.from("stripe_accounts").delete().eq("id", conto);
    scordaSegreti();
    return error ? { ok: false, errore: "tabella" } : { ok: true, conto: PRINCIPALE };
  }
  const a = await scrivi(livello, K_CHIAVE, "", "");
  if (!a.ok) return a;
  return scrivi(livello, K_FIRMA, "", "");
}

/** «Importer depuis le .env» (solo il marchio): copia chiave e firma che mancano. */
export async function importaStripe(chi: string): Promise<EsitoStripe> {
  let fatto = false;
  for (const k of [K_CHIAVE, K_FIRMA]) {
    const env = segretoDAmbiente(k);
    if (!env || (await proprio("marchio", k))) continue;
    const e = await scrivi("marchio", k, env, chi);
    if (!e.ok) return e;
    fatto = true;
  }
  return fatto ? { ok: true } : { ok: false, errore: "niente" };
}

/**
 * «Créer le webhook»: Stripe crea l'endpoint del sito sul conto della chiave
 * aperta e rende il segreto di firma, che va subito — cifrato — ACCANTO
 * alla chiave (stesso livello per il principale, stessa riga per un
 * alternativo). Il segreto Stripe lo rende una volta sola, alla creazione:
 * un endpoint che c'e' gia' con lo stesso indirizzo si cancella e si rifà,
 * perche' il suo segreto non si potrebbe piu' leggere.
 *
 * ⚠️ Solo con la chiave scritta PROPRIO qui. Una chiave ereditata e' di un
 * altro livello: il webhook va creato la', se no la firma finisce in un
 * posto diverso dalla chiave e il pagamento online si spegne.
 */
export async function creaWebhook(livello: string, chi: string, conto = PRINCIPALE): Promise<EsitoStripe> {
  if (!(await livelloValido(livello))) return { ok: false, errore: "livello" };
  const sito = sitoPubblico();
  if (!sitoRaggiungibile(sito)) return { ok: false, errore: "localhost" };
  const alt = conto === PRINCIPALE ? null : (await alternativiDi(livello)).find((a) => a.id === conto);
  if (conto !== PRINCIPALE && !alt) return { ok: false, errore: "conto" };
  const chiave = alt ? alt.chiave : await proprio(livello, K_CHIAVE);
  if (!chiave) return { ok: false, errore: "ereditata" };
  if (!cifraturaPronta()) return { ok: false, errore: "cifratura" };
  const salvaFirma = (segreto: string) =>
    alt ? scriviAlternativo(livello, alt.id, { firma: segreto }, chi) : scrivi(livello, K_FIRMA, segreto, chi);
  const url = urlWebhook(sito);
  try {
    const sp = new Stripe(chiave);
    const vecchi = (await sp.webhookEndpoints.list({ limit: 100 })).data.filter((e) => e.url.replace(/\/+$/, "") === url);
    const nuovo = await sp.webhookEndpoints.create({
      url,
      enabled_events: EVENTI_WEBHOOK as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
      description: "RestoHub — paiements en ligne",
    });
    if (!nuovo.secret) return { ok: false, errore: "stripe", messaggio: "secret absent" };
    const e = await salvaFirma(nuovo.secret);
    if (!e.ok) {
      // Il segreto non si e' potuto salvare: si toglie l'endpoint appena
      // creato, cosi' restano quelli di prima e niente si rompe.
      await sp.webhookEndpoints.del(nuovo.id).catch(() => undefined);
      return e;
    }
    // Solo adesso, con il segreto nuovo al sicuro, si tolgono i vecchi.
    for (const v of vecchi) await sp.webhookEndpoints.del(v.id).catch(() => undefined);
    return { ok: true, conto };
  } catch (err) {
    return { ok: false, errore: "stripe", messaggio: err instanceof Error ? err.message : String(err) };
  }
}

export type { Fonte };
