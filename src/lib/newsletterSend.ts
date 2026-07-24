import crypto from "node:crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "./db";
import { datiRistorante, type DatiRistorante } from "./ristorante";
import { CLIENT } from "../config/client";
import { statoQuota } from "./admin/newsletterQuota";
import { linksSocial, type LinkSocial } from "./links";

// Motore d'invio della newsletter, condiviso tra:
// - /api/admin/newsletter        (invio immediato dall'admin)
// - /api/cron/newsletter         (invii programmati e ricorrenti, #39)
// Contiene rubrica + SEGMENTI, template HTML e invio a lotti con quota.

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const RESEND_FROM = import.meta.env.RESEND_FROM;
const SITE_URL = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
const SECRET = import.meta.env.SUPABASE_SERVICE_KEY ?? "lm-newsletter";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export function resendPronto(): boolean {
  return Boolean(resend && RESEND_FROM);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Mittente della newsletter: admin → "Email expéditeur newsletter"
 *  (fallback su RESEND_FROM). Deve appartenere al dominio verificato su
 *  Resend, altrimenti l'invio viene rifiutato da Resend. */
export async function mittenteNewsletter(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "newsletter_from_email")
      .maybeSingle();
    const v = String(data?.value ?? "").trim();
    if (v) return `${CLIENT.nome} <${v}>`;
  } catch {
    // fallback
  }
  return RESEND_FROM as string;
}

/** Logo per l'email: brand_logo dei Réglages (fallback: versione negativa,
 *  poi l'icona del sito). URL salvati dall'admin nel bucket "brand". */
async function logoNewsletter(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", ["brand_logo", "brand_logo_negative"]);
    const map = new Map((data ?? []).map((r) => [r.key, String(r.value ?? "").trim()]));
    return map.get("brand_logo") || map.get("brand_logo_negative") || `${SITE_URL.replace(/\/$/, "")}/icon-512.png`;
  } catch {
    return `${SITE_URL.replace(/\/$/, "")}/icon-512.png`;
  }
}

/** Token anti-abuso del link di disiscrizione (HMAC dell'email). */
export function tokenDisiscrizione(email: string): string {
  return crypto.createHmac("sha256", SECRET).update(email.toLowerCase()).digest("hex").slice(0, 24);
}

// ---------------------------------------------------------------------------
// Rubrica + SEGMENTI
// ---------------------------------------------------------------------------

// La LINGUA è primaria: una newsletter FR va al pubblico FR (coi SUOI
// nouveaux/top50/…), una EN al pubblico EN. fr = lingua del sito fr o
// SCONOSCIUTA (default del sito); en = tutte le altre (en, nl, it, …).
export type LinguaNews = "tous" | "fr" | "en";
export const LINGUE: LinguaNews[] = ["tous", "fr", "en"];
export type GruppoNews = "tous" | "nouveaux" | "top50" | "resa" | "commande";
export const GRUPPI: GruppoNews[] = ["tous", "nouveaux", "top50", "resa", "commande"];

/** Segment salvato/trasmesso come "lingua:gruppo" (es. "fr:top50"). */
export function parseSegment(s: string): { lang: LinguaNews; group: GruppoNews } {
  const [a, b] = String(s ?? "").split(":");
  let lang: LinguaNews = (LINGUE as string[]).includes(a) ? (a as LinguaNews) : "tous";
  let group: GruppoNews = (GRUPPI as string[]).includes(b ?? "") ? (b as GruppoNews) : "tous";
  // Valori vecchi senza ":" (es. "top50")
  if (!b && a && (GRUPPI as string[]).includes(a)) {
    group = a as GruppoNews;
    lang = "tous";
  }
  return { lang, group };
}

interface Profilo {
  first: string | null; // prima attività (come il badge "New" della pagina Clients)
  spesa: number; // ordini pagati + additions delle prenotazioni (cents)
  ordini: boolean;
  rese: boolean;
  lang: string; // lingua dell'ULTIMA prenotazione (widget: fr, en, …)
  langAt: string;
}

/** Rubrica con profilo per email: ordini incassati + prenotazioni + clienti
 *  manuali, meno i nascosti e i disiscritti. */
async function rubrica(): Promise<{ profili: Map<string, Profilo>; esclusi: number }> {
  const profili = new Map<string, Profilo>();
  const nascosti = new Set<string>();
  const prendi = (e: string): Profilo => {
    let p = profili.get(e);
    if (!p) {
      p = { first: null, spesa: 0, ordini: false, rese: false, lang: "", langAt: "" };
      profili.set(e, p);
    }
    return p;
  };

  const PAGINA = 1000;
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("customer_email, total_cents, created_at")
      .in("status", ["paid", "done"])
      .range(da, da + PAGINA - 1);
    if (error) break;
    for (const r of data ?? []) {
      const e = (r.customer_email ?? "").trim().toLowerCase();
      if (!e) continue;
      const p = prendi(e);
      p.ordini = true;
      p.spesa += r.total_cents ?? 0;
      if (r.created_at && (!p.first || r.created_at < p.first)) p.first = r.created_at;
    }
    if (!data || data.length < PAGINA) break;
  }

  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("reservations")
      .select("email, lang, created_at, spent_cents, status")
      .neq("status", "cancelled")
      .range(da, da + PAGINA - 1);
    if (error) break;
    for (const r of data ?? []) {
      const e = (r.email ?? "").trim().toLowerCase();
      if (!e) continue;
      const p = prendi(e);
      p.rese = true;
      p.spesa += r.spent_cents ?? 0;
      if (r.created_at && (!p.first || r.created_at < p.first)) p.first = r.created_at;
      const l = (r.lang ?? "").trim().toLowerCase();
      if (l && (!p.langAt || (r.created_at ?? "") > p.langAt)) {
        p.lang = l;
        p.langAt = r.created_at ?? "";
      }
    }
    if (!data || data.length < PAGINA) break;
  }

  const { data: manuali } = await supabaseAdmin.from("clients").select("email, hidden, created_at");
  for (const r of manuali ?? []) {
    const e = (r.email ?? "").trim().toLowerCase();
    if (!e) continue;
    if (r.hidden) {
      nascosti.add(e);
      continue;
    }
    const p = prendi(e);
    if (r.created_at && (!p.first || r.created_at < p.first)) p.first = r.created_at;
  }
  for (const e of nascosti) profili.delete(e);

  const { data: optout } = await supabaseAdmin.from("newsletter_optout").select("email");
  let esclusi = 0; // contatti della rubrica che si sono disiscritti
  for (const r of optout ?? []) {
    if (profili.delete((r.email ?? "").toLowerCase())) esclusi++;
  }

  return { profili, esclusi };
}

function filtra(profili: Map<string, Profilo>, lang: LinguaNews, group: GruppoNews): string[] {
  let tutti = [...profili.entries()];
  // 1) LINGUA (primaria): fr = fr o sconosciuta · en = tutte le altre
  if (lang === "fr") tutti = tutti.filter(([, p]) => !p.lang || p.lang === "fr");
  else if (lang === "en") tutti = tutti.filter(([, p]) => Boolean(p.lang) && p.lang !== "fr");
  // 2) GRUPPO, dentro la lingua scelta (il top 50 è il top 50 di QUELLA lingua)
  switch (group) {
    case "nouveaux": {
      // Stesso criterio del badge "New" della pagina Clients: prima attività < 14 giorni
      const soglia = Date.now() - 14 * 86400000;
      return tutti.filter(([, p]) => p.first && Date.parse(p.first) > soglia).map(([e]) => e);
    }
    case "top50":
      return tutti
        .filter(([, p]) => p.spesa > 0)
        .sort((a, b) => b[1].spesa - a[1].spesa)
        .slice(0, 50)
        .map(([e]) => e);
    case "resa":
      return tutti.filter(([, p]) => p.rese).map(([e]) => e);
    case "commande":
      return tutti.filter(([, p]) => p.ordini).map(([e]) => e);
    default:
      return tutti.map(([e]) => e);
  }
}

export async function destinatariSegmento(lang: LinguaNews, group: GruppoNews): Promise<{ lista: string[]; esclusi: number }> {
  const { profili, esclusi } = await rubrica();
  return { lista: filtra(profili, lang, group), esclusi };
}

/** Conteggi per OGNI combinazione lingua×gruppo (pillole del modale) + opted-out. */
export async function contatoriSegmenti(): Promise<{ counts: Record<string, Record<string, number>>; esclusi: number }> {
  const { profili, esclusi } = await rubrica();
  const counts: Record<string, Record<string, number>> = {};
  for (const l of LINGUE) {
    counts[l] = {};
    for (const g of GRUPPI) counts[l][g] = filtra(profili, l, g).length;
  }
  return { counts, esclusi };
}

// ---------------------------------------------------------------------------
// Template + invio
// ---------------------------------------------------------------------------

export interface ContenutoNews {
  subject: string;
  message: string;
  image_url?: string;
  btn_label?: string;
  btn_url?: string;
  btn2_label?: string;
  btn2_url?: string;
}

export function htmlNewsletter(
  dati: DatiRistorante,
  input: ContenutoNews & { email: string; logoUrl?: string; social?: LinkSocial[] }
): string {
  const logo = input.logoUrl || `${SITE_URL.replace(/\/$/, "")}/icon-512.png`;
  const unsub = `${SITE_URL.replace(/\/$/, "")}/api/newsletter-unsubscribe?e=${encodeURIComponent(input.email)}&t=${tokenDisiscrizione(input.email)}`;
  const img = input.image_url
    ? `<tr><td><img src="${esc(input.image_url)}" alt="" width="600" style="display:block;width:100%;max-height:280px;object-fit:cover;border:0;" /></td></tr>`
    : "";
  const btn = input.btn_label && input.btn_url
    ? `<tr><td style="padding:6px 40px 10px;text-align:center;">
        <a href="${esc(input.btn_url)}" style="display:inline-block;background:#dfab4e;color:#231f20;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${esc(input.btn_label)}</a>
      </td></tr>`
    : "";
  // Secondo bottone (facoltativo): stile "ghost" oro, sotto il primo
  const btn2 = input.btn2_label && input.btn2_url
    ? `<tr><td style="padding:0 40px 10px;text-align:center;">
        <a href="${esc(input.btn2_url)}" style="display:inline-block;background:transparent;color:#dfab4e;border:1px solid #dfab4e;text-decoration:none;padding:13px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${esc(input.btn2_label)}</a>
      </td></tr>`
    : "";

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
</head>
<body bgcolor="#1c1819" style="margin:0;padding:0;background:#1c1819;">
  <div style="font-family: Arial, Helvetica, sans-serif; background:#1c1819; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#231f20;border:1px solid #3a3335;">
      <tr>
        <td style="padding:36px 40px 18px;text-align:center;">
          <img src="${logo}" alt="${esc(dati.nome)}" height="64" style="display:inline-block;border:0;height:64px;width:auto;max-width:220px;" />
          <p style="margin:16px 0 0;color:#dfab4e;font-size:11px;letter-spacing:4px;font-family:Georgia,'Times New Roman',serif;">${esc((dati.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      ${img}
      <tr>
        <td style="padding:24px 40px 0;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:28px;letter-spacing:1px;font-weight:normal;font-family:Georgia,'Times New Roman',serif;">${esc(input.subject)}</h1>
          <p style="margin:16px 0 22px;color:#b3aca6;font-size:15px;line-height:1.7;white-space:pre-line;text-align:left;">${esc(input.message)}</p>
        </td>
      </tr>
      ${btn}
      ${btn2}
      <tr>
        <td style="padding:16px 40px 8px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 20px;background:linear-gradient(90deg,#007153 0%,#007153 33%,#ffffff 33%,#ffffff 66%,#ed1c24 66%,#ed1c24 100%);"></div>
        </td>
      </tr>
      ${(input.social ?? []).length ? `<tr>
        <td style="padding:0 40px 18px;text-align:center;">
          ${(input.social ?? []).map((so) => `<a href="${esc(so.url)}" style="display:inline-block;margin:0 8px;"><img src="${SITE_URL.replace(/\/$/, "")}/email/${so.k}.png" alt="${esc(so.label)}" width="26" height="26" style="border:0;display:inline-block;" /></a>`).join("")}
        </td>
      </tr>` : ""}
      <tr>
        <td style="padding:0 40px 28px;border-top:1px solid #3a3335;">
          <p style="margin:20px 0 0;color:#8f8781;font-size:12px;line-height:1.8;text-align:center;">
            ${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}<br>
            Vous recevez cet email car vous êtes client de ${esc(dati.nome)}.
            <a href="${unsub}" style="color:#b3aca6;">Se désinscrire</a>
          </p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}

/** Un solo invio di test all'email dello staff. */
export async function inviaTest(dest: string, contenuto: ContenutoNews): Promise<boolean> {
  if (!resend || !RESEND_FROM) return false;
  const dati = await datiRistorante();
  const [logoUrl, social] = await Promise.all([logoNewsletter(), linksSocial()]);
  try {
    await resend.emails.send({
      from: await mittenteNewsletter(),
      to: dest,
      subject: `[TEST] ${contenuto.subject}`,
      html: htmlNewsletter(dati, { ...contenuto, email: dest, logoUrl, social }),
    });
    return true;
  } catch {
    return false;
  }
}

/** Log dell'invio: prova con i dati extra (foto/messaggio/segmento per le
 *  card "Derniers envois"); se le colonne non esistono ancora, log basico. */
async function logInvio(riga: { subject: string; count: number; image_url?: string | null; message?: string | null; segment?: string | null; btn_label?: string | null; btn_url?: string | null; btn2_label?: string | null; btn2_url?: string | null }) {
  const { error } = await supabaseAdmin.from("newsletter_log").insert(riga);
  if (error) {
    await supabaseAdmin.from("newsletter_log").insert({ subject: riga.subject, count: riga.count });
  }
}

export type EsitoInvio = { ok: true; sent: number } | { ok: false; error: string; status: number };

/** Invio reale al SEGMENTO scelto, nel limite della quota (incluse + crediti).
 *  Batch Resend da 100 con pausa; il log registra sempre quanto è partito. */
export async function inviaNewsletter(contenuto: ContenutoNews, lang: LinguaNews, group: GruppoNews): Promise<EsitoInvio> {
  if (!resend || !RESEND_FROM) {
    return { ok: false, error: "Resend non configuré (RESEND_API_KEY / RESEND_FROM)", status: 500 };
  }
  const dati = await datiRistorante();
  const quota = await statoQuota();
  const [logoUrl, social] = await Promise.all([logoNewsletter(), linksSocial()]);
  const { lista: dest } = await destinatariSegmento(lang, group);

  if (dest.length === 0) return { ok: false, error: "Aucun destinataire dans ce groupe", status: 400 };
  if (dest.length > quota.total_remaining) {
    return {
      ok: false,
      error: `Quota insuffisant : ${dest.length} destinataires, ${quota.total_remaining} envois disponibles (${quota.free_remaining} inclus ce mois-ci + ${quota.purchased_balance} crédits). Achetez des crédits pour continuer.`,
      status: 409,
    };
  }

  let inviateOra = 0;
  try {
    for (let i = 0; i < dest.length; i += 100) {
      const mittente = await mittenteNewsletter();
      const lotto = dest.slice(i, i + 100).map((email) => ({
        from: mittente,
        to: email,
        subject: contenuto.subject,
        html: htmlNewsletter(dati, { ...contenuto, email, logoUrl, social }),
      }));
      const { error } = await resend.batch.send(lotto);
      if (error) throw error;
      inviateOra += lotto.length;
      if (i + 100 < dest.length) await new Promise((r) => setTimeout(r, 700));
    }
  } catch (e) {
    console.error("[newsletter] envoi interrompu:", e);
    // Registra comunque quanto è partito, per non sforare la quota
    if (inviateOra > 0) {
      await logInvio({ subject: contenuto.subject, count: inviateOra, image_url: contenuto.image_url || null, message: contenuto.message || null, segment: `${lang}:${group}`, btn_label: contenuto.btn_label || null, btn_url: contenuto.btn_url || null, btn2_label: contenuto.btn2_label || null, btn2_url: contenuto.btn2_url || null });
    }
    return { ok: false, error: `Envoi interrompu après ${inviateOra} emails. Réessayez plus tard.`, status: 502 };
  }

  await logInvio({ subject: contenuto.subject, count: inviateOra, image_url: contenuto.image_url || null, message: contenuto.message || null, segment: `${lang}:${group}`, btn_label: contenuto.btn_label || null, btn_url: contenuto.btn_url || null, btn2_label: contenuto.btn2_label || null, btn2_url: contenuto.btn2_url || null });
  return { ok: true, sent: inviateOra };
}
