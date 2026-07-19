import { Resend } from "resend";
import { DateTime } from "luxon";
import { supabaseAdmin } from "./db";
import { datiRistorante } from "./ristorante";
import { CLIENT } from "../config/client";
import { TESTI_WIDGET, SERVIZI_WIDGET, type LinguaWidget } from "./reservationI18n";

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const RESEND_FROM = import.meta.env.RESEND_FROM;
const KITCHEN_EMAIL = import.meta.env.KITCHEN_EMAIL;
const SLACK_WEBHOOK_URL = import.meta.env.SLACK_WEBHOOK_URL;
const BCC = "enquiries@moodd.online";

// URL pubblico del sito (per il logo nell'email cliente).
const SITE_URL = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
const LOGO_URL = `${SITE_URL.replace(/\/$/, "")}/icon-512.png`;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/**
 * Email cucina: prima da app_config (modificabile dall'admin),
 * fallback sulla variabile d'ambiente KITCHEN_EMAIL.
 */
async function kitchenEmail(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "kitchen_email")
      .maybeSingle();
    const v = data?.value?.trim();
    if (v) return v;
  } catch {
    // DB non raggiungibile: si usa il fallback env.
  }
  return KITCHEN_EMAIL ?? "";
}

/** Dati di un ordine confermato, per comporre le notifiche. */
export interface OrdineNotifica {
  numero: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  pickup_time: string; // ISO
  items: { name: string; qty: number; price_cents: number; notes?: string }[];
  total_cents: number;
  lang?: "fr" | "en";
}

function euro(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Testi dell'email di conferma al cliente, nelle due lingue.
const TXT = {
  fr: {
    subject: (num: string, ora: string) => `Commande #${num} confirmée — retrait à ${ora}`,
    title: "Commande confirmée",
    intro: (name: string, num: string) => `Merci ${name} !<br>Votre commande #${num} est confirmée.`,
    pickup: "Retrait prévu à",
    note: "Note",
    total: "Total",
    callBtn: "Nous contacter",
  },
  en: {
    subject: (num: string, ora: string) => `Order #${num} confirmed — pickup at ${ora}`,
    title: "Order confirmed",
    intro: (name: string, num: string) => `Thank you ${name}!<br>Your order #${num} is confirmed.`,
    pickup: "Pickup at",
    note: "Note",
    total: "Total",
    callBtn: "Contact us",
  },
} as const;

/** Ora di ritiro formattata in HH:mm (Europe/Brussels). */
function oraRitiro(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

/**
 * Separa le voci vere (piatti, qty > 0) dalla nota cliente (voce speciale
 * con qty 0, salvata da checkout.ts come { id:"note", name:"NOTE CLIENT", notes }).
 */
function separaItems(o: OrdineNotifica) {
  const piatti = o.items.filter((i) => i.qty > 0);
  const noteVoce = o.items.find((i) => i.qty === 0 && i.notes);
  const noteCliente = noteVoce?.notes ?? "";
  return { piatti, noteCliente };
}

/**
 * Invia tutte le notifiche per un ordine confermato.
 * Non lancia mai eccezioni verso l'esterno: non fa mai fallire il webhook.
 */
export async function inviaNotifiche(o: OrdineNotifica): Promise<void> {
  await Promise.allSettled([
    emailCliente(o),
    emailCucina(o),
    slackCucina(o),
    emailReview(o),
  ]);
}

/** Email di conferma al cliente (design dark brand). */
async function emailCliente(o: OrdineNotifica): Promise<void> {
  if (!resend || !RESEND_FROM) {
    console.warn("Resend non configurato: salto email cliente");
    return;
  }
  const t = TXT[o.lang === "en" ? "en" : "fr"];
  const { piatti, noteCliente } = separaItems(o);
  const ora = oraRitiro(o.pickup_time);
  const dati = await datiRistorante();

  const righeHtml = piatti
    .map(
      (i) => `
      <tr>
        <td style="padding:14px 24px;border-bottom:1px solid #3a3335;color:#ffffff;font-size:15px;font-family:Arial,Helvetica,sans-serif;">${i.qty}× ${esc(i.name)}</td>
        <td style="padding:14px 24px;border-bottom:1px solid #3a3335;color:#ffffff;font-size:15px;text-align:right;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;">${euro(i.price_cents * i.qty)}</td>
      </tr>`
    )
    .join("");

  const noteHtml = noteCliente
    ? `<tr><td colspan="2" style="padding:14px 24px;border-bottom:1px solid #3a3335;color:#b3aca6;font-size:13px;font-family:Arial,Helvetica,sans-serif;"><strong style="color:#fff;">${t.note} :</strong> ${esc(noteCliente)}</td></tr>`
    : "";

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#1c1819; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#231f20;border:1px solid #3a3335;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(dati.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#dfab4e;font-size:11px;letter-spacing:4px;font-family:Georgia,'Times New Roman',serif;">${esc((dati.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Georgia,'Times New Roman',serif;">${t.title}</h1>
          <p style="margin:16px 0 0;color:#b3aca6;font-size:15px;line-height:1.6;">${t.intro(esc(o.customer_name), esc(o.numero))}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 40px 8px;text-align:center;">
          <p style="margin:0;color:#b3aca6;font-size:12px;letter-spacing:2px;text-transform:uppercase;">${t.pickup}</p>
          <p style="margin:6px 0 0;color:#dfab4e;font-size:42px;line-height:1;font-family:Georgia,'Times New Roman',serif;">${ora}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #3a3335;">
            ${righeHtml}
            ${noteHtml}
            <tr>
              <td style="padding:16px 24px;color:#ffffff;font-size:17px;font-family:Georgia,'Times New Roman',serif;">${t.total}</td>
              <td style="padding:16px 24px;color:#dfab4e;font-size:19px;text-align:right;font-family:Georgia,'Times New Roman',serif;">${euro(o.total_cents)}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 4px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 24px;background:linear-gradient(90deg,#007153 0%,#007153 33%,#ffffff 33%,#ffffff 66%,#ed1c24 66%,#ed1c24 100%);"></div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 36px;text-align:center;">
          <a href="tel:${dati.telLink}" style="display:inline-block;background:#dfab4e;color:#231f20;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${t.callBtn}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #3a3335;text-align:center;">
          <p style="margin:0;color:#8f8781;font-size:12px;line-height:1.8;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
        </td>
      </tr>
    </table>
  </div>
  `;

  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: o.customer_email,
      subject: t.subject(o.numero, ora),
      html,
    });
  } catch (e) {
    console.error("Errore email cliente:", e);
  }
}

/** Email di notifica alla cucina (design chiaro operativo). */
async function emailCucina(o: OrdineNotifica): Promise<void> {
  const dest = await kitchenEmail();
  if (!resend || !RESEND_FROM || !dest) {
    console.warn("Resend/email cucina non configurati: salto email cucina");
    return;
  }
  const { piatti, noteCliente } = separaItems(o);
  const ora = oraRitiro(o.pickup_time);

  // Una riga piatto + (se presente nel name) il supplemento evidenziato.
  // Il supplemento è già dentro name tra parentesi: lo estraggo per mostrarlo sotto.
  const righeHtml = piatti
    .map((i) => {
      const match = i.name.match(/^(.*?)\s*\((.+)\)\s*$/);
      const nomeBase = match ? match[1] : i.name;
      const suppl = match ? match[2] : "";
      const supplRow = suppl
        ? `<tr><td colspan="2" style="padding:0 0 10px;color:#a3320f;font-size:15px;font-weight:bold;">↳ ${esc(suppl)}</td></tr>`
        : "";
      return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #e4e2dc;color:#000;font-size:20px;font-weight:bold;">${i.qty}×&nbsp;&nbsp;${esc(nomeBase)}</td>
        <td style="padding:14px 0;border-bottom:1px solid #e4e2dc;color:#000;font-size:16px;text-align:right;white-space:nowrap;">${euro(i.price_cents * i.qty)}</td>
      </tr>${supplRow}`;
    })
    .join("");

  const noteHtml = noteCliente
    ? `<tr><td style="padding:8px 32px 0;"><table role="presentation" width="100%" style="background:#fff4e0;border-left:4px solid #d8851b;"><tr><td style="padding:14px 18px;color:#7a4a09;font-size:15px;"><strong>Note client :</strong> ${esc(noteCliente)}</td></tr></table></td></tr>`
    : "";

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#e8e6e1; padding:30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;">
      <tr>
        <td style="padding:24px 32px;background:#231f20;">
          <table role="presentation" width="100%"><tr>
            <td style="color:#dfab4e;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Nouvelle commande</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;">#${esc(o.numero)}</td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 22px;text-align:center;background:#f6f5f2;border-bottom:2px solid #231f20;">
          <p style="margin:0;color:#777;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Retrait à</p>
          <p style="margin:6px 0 0;color:#000;font-size:52px;font-weight:bold;line-height:1;">${ora}</p>
          <p style="margin:18px 0 4px;color:#000;font-size:20px;font-weight:bold;">${esc(o.customer_name)}</p>
          <p style="margin:0;color:#555;font-size:14px;line-height:1.7;">
            ${esc(o.customer_phone ?? "—")} · ${esc(o.customer_email)}<br>
            <span style="color:#1d7a4d;font-weight:bold;">Payé ✓</span>
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${righeHtml}
          </table>
        </td>
      </tr>
      ${noteHtml}
      <tr>
        <td style="padding:20px 32px 28px;">
          <table role="presentation" width="100%"><tr>
            <td style="color:#000;font-size:22px;font-weight:bold;">TOTAL</td>
            <td style="color:#000;font-size:22px;font-weight:bold;text-align:right;">${euro(o.total_cents)}</td>
          </tr></table>
        </td>
      </tr>
    </table>
  </div>
  `;

  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: dest.split(",").map((e) => e.trim()).filter(Boolean),
      bcc: BCC,
      subject: `Nouvelle commande #${o.numero} — retrait ${ora}`,
      html,
    });
  } catch (e) {
    console.error("Errore email cucina:", e);
  }
}

/** Notifica Slack alla cucina, messaggio strutturato con tutti i dettagli. */
async function slackCucina(o: OrdineNotifica): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn("SLACK_WEBHOOK_URL non configurato: salto Slack");
    return;
  }
  const { piatti, noteCliente } = separaItems(o);
  try {
    const righe = piatti.map((i) => `• ${i.qty}× ${i.name}`).join("\n");
    const notaRiga = noteCliente ? `\n*Note client:* ${noteCliente}` : "";

    const testo =
      `🍕 *Nouvelle commande #${o.numero}*\n\n` +
      `*Client:* ${o.customer_name}\n` +
      `*Téléphone:* ${o.customer_phone ?? "—"}\n` +
      `*Email:* ${o.customer_email}\n` +
      `*Retrait:* ${oraRitiro(o.pickup_time)}\n` +
      `*Paiement:* Payé ✅\n\n` +
      `*Commande:*\n${righe}${notaRiga}\n\n` +
      `*Total:* ${euro(o.total_cents)}`;

    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: testo }),
    });
  } catch (e) {
    console.error("Errore Slack:", e);
  }
}

// Testi dell'email di richiesta recensione, nelle due lingue.
const TXT_REVIEW = {
  fr: {
    subject: (name: string) => `${name}, votre avis compte pour nous ⭐`,
    title: "Votre avis compte",
    intro: (name: string) =>
      `Merci ${name} pour votre commande d'hier !<br>` +
      `Nous espérons que vous vous êtes régalé.<br>` +
      `Un petit avis de votre part nous aide énormément&nbsp;— cela ne prend qu'une minute.`,
    btn: "Laisser un avis Google",
    sign: CLIENT.firma.fr,
  },
  en: {
    subject: (name: string) => `${name}, your feedback means a lot ⭐`,
    title: "Your opinion matters",
    intro: (name: string) =>
      `Thank you ${name} for your order yesterday!<br>` +
      `We hope you enjoyed it.<br>` +
      `A quick review helps us enormously&nbsp;— it only takes a minute.`,
    btn: "Leave a Google review",
    sign: CLIENT.firma.en,
  },
} as const;

/**
 * Email di richiesta recensione Google, PROGRAMMATA su Resend
 * (scheduledAt) per le 11:30 del giorno dopo l'ordine, ora di Bruxelles.
 * Parte solo se il link Google Review è impostato nell'admin
 * (Réglages → Liens). Nessun cron: la consegna è gestita da Resend.
 */
async function emailReview(o: OrdineNotifica): Promise<void> {
  if (!resend || !RESEND_FROM) return;
  const dati = await datiRistorante();

  // Link recensione dall'admin: senza link, niente email.
  let reviewUrl = "";
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "link_google_review")
      .maybeSingle();
    reviewUrl = String(data?.value ?? "").trim();
  } catch {
    return;
  }
  if (!reviewUrl) return;

  const t = TXT_REVIEW[o.lang === "en" ? "en" : "fr"];
  const nome = esc(o.customer_name.split(" ")[0] || o.customer_name);

  // 11:30 del giorno dopo l'ordine, ora di Bruxelles.
  const quando = DateTime.fromISO(o.pickup_time)
    .setZone("Europe/Brussels")
    .plus({ days: 1 })
    .set({ hour: 11, minute: 30, second: 0, millisecond: 0 });

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#1c1819; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#231f20;border:1px solid #3a3335;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(dati.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#dfab4e;font-size:11px;letter-spacing:4px;font-family:Georgia,'Times New Roman',serif;">${esc((dati.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Georgia,'Times New Roman',serif;">${t.title}</h1>
          <p style="margin:18px 0 0;color:#b3aca6;font-size:15px;line-height:1.7;">${t.intro(nome)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 40px 6px;text-align:center;">
          <p style="margin:0;color:#dfab4e;font-size:26px;letter-spacing:6px;">★★★★★</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 40px 8px;text-align:center;">
          <a href="${reviewUrl}" style="display:inline-block;background:#dfab4e;color:#231f20;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${t.btn}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 40px 8px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 20px;background:linear-gradient(90deg,#007153 0%,#007153 33%,#ffffff 33%,#ffffff 66%,#ed1c24 66%,#ed1c24 100%);"></div>
          <p style="margin:0 0 26px;color:#8f8781;font-size:13px;line-height:1.7;">${t.sign}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #3a3335;text-align:center;">
          <p style="margin:0;color:#8f8781;font-size:12px;line-height:1.8;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
        </td>
      </tr>
    </table>
  </div>
  `;

  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: o.customer_email,
      subject: t.subject(nome),
      html,
      scheduledAt: quando.toISO() ?? undefined,
    });
  } catch (e) {
    console.error("Errore programmazione email recensione:", e);
  }
}

// Testi dell'email recensione dopo una PRENOTAZIONE (visita al ristorante).
const TXT_REVIEW_RESA = {
  fr: {
    subject: (name: string) => `${name}, votre avis compte pour nous ⭐`,
    title: "Votre avis compte",
    intro: (name: string) =>
      `Merci ${name} pour votre visite d'hier !<br>` +
      `Nous espérons que vous avez passé un bon moment.<br>` +
      `Un petit avis de votre part nous aide énormément&nbsp;— cela ne prend qu'une minute.`,
    btn: "Laisser un avis Google",
    sign: CLIENT.firma.fr,
  },
  en: {
    subject: (name: string) => `${name}, your feedback means a lot ⭐`,
    title: "Your opinion matters",
    intro: (name: string) =>
      `Thank you ${name} for visiting us yesterday!<br>` +
      `We hope you had a great time.<br>` +
      `A quick review helps us enormously&nbsp;— it only takes a minute.`,
    btn: "Leave a Google review",
    sign: CLIENT.firma.en,
  },
} as const;

/** Dati minimi di una prenotazione per l'email recensione. */
export interface ResaReview {
  date: string; // YYYY-MM-DD della prenotazione
  first_name: string;
  last_name: string;
  email: string;
  lang: string;
}

/**
 * Email recensione Google per una PRENOTAZIONE, programmata su Resend
 * per le 11:30 del giorno DOPO la data della prenotazione (Bruxelles).
 * Ritorna l'id Resend (per poterla annullare su cancellation/no-show),
 * o null se non è partita (niente email, niente link, orario passato).
 */
export async function emailReviewResa(r: ResaReview): Promise<string | null> {
  if (!resend || !RESEND_FROM) return null;
  const email = r.email.trim();
  if (!email) return null;
  const dati = await datiRistorante();

  let reviewUrl = "";
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "link_google_review")
      .maybeSingle();
    reviewUrl = String(data?.value ?? "").trim();
  } catch {
    return null;
  }
  if (!reviewUrl) return null;

  // 11:30 del giorno dopo la prenotazione; se è già passato, niente email.
  const quando = DateTime.fromISO(r.date, { zone: "Europe/Brussels" })
    .plus({ days: 1 })
    .set({ hour: 11, minute: 30, second: 0, millisecond: 0 });
  if (quando <= DateTime.now()) return null;

  const t = TXT_REVIEW_RESA[r.lang === "en" ? "en" : "fr"];
  const nome = esc(r.first_name.trim() || r.last_name.trim() || "");

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#1c1819; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#231f20;border:1px solid #3a3335;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(dati.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#dfab4e;font-size:11px;letter-spacing:4px;font-family:Georgia,'Times New Roman',serif;">${esc((dati.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Georgia,'Times New Roman',serif;">${t.title}</h1>
          <p style="margin:18px 0 0;color:#b3aca6;font-size:15px;line-height:1.7;">${t.intro(nome)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 40px 6px;text-align:center;">
          <p style="margin:0;color:#dfab4e;font-size:26px;letter-spacing:6px;">★★★★★</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 40px 8px;text-align:center;">
          <a href="${reviewUrl}" style="display:inline-block;background:#dfab4e;color:#231f20;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${t.btn}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 40px 8px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 20px;background:linear-gradient(90deg,#007153 0%,#007153 33%,#ffffff 33%,#ffffff 66%,#ed1c24 66%,#ed1c24 100%);"></div>
          <p style="margin:0 0 26px;color:#8f8781;font-size:13px;line-height:1.7;">${t.sign}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #3a3335;text-align:center;">
          <p style="margin:0;color:#8f8781;font-size:12px;line-height:1.8;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
        </td>
      </tr>
    </table>
  </div>
  `;

  try {
    const { data } = await resend.emails.send({
      from: RESEND_FROM,
      to: email,
      subject: t.subject(nome),
      html,
      scheduledAt: quando.toISO() ?? undefined,
    });
    return data?.id ?? null;
  } catch (e) {
    console.error("Errore programmazione email recensione résa:", e);
    return null;
  }
}

/** Annulla un'email recensione programmata (annullamento / no-show). */
export async function annullaEmailReview(emailId: string): Promise<void> {
  if (!resend || !emailId) return;
  try {
    await resend.emails.cancel(emailId);
  } catch (e) {
    console.error("Errore annullamento email recensione:", e);
  }
}

// ============================================================
// EMAIL PRENOTAZIONI (widget pubblico)
//  1) conferma al cliente (lingua sua) con link Modifier / Annuler
//  2) notifica al ristorante (reservation_notify_email)
//  3) annullamento dal ristoratore → email al cliente
// ============================================================

/** Dati di una prenotazione per comporre le email. */
export interface ResaEmail {
  id: string;
  date: string; // YYYY-MM-DD
  heure: string; // "HH:MM"
  service_key: string | null;
  people: number;
  zone: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  lang: string;
  cancel_token: string;
  notes?: string | null;
  high_chair?: boolean;
  quiet?: boolean;
  business?: boolean;
  company?: string | null;
  birthday?: boolean;
  special_event?: boolean;
}

/** Codice lingua valido per il widget (fallback fr). */
function lw(lang: string): LinguaWidget {
  return (TESTI_WIDGET as Record<string, unknown>)[lang] ? (lang as LinguaWidget) : "fr";
}

const LOCALE_RESA: Record<LinguaWidget, string> = {
  fr: "fr-FR", en: "en-GB", es: "es-ES", it: "it-IT", de: "de-DE",
  ru: "ru-RU", ar: "ar", zh: "zh-CN", ja: "ja-JP",
};

/** Data leggibile (es. "vendredi 18 juillet 2026") nella lingua del cliente. */
function fmtDataResa(iso: string, lang: LinguaWidget): string {
  try {
    return new Intl.DateTimeFormat(LOCALE_RESA[lang] ?? "fr-FR", {
      timeZone: "Europe/Brussels",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso + "T12:00:00"));
  } catch {
    return iso.split("-").reverse().join("/");
  }
}

/** Etichetta del service nella lingua del cliente (o vuoto). */
function labelService(key: string | null, lang: LinguaWidget): string {
  if (!key) return "";
  return SERVIZI_WIDGET[key]?.[lang] ?? SERVIZI_WIDGET[key]?.fr ?? "";
}

// Frasi delle email prenotazione, per lingua. Le etichette (Date, Heure,
// Personnes, Section, "Annuler ma réservation") arrivano da TESTI_WIDGET.
interface TxtResa {
  confSubject: (nome: string) => string;
  confTitle: string;
  confLead: (name: string) => string;
  modifier: string;
  hint: string;
  cancSubject: (nome: string) => string;
  cancTitle: string;
  cancLead: (name: string) => string;
  cancInfo: string;
}

const TXT_RESA: Record<LinguaWidget, TxtResa> = {
  fr: {
    confSubject: (n) => `Votre réservation chez ${n} est confirmée`,
    confTitle: "Réservation confirmée",
    confLead: (name) => `Merci ${name} !<br>Votre table est réservée. Nous avons hâte de vous accueillir.`,
    modifier: "Modifier ma réservation",
    hint: "Un empêchement ? Vous pouvez modifier ou annuler votre réservation en un clic ci-dessus.",
    cancSubject: (n) => `Votre réservation chez ${n} a été annulée`,
    cancTitle: "Réservation annulée",
    cancLead: (name) => `Bonjour ${name},<br>Votre réservation a été annulée.`,
    cancInfo: "Pour toute question ou pour réserver à nouveau, n'hésitez pas à nous contacter.",
  },
  en: {
    confSubject: (n) => `Your booking at ${n} is confirmed`,
    confTitle: "Booking confirmed",
    confLead: (name) => `Thank you ${name}!<br>Your table is booked. We look forward to welcoming you.`,
    modifier: "Change my booking",
    hint: "Plans changed? You can change or cancel your booking in one click above.",
    cancSubject: (n) => `Your booking at ${n} has been cancelled`,
    cancTitle: "Booking cancelled",
    cancLead: (name) => `Hello ${name},<br>Your booking has been cancelled.`,
    cancInfo: "For any question or to book again, please don't hesitate to contact us.",
  },
  es: {
    confSubject: (n) => `Su reserva en ${n} está confirmada`,
    confTitle: "Reserva confirmada",
    confLead: (name) => `¡Gracias ${name}!<br>Su mesa está reservada. Le esperamos con gusto.`,
    modifier: "Modificar mi reserva",
    hint: "¿Un imprevisto? Puede modificar o cancelar su reserva con un clic arriba.",
    cancSubject: (n) => `Su reserva en ${n} ha sido cancelada`,
    cancTitle: "Reserva cancelada",
    cancLead: (name) => `Hola ${name},<br>Su reserva ha sido cancelada.`,
    cancInfo: "Para cualquier duda o para reservar de nuevo, no dude en contactarnos.",
  },
  it: {
    confSubject: (n) => `La tua prenotazione da ${n} è confermata`,
    confTitle: "Prenotazione confermata",
    confLead: (name) => `Grazie ${name}!<br>Il tuo tavolo è prenotato. Ti aspettiamo con piacere.`,
    modifier: "Modifica la prenotazione",
    hint: "Un imprevisto? Puoi modificare o annullare la tua prenotazione con un clic qui sopra.",
    cancSubject: (n) => `La tua prenotazione da ${n} è stata annullata`,
    cancTitle: "Prenotazione annullata",
    cancLead: (name) => `Ciao ${name},<br>La tua prenotazione è stata annullata.`,
    cancInfo: "Per qualsiasi domanda o per prenotare di nuovo, non esitare a contattarci.",
  },
  de: {
    confSubject: (n) => `Ihre Reservierung bei ${n} ist bestätigt`,
    confTitle: "Reservierung bestätigt",
    confLead: (name) => `Danke ${name}!<br>Ihr Tisch ist reserviert. Wir freuen uns auf Sie.`,
    modifier: "Reservierung ändern",
    hint: "Etwas dazwischengekommen? Sie können Ihre Reservierung oben mit einem Klick ändern oder stornieren.",
    cancSubject: (n) => `Ihre Reservierung bei ${n} wurde storniert`,
    cancTitle: "Reservierung storniert",
    cancLead: (name) => `Hallo ${name},<br>Ihre Reservierung wurde storniert.`,
    cancInfo: "Bei Fragen oder für eine neue Reservierung kontaktieren Sie uns gerne.",
  },
  ru: {
    confSubject: (n) => `Ваше бронирование в ${n} подтверждено`,
    confTitle: "Бронирование подтверждено",
    confLead: (name) => `Спасибо, ${name}!<br>Ваш столик забронирован. Будем рады вас видеть.`,
    modifier: "Изменить бронирование",
    hint: "Изменились планы? Вы можете изменить или отменить бронирование одним нажатием выше.",
    cancSubject: (n) => `Ваше бронирование в ${n} отменено`,
    cancTitle: "Бронирование отменено",
    cancLead: (name) => `Здравствуйте, ${name}!<br>Ваше бронирование отменено.`,
    cancInfo: "По любым вопросам или для нового бронирования, пожалуйста, свяжитесь с нами.",
  },
  ar: {
    confSubject: (n) => `تم تأكيد حجزك في ${n}`,
    confTitle: "تم تأكيد الحجز",
    confLead: (name) => `شكراً ${name}!<br>تم حجز طاولتك. نتطلع إلى استقبالك.`,
    modifier: "تعديل حجزي",
    hint: "طرأ ظرف ما؟ يمكنك تعديل أو إلغاء حجزك بنقرة واحدة أعلاه.",
    cancSubject: (n) => `تم إلغاء حجزك في ${n}`,
    cancTitle: "تم إلغاء الحجز",
    cancLead: (name) => `مرحباً ${name}،<br>تم إلغاء حجزك.`,
    cancInfo: "لأي سؤال أو لإجراء حجز جديد، لا تتردد في الاتصال بنا.",
  },
  zh: {
    confSubject: (n) => `您在 ${n} 的预订已确认`,
    confTitle: "预订已确认",
    confLead: (name) => `谢谢您，${name}！<br>您的餐桌已预订。期待您的光临。`,
    modifier: "修改我的预订",
    hint: "计划有变？您可以通过上方一键修改或取消您的预订。",
    cancSubject: (n) => `您在 ${n} 的预订已取消`,
    cancTitle: "预订已取消",
    cancLead: (name) => `您好 ${name}，<br>您的预订已取消。`,
    cancInfo: "如有任何疑问或需要重新预订，请随时与我们联系。",
  },
  ja: {
    confSubject: (n) => `${n} のご予約が確定しました`,
    confTitle: "ご予約確定",
    confLead: (name) => `${name} 様、ありがとうございます！<br>お席をご用意しました。お越しをお待ちしております。`,
    modifier: "予約を変更する",
    hint: "ご都合が変わりましたか？上のボタンからワンクリックで変更・キャンセルできます。",
    cancSubject: (n) => `${n} のご予約はキャンセルされました`,
    cancTitle: "ご予約キャンセル",
    cancLead: (name) => `${name} 様<br>ご予約はキャンセルされました。`,
    cancInfo: "ご不明な点や再予約については、お気軽にお問い合わせください。",
  },
};

/** Mittente delle email cliente: reservation_from_email (Réglages) o RESEND_FROM. */
async function resaFromEmail(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "reservation_from_email")
      .maybeSingle();
    const v = String(data?.value ?? "").trim();
    if (v) return v;
  } catch {
    /* fallback */
  }
  return RESEND_FROM ?? "";
}

/** Destinatario delle notifiche al ristorante (reservation_notify_email). */
async function resaNotifyEmail(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "reservation_notify_email")
      .maybeSingle();
    return String(data?.value ?? "").trim();
  } catch {
    return "";
  }
}

/** Riga di riepilogo (etichetta / valore) dell'email prenotazione. */
function rigaRecap(lab: string, val: string): string {
  if (!val) return "";
  return `<tr>
    <td style="padding:10px 24px;border-bottom:1px solid #3a3335;color:#b3aca6;font-size:13px;letter-spacing:1px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">${esc(lab)}</td>
    <td style="padding:10px 24px;border-bottom:1px solid #3a3335;color:#ffffff;font-size:16px;text-align:right;font-family:Arial,Helvetica,sans-serif;">${esc(val)}</td>
  </tr>`;
}

/** Header + recap comune (design dark brand) di tutte le email prenotazione. */
function guscioResa(opts: {
  nome: string;
  claimUpper: string;
  dir: string;
  title: string;
  lead: string;
  recapRows: string;
  ctaHtml: string;
  footerHtml: string;
  indirizzo: string;
  contatti: string;
}): string {
  return `
  <div dir="${opts.dir}" style="font-family: Arial, Helvetica, sans-serif; background:#1c1819; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#231f20;border:1px solid #3a3335;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(opts.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#dfab4e;font-size:11px;letter-spacing:4px;font-family:Georgia,'Times New Roman',serif;">${esc(opts.claimUpper)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Georgia,'Times New Roman',serif;">${esc(opts.title)}</h1>
          <p style="margin:16px 0 0;color:#b3aca6;font-size:15px;line-height:1.6;">${opts.lead}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #3a3335;">
            ${opts.recapRows}
          </table>
        </td>
      </tr>
      ${opts.ctaHtml}
      <tr>
        <td style="padding:0 40px 4px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:8px auto 24px;background:linear-gradient(90deg,#007153 0%,#007153 33%,#ffffff 33%,#ffffff 66%,#ed1c24 66%,#ed1c24 100%);"></div>
        </td>
      </tr>
      ${opts.footerHtml}
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #3a3335;text-align:center;">
          <p style="margin:0;color:#8f8781;font-size:12px;line-height:1.8;">${esc(opts.indirizzo)}<br>${esc(opts.contatti)}</p>
        </td>
      </tr>
    </table>
  </div>
  `;
}

/** URL base pubblico, senza slash finale. */
function siteBase(): string {
  return SITE_URL.replace(/\/$/, "");
}

/** Email di CONFERMA al cliente, con link Modifier / Annuler. */
async function emailConfermaResa(r: ResaEmail): Promise<void> {
  const from = await resaFromEmail();
  if (!resend || !from) {
    console.warn("Resend non configurato: salto conferma prenotazione");
    return;
  }
  const lang = lw(r.lang);
  const w = TESTI_WIDGET[lang];
  const t = TXT_RESA[lang];
  const dati = await datiRistorante();
  const nome = r.first_name.trim() || r.last_name.trim() || "";

  const heureVal = r.service_key ? `${r.heure} · ${labelService(r.service_key, lang)}` : r.heure;
  const recap =
    rigaRecap(w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(w.heure, heureVal) +
    rigaRecap(w.personnes, `${r.people} ${w.pers}`) +
    (r.zone ? rigaRecap(w.section, r.zone) : "");

  const modifyUrl = `${siteBase()}/reservation-test?token=${r.cancel_token}`;
  const cancelUrl = `${siteBase()}/reservation/cancel?token=${r.cancel_token}`;

  const ctaHtml = `
    <tr>
      <td style="padding:22px 40px 4px;text-align:center;">
        <a href="${modifyUrl}" style="display:inline-block;background:#dfab4e;color:#231f20;text-decoration:none;padding:13px 30px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:10px;margin:4px;">${esc(t.modifier)}</a>
        <a href="${cancelUrl}" style="display:inline-block;background:transparent;color:#b3aca6;text-decoration:none;padding:12px 28px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border:1px solid #3a3335;border-radius:10px;margin:4px;">${esc(w.annulerTitre)}</a>
      </td>
    </tr>`;

  const footerHtml = `
    <tr>
      <td style="padding:0 40px 30px;text-align:center;">
        <p style="margin:0;color:#8f8781;font-size:12px;line-height:1.7;">${esc(t.hint)}</p>
      </td>
    </tr>`;

  const html = guscioResa({
    nome: dati.nome,
    claimUpper: (dati.nome + " — " + CLIENT.claim).toUpperCase(),
    dir: lang === "ar" ? "rtl" : "ltr",
    title: t.confTitle,
    lead: t.confLead(esc(nome)),
    recapRows: recap,
    ctaHtml,
    footerHtml,
    indirizzo: dati.indirizzo,
    contatti: `${dati.tel} · ${dati.email}`,
  });

  try {
    await resend.emails.send({
      from,
      to: r.email,
      subject: t.confSubject(dati.nome),
      html,
    });
  } catch (e) {
    console.error("Errore email conferma prenotazione:", e);
  }
}

/** Email al CLIENTE quando la prenotazione è annullata dal ristorante. */
export async function emailAnnullataResa(r: ResaEmail): Promise<void> {
  const from = await resaFromEmail();
  if (!resend || !from || !r.email) {
    console.warn("Resend non configurato: salto email annullamento");
    return;
  }
  const lang = lw(r.lang);
  const w = TESTI_WIDGET[lang];
  const t = TXT_RESA[lang];
  const dati = await datiRistorante();
  const nome = r.first_name.trim() || r.last_name.trim() || "";

  const recap =
    rigaRecap(w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(w.heure, r.heure) +
    rigaRecap(w.personnes, `${r.people} ${w.pers}`);

  const bookUrl = `${siteBase()}/reservation-test`;
  const ctaHtml = `
    <tr>
      <td style="padding:22px 40px 4px;text-align:center;">
        <a href="${bookUrl}" style="display:inline-block;background:#dfab4e;color:#231f20;text-decoration:none;padding:13px 32px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${esc(w.reserver)}</a>
      </td>
    </tr>`;

  const footerHtml = `
    <tr>
      <td style="padding:0 40px 30px;text-align:center;">
        <p style="margin:0;color:#8f8781;font-size:12px;line-height:1.7;">${esc(t.cancInfo)}</p>
      </td>
    </tr>`;

  const html = guscioResa({
    nome: dati.nome,
    claimUpper: (dati.nome + " — " + CLIENT.claim).toUpperCase(),
    dir: lang === "ar" ? "rtl" : "ltr",
    title: t.cancTitle,
    lead: t.cancLead(esc(nome)),
    recapRows: recap,
    ctaHtml,
    footerHtml,
    indirizzo: dati.indirizzo,
    contatti: `${dati.tel} · ${dati.email}`,
  });

  try {
    await resend.emails.send({
      from,
      to: r.email,
      subject: t.cancSubject(dati.nome),
      html,
    });
  } catch (e) {
    console.error("Errore email annullamento prenotazione:", e);
  }
}

/** Email di NOTIFICA al ristorante (FR, design chiaro operativo). */
async function emailNotificaResa(r: ResaEmail): Promise<void> {
  const dest = await resaNotifyEmail();
  const from = await resaFromEmail();
  if (!resend || !from || !dest) {
    console.warn("Resend/notify prenotazioni non configurati: salto notifica ristorante");
    return;
  }
  const servFr = labelService(r.service_key, "fr");
  const dataFr = fmtDataResa(r.date, "fr");
  const nomeCompleto = `${r.first_name} ${r.last_name}`.trim();

  const opzioni: string[] = [];
  if (r.high_chair) opzioni.push("Chaise bébé");
  if (r.quiet) opzioni.push("Endroit calme");
  if (r.business) opzioni.push("Repas d'affaires" + (r.company ? ` (${r.company})` : ""));
  if (r.birthday) opzioni.push("Anniversaire");
  if (r.special_event) opzioni.push("Événement spécial");

  const extra = [
    r.zone ? `<tr><td style="padding:6px 0;color:#555;font-size:14px;">Section</td><td style="padding:6px 0;color:#000;font-size:14px;text-align:right;font-weight:bold;">${esc(r.zone)}</td></tr>` : "",
    servFr ? `<tr><td style="padding:6px 0;color:#555;font-size:14px;">Service</td><td style="padding:6px 0;color:#000;font-size:14px;text-align:right;font-weight:bold;">${esc(servFr)}</td></tr>` : "",
    opzioni.length ? `<tr><td style="padding:6px 0;color:#555;font-size:14px;">Options</td><td style="padding:6px 0;color:#000;font-size:14px;text-align:right;font-weight:bold;">${esc(opzioni.join(" · "))}</td></tr>` : "",
    r.notes ? `<tr><td colspan="2" style="padding:10px 0 0;"><div style="background:#fff4e0;border-left:4px solid #d8851b;padding:12px 16px;color:#7a4a09;font-size:14px;"><strong>Note :</strong> ${esc(r.notes)}</div></td></tr>` : "",
  ].join("");

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#e8e6e1; padding:30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;">
      <tr>
        <td style="padding:24px 32px;background:#231f20;">
          <table role="presentation" width="100%"><tr>
            <td style="color:#dfab4e;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Nouvelle réservation</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;">${esc(dataFr)}</td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 22px;text-align:center;background:#f6f5f2;border-bottom:2px solid #231f20;">
          <p style="margin:0;color:#777;font-size:13px;letter-spacing:2px;text-transform:uppercase;">${esc(r.heure)} · ${r.people} pers.${servFr ? " · " + esc(servFr) : ""}</p>
          <p style="margin:10px 0 4px;color:#000;font-size:22px;font-weight:bold;">${esc(nomeCompleto)}</p>
          <p style="margin:0;color:#555;font-size:14px;line-height:1.7;">${esc(r.phone)} · ${esc(r.email)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 32px 26px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:6px 0;color:#555;font-size:14px;">Date</td><td style="padding:6px 0;color:#000;font-size:14px;text-align:right;font-weight:bold;">${esc(dataFr)}</td></tr>
            <tr><td style="padding:6px 0;color:#555;font-size:14px;">Heure</td><td style="padding:6px 0;color:#000;font-size:14px;text-align:right;font-weight:bold;">${esc(r.heure)}</td></tr>
            <tr><td style="padding:6px 0;color:#555;font-size:14px;">Personnes</td><td style="padding:6px 0;color:#000;font-size:14px;text-align:right;font-weight:bold;">${r.people}</td></tr>
            ${extra}
          </table>
        </td>
      </tr>
    </table>
  </div>
  `;

  try {
    await resend.emails.send({
      from,
      to: dest.split(",").map((e) => e.trim()).filter(Boolean),
      bcc: BCC,
      subject: `Nouvelle réservation — ${dataFr} ${r.heure} · ${r.people} pers.`,
      html,
    });
  } catch (e) {
    console.error("Errore email notifica ristorante:", e);
  }
}

/**
 * Invia le notifiche di una nuova prenotazione dal widget: conferma al
 * cliente + notifica al ristorante. Non lancia mai eccezioni.
 */
export async function inviaNotificheResa(r: ResaEmail): Promise<void> {
  await Promise.allSettled([emailConfermaResa(r), emailNotificaResa(r)]);
}

/** Solo la conferma al cliente (usata dopo una MODIFICA della prenotazione). */
export async function inviaConfermaResa(r: ResaEmail): Promise<void> {
  await emailConfermaResa(r);
}
