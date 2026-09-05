import { Resend } from "resend";
import { DateTime } from "luxon";
import { supabaseAdmin } from "./db";
import { datiRistorante } from "./ristorante";
import { temaEmail, type TemaEmail } from "./temaBrand";
import { adminLang } from "./admin/adminLang";
import { caricaBootAdmin } from "./admin/adminBoot";
import { CLIENT } from "../config/client";
import { TESTI_WIDGET, SERVIZI_WIDGET, type LinguaWidget } from "./reservationI18n";
import { TIMEZONE } from "./slots";

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
// RESEND_FROM: si toglie l'eventuale virgolettatura stray dell'.env (es. "Nome <mail>")
// che Resend rifiuta con 422 "Invalid from field".
const RESEND_FROM = ((import.meta.env.RESEND_FROM ?? "") as string).trim().replace(/^["']|["']$/g, "") || undefined;
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

/** Mittente delle email cliente per gli ORDINI (order_from_* o fallback generali). */
async function ordineFromEmail(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", ["order_from_name", "email_from_name", "restaurant_name", "order_from_email", "public_email", "newsletter_from_email"]);
    const m = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "").trim()]));
    const nome = m.get("order_from_name") || m.get("email_from_name") || m.get("restaurant_name") || CLIENT.nome;
    const email = m.get("order_from_email") || m.get("public_email") || m.get("newsletter_from_email") || "";
    if (email) return `${nome} <${email}>`;
  } catch {
    /* fallback */
  }
  return RESEND_FROM ?? "";
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
  lang?: string;
}

function euro(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Lingue delle email cliente: FR/EN/IT/NL/ES (le "lingue pubbliche").
// Qualsiasi altra lingua ripiega su FR.
const EMAIL_LANGS = ["fr", "en", "it", "nl", "es"] as const;
function pick5<T>(dict: Record<string, T>, lang: string | null | undefined): T {
  const l = typeof lang === "string" && (EMAIL_LANGS as readonly string[]).includes(lang) ? lang : "fr";
  return dict[l] ?? dict.fr;
}
/** Firma del brand nella lingua richiesta; se il cliente non l'ha, ripiega su FR. */
function firma(lang: string): string {
  return (CLIENT.firma as Record<string, string>)[lang] ?? CLIENT.firma.fr;
}

// Testi dell'email di conferma al cliente (lingue pubbliche).
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
  it: {
    subject: (num: string, ora: string) => `Ordine #${num} confermato — ritiro alle ${ora}`,
    title: "Ordine confermato",
    intro: (name: string, num: string) => `Grazie ${name}!<br>Il tuo ordine #${num} è confermato.`,
    pickup: "Ritiro previsto alle",
    note: "Nota",
    total: "Totale",
    callBtn: "Contattaci",
  },
  nl: {
    subject: (num: string, ora: string) => `Bestelling #${num} bevestigd — afhalen om ${ora}`,
    title: "Bestelling bevestigd",
    intro: (name: string, num: string) => `Bedankt ${name}!<br>Je bestelling #${num} is bevestigd.`,
    pickup: "Afhalen om",
    note: "Opmerking",
    total: "Totaal",
    callBtn: "Contact opnemen",
  },
  es: {
    subject: (num: string, ora: string) => `Pedido #${num} confirmado — recogida a las ${ora}`,
    title: "Pedido confirmado",
    intro: (name: string, num: string) => `¡Gracias ${name}!<br>Tu pedido #${num} está confirmado.`,
    pickup: "Recogida prevista a las",
    note: "Nota",
    total: "Total",
    callBtn: "Contáctanos",
  },
} as const;

/** Ora di ritiro formattata in HH:mm (Europe/Brussels). */
function oraRitiro(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
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

export interface OrdineChanges {
  timeFrom?: string;
  timeTo?: string;
  // Righe dell'ordine (unione vecchio+nuovo): oldQty/newQty per riga permettono
  // di mostrare l'ordine iniziale con gli elementi tolti barrati e gli aggiunti.
  lines?: { name: string; oldQty: number; newQty: number; price_cents: number }[];
  totalFrom?: number;
  totalTo?: number;
}

/**
 * Notifiche dopo una MODIFICA di un ordine gia' PAGATO: conferma aggiornata al
 * cliente + ticket aggiornato in cucina (email + Slack). NIENTE email
 * recensione: quella e' programmata una volta alla creazione (11:30 del giorno
 * dopo) e richiamarla a ogni modifica creerebbe doppioni.
 */
export async function inviaModificaOrdine(
  o: OrdineNotifica,
  opts: { supplement_url?: string | null; supplement_cents?: number; refund_cents?: number; changes?: OrdineChanges | null } = {}
): Promise<void> {
  // Solo email al CLIENTE: se è il ristoratore a modificare l'ordine non serve
  // rimandargli il ticket cucina né la notifica Slack (l'ha fatto lui).
  await emailModificaCliente(o, opts);
}

// ===== Email di ANNULLAMENTO ordine al cliente =====
// refundMode: "online" (pagato online / payment link → rimborso in arrivo),
// "in_person" (pagato in cassa cash/card → rimborso al ristorante),
// "unpaid" (link non pagato → nessun addebito).
type AnnullaOpts = { refundMode: "online" | "in_person" | "unpaid"; refund_cents?: number };

const TXT_ANN = {
  fr: {
    subject: (num: string) => `Commande #${num} annulée`,
    title: "Commande annulée",
    intro: (name: string, num: string) => `Bonjour ${name},<br>votre commande <strong>#${num}</strong> a bien été annulée.`,
    refundEyebrow: "Remboursement en cours",
    refundNote: "Le montant sera recrédité sur votre moyen de paiement d'origine sous 5 à 10 jours ouvrés.",
    refundLabel: "Montant remboursé",
    orderLabel: "Commande",
    pickupLabel: "Retrait initialement prévu",
    inPersonNote: "Un éventuel remboursement se fera directement au restaurant.",
    unpaidNote: "Aucun montant n'a été prélevé.",
    question: "Une question sur cette annulation ? Nous sommes là.",
    callBtn: "Nous contacter",
  },
  en: {
    subject: (num: string) => `Order #${num} cancelled`,
    title: "Order cancelled",
    intro: (name: string, num: string) => `Hello ${name},<br>your order <strong>#${num}</strong> has been cancelled.`,
    refundEyebrow: "Refund on its way",
    refundNote: "The amount will be credited back to your original payment method within 5 to 10 business days.",
    refundLabel: "Amount refunded",
    orderLabel: "Order",
    pickupLabel: "Pickup originally planned",
    inPersonNote: "Any refund will be handled directly at the restaurant.",
    unpaidNote: "No amount was charged.",
    question: "Any question about this cancellation? We're here.",
    callBtn: "Contact us",
  },
  it: {
    subject: (num: string) => `Ordine #${num} annullato`,
    title: "Ordine annullato",
    intro: (name: string, num: string) => `Ciao ${name},<br>il tuo ordine <strong>#${num}</strong> è stato annullato.`,
    refundEyebrow: "Rimborso in arrivo",
    refundNote: "L'importo sarà riaccreditato sul tuo metodo di pagamento originale entro 5-10 giorni lavorativi.",
    refundLabel: "Importo rimborsato",
    orderLabel: "Ordine",
    pickupLabel: "Ritiro inizialmente previsto",
    inPersonNote: "Un eventuale rimborso avverrà direttamente al ristorante.",
    unpaidNote: "Nessun importo è stato addebitato.",
    question: "Hai una domanda su questo annullamento? Siamo qui.",
    callBtn: "Contattaci",
  },
  nl: {
    subject: (num: string) => `Bestelling #${num} geannuleerd`,
    title: "Bestelling geannuleerd",
    intro: (name: string, num: string) => `Hallo ${name},<br>je bestelling <strong>#${num}</strong> is geannuleerd.`,
    refundEyebrow: "Terugbetaling onderweg",
    refundNote: "Het bedrag wordt binnen 5 tot 10 werkdagen teruggestort op je oorspronkelijke betaalmethode.",
    refundLabel: "Terugbetaald bedrag",
    orderLabel: "Bestelling",
    pickupLabel: "Afhalen oorspronkelijk gepland",
    inPersonNote: "Een eventuele terugbetaling gebeurt rechtstreeks in het restaurant.",
    unpaidNote: "Er is geen bedrag afgeschreven.",
    question: "Een vraag over deze annulering? We zijn er voor je.",
    callBtn: "Contact opnemen",
  },
  es: {
    subject: (num: string) => `Pedido #${num} cancelado`,
    title: "Pedido cancelado",
    intro: (name: string, num: string) => `Hola ${name},<br>tu pedido <strong>#${num}</strong> ha sido cancelado.`,
    refundEyebrow: "Reembolso en camino",
    refundNote: "El importe se abonará en tu método de pago original en un plazo de 5 a 10 días hábiles.",
    refundLabel: "Importe reembolsado",
    orderLabel: "Pedido",
    pickupLabel: "Recogida prevista inicialmente",
    inPersonNote: "Cualquier reembolso se gestionará directamente en el restaurante.",
    unpaidNote: "No se ha cobrado ningún importe.",
    question: "¿Alguna pregunta sobre esta cancelación? Estamos aquí.",
    callBtn: "Contáctanos",
  },
} as const;

async function emailAnnullaCliente(o: OrdineNotifica, opts: AnnullaOpts): Promise<void> {
  const from = await ordineFromEmail();
  if (!resend || !from) return;
  if (!o.customer_email?.trim()) return; // ordine senza email: niente invio

  const t = pick5(TXT_ANN, o.lang);
  const dati = await datiRistorante();
  const tema = await temaEmail();

  const ora = oraRitiro(o.pickup_time);
  const giorno = new Date(o.pickup_time).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const pickupVal = `${giorno} · ${ora}`;
  const importo = euro(opts.refund_cents ?? o.total_cents);

  // Blocco condizionale in base al metodo di pagamento
  let blocco = "";
  if (opts.refundMode === "online") {
    blocco = `
      <tr>
        <td class="em-pad" style="padding:28px 44px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.tintBorder};border-radius:12px;background:${tema.tint};">
            <tr><td style="padding:20px 24px;text-align:center;">
              <p style="margin:0;color:${tema.accent};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${t.refundEyebrow}</p>
              <p class="em-big" style="margin:8px 0 0;color:${tema.title};font-size:40px;line-height:1;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${importo}</p>
              <p style="margin:12px 0 0;color:${tema.text};font-size:14px;line-height:1.6;">${t.refundNote}</p>
            </td></tr>
          </table>
        </td>
      </tr>`;
  } else {
    const nota = opts.refundMode === "in_person" ? t.inPersonNote : t.unpaidNote;
    blocco = `
      <tr>
        <td class="em-pad" style="padding:24px 44px 6px;text-align:center;">
          <p style="margin:0;color:${tema.text};font-size:15px;line-height:1.6;">${nota}</p>
        </td>
      </tr>`;
  }

  const rigaImporto =
    opts.refundMode === "online"
      ? `<tr>
          <td style="padding:16px 24px 0;color:${tema.title};font-size:16px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${t.refundLabel}</td>
          <td style="padding:16px 24px 0;color:${tema.accent};font-size:19px;text-align:right;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${importo}</td>
        </tr>`
      : "";

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td class="em-pad" style="padding:40px 44px 20px;text-align:center;">
          <img src="${(tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL}" alt="${esc(dati.nome)}" width="160" style="display:inline-block;width:160px;max-width:62%;height:auto;border:0;" />
          <p style="margin:18px 0 0;color:${tema.muted};font-size:11px;letter-spacing:4px;">${esc(dati.nome.toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:6px 44px 0;text-align:center;">
          <h1 style="margin:0;color:${tema.title};font-size:30px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">${t.title}</h1>
          <p style="margin:16px 0 0;color:${tema.text};font-size:15px;line-height:1.6;">${t.intro(esc(o.customer_name), esc(o.numero))}</p>
        </td>
      </tr>
      ${blocco}
      <tr>
        <td style="padding:20px 20px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:12px 24px;border-bottom:1px solid ${tema.border};color:${tema.text};font-size:14px;font-family:Arial,Helvetica,sans-serif;">${t.orderLabel}</td>
              <td style="padding:12px 24px;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:14px;text-align:right;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">#${esc(o.numero)}</td>
            </tr>
            <tr>
              <td style="padding:12px 24px;border-bottom:1px solid ${tema.border};color:${tema.text};font-size:14px;font-family:Arial,Helvetica,sans-serif;">${t.pickupLabel}</td>
              <td style="padding:12px 24px;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:14px;text-align:right;font-family:Arial,Helvetica,sans-serif;">${pickupVal}</td>
            </tr>
            ${rigaImporto}
          </table>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:24px 44px 38px;text-align:center;">
          <p style="margin:0 0 18px;color:${tema.muted};font-size:14px;line-height:1.6;">${t.question}</p>
          <a href="tel:${dati.telLink}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:15px 42px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${t.callBtn}</a>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:24px 44px 30px;border-top:1px solid ${tema.border};text-align:center;">
          <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.9;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} &middot; ${esc(dati.email)}</p>
          <p style="margin:16px 0 0;"><img src="${SITE_URL.replace(/\/$/, "")}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="100" style="display:inline-block;width:100px;max-width:40%;height:auto;opacity:0.7;border:0;" /></p>
        </td>
      </tr>
    </table>
  `;

  try {
    await resend.emails.send({
      from,
      to: o.customer_email,
      bcc: BCC,
      subject: t.subject(o.numero),
      html: avvolgiTema(html, tema),
    });
  } catch (e) {
    console.error("Errore email annullamento:", e);
  }
}

/** Invia l'email di annullamento ordine al cliente. */
export async function inviaAnnullaOrdine(o: OrdineNotifica, opts: AnnullaOpts): Promise<void> {
  await emailAnnullaCliente(o, opts);
}

/** Email di conferma al cliente (design dark brand). */
async function emailCliente(o: OrdineNotifica): Promise<void> {
  const from = await ordineFromEmail();
  if (!resend || !from) {
    console.warn("Resend non configurato: salto email cliente");
    return;
  }
  if (!o.customer_email?.trim()) return; // ordine pagato di persona senza email
  const t = pick5(TXT, o.lang);
  const { piatti, noteCliente } = separaItems(o);
  const ora = oraRitiro(o.pickup_time);
  const dati = await datiRistorante();
  const tema = await temaEmail();

  const righeHtml = piatti
    .map(
      (i) => `
      <tr>
        <td style="padding:14px 24px;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:15px;font-family:Arial,Helvetica,sans-serif;">${i.qty}× ${esc(i.name)}</td>
        <td style="padding:14px 24px;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:15px;text-align:right;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;">${euro(i.price_cents * i.qty)}</td>
      </tr>`
    )
    .join("");

  const noteHtml = noteCliente
    ? `<tr><td colspan="2" style="padding:14px 24px;border-bottom:1px solid ${tema.border};color:${tema.text};font-size:13px;font-family:Arial,Helvetica,sans-serif;"><strong style="color:${tema.title};">${t.note} :</strong> ${esc(noteCliente)}</td></tr>`
    : "";

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td class="em-pad" style="padding:40px 44px 20px;text-align:center;">
          <img src="${(tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL}" alt="${esc(dati.nome)}" width="160" style="display:inline-block;width:160px;max-width:62%;height:auto;border:0;" />
          <p style="margin:18px 0 0;color:${tema.muted};font-size:11px;letter-spacing:4px;">${esc(dati.nome.toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:6px 44px 0;text-align:center;">
          <h1 style="margin:0;color:${tema.title};font-size:30px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">${t.title}</h1>
          <p style="margin:16px 0 0;color:${tema.text};font-size:15px;line-height:1.6;">${t.intro(esc(o.customer_name), esc(o.numero))}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:28px 44px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.tintBorder};border-radius:12px;background:${tema.tint};">
            <tr><td style="padding:18px 24px;text-align:center;">
              <p style="margin:0;color:${tema.accent};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${t.pickup}</p>
              <p class="em-big" style="margin:6px 0 0;color:${tema.title};font-size:44px;line-height:1;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${ora}</p>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 20px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${righeHtml}
            ${noteHtml}
            <tr>
              <td style="padding:16px 24px 0;color:${tema.title};font-size:17px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${t.total}</td>
              <td style="padding:16px 24px 0;color:${tema.accent};font-size:20px;text-align:right;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${euro(o.total_cents)}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:20px 44px 38px;text-align:center;">
          <a href="tel:${dati.telLink}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:15px 42px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${t.callBtn}</a>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:24px 44px 30px;border-top:1px solid ${tema.border};text-align:center;">
          <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.9;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} &middot; ${esc(dati.email)}</p>
          <p style="margin:16px 0 0;"><img src="${SITE_URL.replace(/\/$/, "")}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="100" style="display:inline-block;width:100px;max-width:40%;height:auto;opacity:0.7;border:0;" /></p>
        </td>
      </tr>
    </table>
  `;

  try {
    await resend.emails.send({
      from,
      to: o.customer_email,
      subject: t.subject(o.numero, ora),
      bcc: BCC,
      html: avvolgiTema(html, tema),
    });
  } catch (e) {
    console.error("Errore email cliente:", e);
  }
}

// Testi dell'email di MODIFICA ordine (distinta dalla conferma). 5 lingue.
const TXT_MOD = {
  fr: {
    subject: (num: string, ora: string) => `Commande #${num} modifiee — retrait a ${ora}`,
    title: "Commande modifiee",
    intro: (name: string, num: string) => `Bonjour ${name},<br>votre commande #${num} a ete mise a jour. Voici le nouveau recapitulatif.`,
    pickup: "Retrait prevu a",
    note: "Note",
    total: "Nouveau total",
    supplTitle: "Supplement a regler",
    supplText: (eur: string) => `Suite a la modification, un supplement de <strong>${eur}</strong> reste a regler.`,
    payBtn: "Payer le supplement",
    refundText: (eur: string) => `La difference de <strong>${eur}</strong> vous sera remboursee sur votre moyen de paiement.`,
    callBtn: "Nous contacter",
    changesTitle: "Ce qui a changé",
    timeLbl: "Heure de retrait",
    wasLbl: "auparavant",
    addedLbl: "Ajouté",
    removedLbl: "Retiré",
    totalLbl: "Total",
  },
  en: {
    subject: (num: string, ora: string) => `Order #${num} updated — pickup at ${ora}`,
    title: "Order updated",
    intro: (name: string, num: string) => `Hello ${name},<br>your order #${num} has been updated. Here is the new summary.`,
    pickup: "Pickup at",
    note: "Note",
    total: "New total",
    supplTitle: "Extra to pay",
    supplText: (eur: string) => `Following the change, an extra of <strong>${eur}</strong> is still due.`,
    payBtn: "Pay the extra",
    refundText: (eur: string) => `The difference of <strong>${eur}</strong> will be refunded to your payment method.`,
    callBtn: "Contact us",
    changesTitle: "What changed",
    timeLbl: "Pickup time",
    wasLbl: "previously",
    addedLbl: "Added",
    removedLbl: "Removed",
    totalLbl: "Total",
  },
  it: {
    subject: (num: string, ora: string) => `Ordine #${num} modificato — ritiro alle ${ora}`,
    title: "Ordine modificato",
    intro: (name: string, num: string) => `Ciao ${name},<br>il tuo ordine #${num} e stato aggiornato. Ecco il nuovo riepilogo.`,
    pickup: "Ritiro previsto alle",
    note: "Nota",
    total: "Nuovo totale",
    supplTitle: "Supplemento da pagare",
    supplText: (eur: string) => `A seguito della modifica, resta un supplemento di <strong>${eur}</strong> da pagare.`,
    payBtn: "Paga il supplemento",
    refundText: (eur: string) => `La differenza di <strong>${eur}</strong> ti sara rimborsata sul tuo metodo di pagamento.`,
    callBtn: "Contattaci",
    changesTitle: "Cosa è cambiato",
    timeLbl: "Orario di ritiro",
    wasLbl: "prima",
    addedLbl: "Aggiunto",
    removedLbl: "Rimosso",
    totalLbl: "Totale",
  },
  nl: {
    subject: (num: string, ora: string) => `Bestelling #${num} gewijzigd — afhalen om ${ora}`,
    title: "Bestelling gewijzigd",
    intro: (name: string, num: string) => `Hallo ${name},<br>je bestelling #${num} is bijgewerkt. Hier is het nieuwe overzicht.`,
    pickup: "Afhalen om",
    note: "Opmerking",
    total: "Nieuw totaal",
    supplTitle: "Bij te betalen",
    supplText: (eur: string) => `Na de wijziging moet er nog <strong>${eur}</strong> worden bijbetaald.`,
    payBtn: "Supplement betalen",
    refundText: (eur: string) => `Het verschil van <strong>${eur}</strong> wordt teruggestort op je betaalmiddel.`,
    callBtn: "Contact opnemen",
    changesTitle: "Wat is er gewijzigd",
    timeLbl: "Afhaaltijd",
    wasLbl: "voorheen",
    addedLbl: "Toegevoegd",
    removedLbl: "Verwijderd",
    totalLbl: "Totaal",
  },
  es: {
    subject: (num: string, ora: string) => `Pedido #${num} modificado — recogida a las ${ora}`,
    title: "Pedido modificado",
    intro: (name: string, num: string) => `Hola ${name},<br>tu pedido #${num} se ha actualizado. Aqui tienes el nuevo resumen.`,
    pickup: "Recogida prevista a las",
    note: "Nota",
    total: "Nuevo total",
    supplTitle: "Suplemento a pagar",
    supplText: (eur: string) => `Tras la modificacion, queda un suplemento de <strong>${eur}</strong> por pagar.`,
    payBtn: "Pagar el suplemento",
    refundText: (eur: string) => `La diferencia de <strong>${eur}</strong> se te reembolsara en tu metodo de pago.`,
    callBtn: "Contactanos",
    changesTitle: "Qué ha cambiado",
    timeLbl: "Hora de recogida",
    wasLbl: "antes",
    addedLbl: "Añadido",
    removedLbl: "Eliminado",
    totalLbl: "Total",
  },
} as const;

/**
 * Email al cliente dopo una MODIFICA dell'ordine (design dark brand).
 * NON e' la conferma: titolo/testi dedicati. Se opts.supplement_* -> blocco
 * ambra con link Stripe per pagare la differenza; se opts.refund_cents ->
 * riga verde che annuncia il rimborso della differenza.
 */
async function emailModificaCliente(
  o: OrdineNotifica,
  opts: { supplement_url?: string | null; supplement_cents?: number; refund_cents?: number; changes?: OrdineChanges | null }
): Promise<void> {
  const from = await ordineFromEmail();
  if (!resend || !from) {
    console.warn("Resend non configurato: salto email modifica");
    return;
  }
  if (!o.customer_email?.trim()) return;
  const t = pick5(TXT_MOD, o.lang);
  const { piatti, noteCliente } = separaItems(o);
  const ora = oraRitiro(o.pickup_time);
  const dati = await datiRistorante();
  const tema = await temaEmail();

  // "Cosa è cambiato": ordine iniziale con elementi tolti (barrati) e aggiunti.
  const ch = opts.changes ?? null;
  const cellBase = `padding:13px 22px;border-bottom:1px solid ${tema.border};font-size:15px;font-family:Arial,Helvetica,sans-serif;`;
  const righe = ch?.lines && ch.lines.length
    ? ch.lines
    : piatti.map((p) => ({ name: p.name, oldQty: p.qty, newQty: p.qty, price_cents: p.price_cents }));
  const lineRows = righe
    .map((l) => {
      const removed = l.newQty === 0 && l.oldQty > 0;
      const added = l.oldQty === 0 && l.newQty > 0;
      const changed = !removed && !added && l.oldQty !== l.newQty;
      const dispQty = removed ? l.oldQty : l.newQty;
      const price = euro(l.price_cents * dispQty);
      if (removed) {
        return `<tr><td style="${cellBase}color:${tema.muted};text-decoration:line-through;">${l.oldQty}× ${esc(l.name)} <span style="color:#d9776f;text-decoration:none;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">&middot; ${t.removedLbl}</span></td><td style="${cellBase}color:${tema.muted};text-align:right;white-space:nowrap;text-decoration:line-through;">${price}</td></tr>`;
      }
      if (added) {
        return `<tr><td style="${cellBase}color:#3fae6a;font-weight:bold;">+ ${l.newQty}× ${esc(l.name)}</td><td style="${cellBase}color:#3fae6a;text-align:right;white-space:nowrap;font-weight:bold;">${price}</td></tr>`;
      }
      if (changed) {
        return `<tr><td style="${cellBase}color:${tema.title};"><span style="color:${tema.muted};text-decoration:line-through;">${l.oldQty}×</span> &rarr; ${l.newQty}× ${esc(l.name)}</td><td style="${cellBase}color:${tema.title};text-align:right;white-space:nowrap;">${price}</td></tr>`;
      }
      return `<tr><td style="${cellBase}color:${tema.title};">${l.newQty}× ${esc(l.name)}</td><td style="${cellBase}color:${tema.title};text-align:right;white-space:nowrap;">${price}</td></tr>`;
    })
    .join("");

  const noteHtml = noteCliente
    ? `<tr><td colspan="2" style="${cellBase}color:${tema.text};font-size:13px;"><strong style="color:${tema.title};">${t.note} :</strong> ${esc(noteCliente)}</td></tr>`
    : "";

  const totalChanged = !!(ch && typeof ch.totalFrom === "number" && typeof ch.totalTo === "number" && ch.totalFrom !== ch.totalTo);
  const totalRow = totalChanged
    ? `<tr><td style="padding:16px 22px;color:${tema.title};font-size:17px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${t.totalLbl}</td><td style="padding:16px 22px;text-align:right;white-space:nowrap;font-size:17px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;"><span style="color:${tema.muted};text-decoration:line-through;">${euro(ch!.totalFrom as number)}</span> &rarr; <span style="color:${tema.accent};">${euro(ch!.totalTo as number)}</span></td></tr>`
    : `<tr><td style="padding:16px 22px;color:${tema.title};font-size:17px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${t.total}</td><td style="padding:16px 22px;text-align:right;white-space:nowrap;color:${tema.accent};font-size:19px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${euro(o.total_cents)}</td></tr>`;

  const timeChanged = !!(ch?.timeFrom && ch?.timeTo && ch.timeFrom !== ch.timeTo);
  const wasHtml = timeChanged
    ? `<p style="margin:8px 0 0;color:${tema.muted};font-size:13px;">${t.wasLbl} <span style="text-decoration:line-through;">${esc(ch!.timeFrom as string)}</span></p>`
    : "";

  const suppCents = opts.supplement_cents ?? 0;
  const refCents = opts.refund_cents ?? 0;
  const blocco =
    suppCents > 0 && opts.supplement_url
      ? `<tr><td class="em-pad" style="padding:8px 44px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #7a4a12;background:#3a2708;border-radius:12px;overflow:hidden;"><tr><td style="padding:20px 24px;text-align:center;"><p style="margin:0 0 6px;color:#ffcf8f;font-size:12px;letter-spacing:2px;text-transform:uppercase;">${t.supplTitle}</p><p style="margin:0 0 16px;color:#ffffff;font-size:15px;line-height:1.6;">${t.supplText(euro(suppCents))}</p><a href="${opts.supplement_url}" style="display:inline-block;background:#f0a24b;color:#3a2708;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${t.payBtn}</a></td></tr></table></td></tr>`
      : refCents > 0
        ? `<tr><td class="em-pad" style="padding:10px 44px 6px;text-align:center;"><p style="margin:0;color:#8fd6b0;font-size:14px;line-height:1.6;">${t.refundText(euro(refCents))}</p></td></tr>`
        : "";

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td class="em-pad" style="padding:40px 44px 20px;text-align:center;">
          <img src="${(tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL}" alt="${esc(dati.nome)}" width="160" style="display:inline-block;width:160px;max-width:62%;height:auto;border:0;" />
          <p style="margin:18px 0 0;color:${tema.muted};font-size:11px;letter-spacing:4px;">${esc(dati.nome.toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:6px 44px 0;text-align:center;">
          <h1 style="margin:0;color:${tema.title};font-size:30px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">${t.title}</h1>
          <p style="margin:16px 0 0;color:${tema.text};font-size:15px;line-height:1.6;">${t.intro(esc(o.customer_name), esc(o.numero))}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:28px 44px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.tintBorder};border-radius:12px;background:${tema.tint};">
            <tr><td style="padding:18px 24px;text-align:center;">
              <p style="margin:0;color:${tema.accent};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${t.pickup}</p>
              <p class="em-big" style="margin:6px 0 0;color:${tema.title};font-size:44px;line-height:1;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${ora}</p>
              ${wasHtml}
            </td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:26px 44px 4px;">
          <p style="margin:0 0 10px;color:${tema.muted};font-size:11px;letter-spacing:2px;text-transform:uppercase;">${t.changesTitle}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.border};border-radius:12px;overflow:hidden;">
            ${lineRows}
            ${noteHtml}
            ${totalRow}
          </table>
        </td>
      </tr>
      ${blocco}
      <tr>
        <td class="em-pad" style="padding:22px 44px 38px;text-align:center;">
          <a href="tel:${dati.telLink}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:15px 42px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${t.callBtn}</a>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:24px 44px 30px;border-top:1px solid ${tema.border};text-align:center;">
          <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.9;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} &middot; ${esc(dati.email)}</p>
          <p style="margin:16px 0 0;"><img src="${SITE_URL.replace(/\/$/, "")}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="100" style="display:inline-block;width:100px;max-width:40%;height:auto;opacity:0.7;border:0;" /></p>
        </td>
      </tr>
    </table>
  `;

  try {
    await resend.emails.send({
      from,
      to: o.customer_email,
      subject: t.subject(o.numero, ora),
      bcc: BCC,
      html: avvolgiTema(html, tema),
    });
  } catch (e) {
    console.error("Errore email modifica:", e);
  }
}

// Testi dell'email "link di pagamento" (ordine creato dallo staff).
const TXT_PAY = {
  fr: {
    subject: (num: string) => `Votre commande #${num} — paiement en ligne`,
    title: "Finalisez votre commande",
    intro: (name: string, num: string) =>
      `Bonjour ${name},<br>voici le récapitulatif de votre commande #${num}. Cliquez sur le bouton ci-dessous pour la régler en ligne.`,
    pickup: "Retrait prévu à",
    note: "Note",
    total: "Total",
    payBtn: "Payer ma commande",
    valid: "Le lien de paiement est valable 24 heures.",
    cancelLink: "Annuler ma commande",
  },
  en: {
    subject: (num: string) => `Your order #${num} — online payment`,
    title: "Complete your order",
    intro: (name: string, num: string) =>
      `Hello ${name},<br>here is the summary of your order #${num}. Click the button below to pay online.`,
    pickup: "Pickup at",
    note: "Note",
    total: "Total",
    payBtn: "Pay my order",
    valid: "The payment link is valid for 24 hours.",
    cancelLink: "Cancel my order",
  },
  it: {
    subject: (num: string) => `Il tuo ordine #${num} — pagamento online`,
    title: "Completa il tuo ordine",
    intro: (name: string, num: string) =>
      `Ciao ${name},<br>ecco il riepilogo del tuo ordine #${num}. Clicca sul pulsante qui sotto per pagarlo online.`,
    pickup: "Ritiro previsto alle",
    note: "Nota",
    total: "Totale",
    payBtn: "Paga il mio ordine",
    valid: "Il link di pagamento è valido 24 ore.",
    cancelLink: "Annulla il mio ordine",
  },
  nl: {
    subject: (num: string) => `Je bestelling #${num} — online betalen`,
    title: "Rond je bestelling af",
    intro: (name: string, num: string) =>
      `Hallo ${name},<br>hier is het overzicht van je bestelling #${num}. Klik op de knop hieronder om online te betalen.`,
    pickup: "Afhalen om",
    note: "Opmerking",
    total: "Totaal",
    payBtn: "Mijn bestelling betalen",
    valid: "De betaallink is 24 uur geldig.",
    cancelLink: "Mijn bestelling annuleren",
  },
  es: {
    subject: (num: string) => `Tu pedido #${num} — pago en línea`,
    title: "Completa tu pedido",
    intro: (name: string, num: string) =>
      `Hola ${name},<br>aquí tienes el resumen de tu pedido #${num}. Haz clic en el botón de abajo para pagarlo en línea.`,
    pickup: "Recogida prevista a las",
    note: "Nota",
    total: "Total",
    payBtn: "Pagar mi pedido",
    valid: "El enlace de pago es válido 24 horas.",
    cancelLink: "Cancelar mi pedido",
  },
} as const;

/** Email al cliente con il LINK DI PAGAMENTO Stripe (ordine manuale staff). */
export async function emailLienPaiement(o: OrdineNotifica & { pay_url: string; cancel_url?: string | null }): Promise<void> {
  const from = await ordineFromEmail();
  if (!resend || !from) {
    console.warn("Resend non configurato: salto email link di pagamento");
    return;
  }
  const t = pick5(TXT_PAY, o.lang);
  const { piatti, noteCliente } = separaItems(o);
  const ora = oraRitiro(o.pickup_time);
  const dati = await datiRistorante();
  const tema = await temaEmail();

  const righeHtml = piatti
    .map(
      (i) => `
      <tr>
        <td style="padding:14px 24px;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:15px;font-family:Arial,Helvetica,sans-serif;">${i.qty}× ${esc(i.name)}</td>
        <td style="padding:14px 24px;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:15px;text-align:right;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;">${euro(i.price_cents * i.qty)}</td>
      </tr>`
    )
    .join("");
  const noteHtml = noteCliente
    ? `<tr><td colspan="2" style="padding:14px 24px;border-bottom:1px solid ${tema.border};color:${tema.text};font-size:13px;font-family:Arial,Helvetica,sans-serif;"><strong style="color:${tema.title};">${t.note} :</strong> ${esc(noteCliente)}</td></tr>`
    : "";

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td class="em-pad" style="padding:40px 44px 20px;text-align:center;">
          <img src="${(tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL}" alt="${esc(dati.nome)}" width="160" style="display:inline-block;width:160px;max-width:62%;height:auto;border:0;" />
          <p style="margin:18px 0 0;color:${tema.muted};font-size:11px;letter-spacing:4px;">${esc(dati.nome.toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:6px 44px 0;text-align:center;">
          <h1 style="margin:0;color:${tema.title};font-size:30px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">${t.title}</h1>
          <p style="margin:16px 0 0;color:${tema.text};font-size:15px;line-height:1.6;">${t.intro(esc(o.customer_name), esc(o.numero))}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:28px 44px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.tintBorder};border-radius:12px;background:${tema.tint};">
            <tr><td style="padding:18px 24px;text-align:center;">
              <p style="margin:0;color:${tema.accent};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${t.pickup}</p>
              <p class="em-big" style="margin:6px 0 0;color:${tema.title};font-size:44px;line-height:1;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${ora}</p>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 20px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.border};border-radius:12px;overflow:hidden;">
            ${righeHtml}
            ${noteHtml}
            <tr>
              <td style="padding:16px 24px;color:${tema.title};font-size:17px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${t.total}</td>
              <td style="padding:16px 24px;color:${tema.accent};font-size:19px;text-align:right;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${euro(o.total_cents)}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:22px 44px 6px;text-align:center;">
          <a href="${o.pay_url}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:16px 44px;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${t.payBtn}</a>
          <p style="margin:14px 0 0;color:${tema.muted};font-size:12px;">${t.valid}</p>
          ${o.cancel_url ? `<p style="margin:16px 0 0;"><a href="${o.cancel_url}" style="color:${tema.muted};font-size:12px;text-decoration:underline;text-underline-offset:2px;">${t.cancelLink}</a></p>` : ""}
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:24px 44px 30px;border-top:1px solid ${tema.border};text-align:center;">
          <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.9;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} &middot; ${esc(dati.email)}</p>
          <p style="margin:16px 0 0;"><img src="${SITE_URL.replace(/\/$/, "")}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="100" style="display:inline-block;width:100px;max-width:40%;height:auto;opacity:0.7;border:0;" /></p>
        </td>
      </tr>
    </table>
  `;

  try {
    await resend.emails.send({
      from,
      to: o.customer_email,
      subject: t.subject(o.numero),
      bcc: BCC,
      html: avvolgiTema(html, tema),
    });
  } catch (e) {
    console.error("Errore email link di pagamento:", e);
  }
}

/** Etichette del ticket ordine (al ristoratore) nella lingua dell'admin. */
const K_TXT = {
  fr: { newOrder: "Nouvelle commande", pickupAt: "Retrait à", paid: "Payé", callClient: "Appeler le client", note: "Note client", total: "TOTAL", subject: (num: string, ora: string) => `Nouvelle commande #${num} — retrait ${ora}` },
  en: { newOrder: "New order", pickupAt: "Pickup at", paid: "Paid", callClient: "Call the customer", note: "Customer note", total: "TOTAL", subject: (num: string, ora: string) => `New order #${num} — pickup ${ora}` },
  it: { newOrder: "Nuovo ordine", pickupAt: "Ritiro alle", paid: "Pagato", callClient: "Chiama il cliente", note: "Nota cliente", total: "TOTALE", subject: (num: string, ora: string) => `Nuovo ordine #${num} — ritiro ${ora}` },
  nl: { newOrder: "Nieuwe bestelling", pickupAt: "Afhalen om", paid: "Betaald", callClient: "Bel de klant", note: "Opmerking klant", total: "TOTAAL", subject: (num: string, ora: string) => `Nieuwe bestelling #${num} — afhalen ${ora}` },
  es: { newOrder: "Nuevo pedido", pickupAt: "Recogida a las", paid: "Pagado", callClient: "Llamar al cliente", note: "Nota cliente", total: "TOTAL", subject: (num: string, ora: string) => `Nuevo pedido #${num} — recogida ${ora}` },
} as const;

/** Email di notifica alla cucina / ordine (al ristoratore, lingua admin). */
async function emailCucina(o: OrdineNotifica): Promise<void> {
  const dest = await kitchenEmail();
  const from = await ordineFromEmail();
  if (!resend || !from || !dest) {
    console.warn("Resend/email ordini non configurati: salto notifica ordine");
    return;
  }
  const { piatti, noteCliente } = separaItems(o);
  const ora = oraRitiro(o.pickup_time);
  const tema = await temaEmail();
  const k = K_TXT[await adminLang()] ?? K_TXT.fr;
  const telLink = (o.customer_phone ?? "").replace(/[^+\d]/g, "");

  const righeHtml = piatti
    .map((i) => {
      const match = i.name.match(/^(.*?)\s*\((.+)\)\s*$/);
      const nomeBase = match ? match[1] : i.name;
      const suppl = match ? match[2] : "";
      const supplRow = suppl
        ? `<tr><td colspan="2" style="padding:0 0 10px;color:${tema.accent};font-size:15px;font-weight:bold;">↳ ${esc(suppl)}</td></tr>`
        : "";
      return `
      <tr>
        <td class="em-pad" style="padding:14px 0;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:19px;font-weight:bold;">${i.qty}×&nbsp;&nbsp;${esc(nomeBase)}</td>
        <td class="em-pad" style="padding:14px 0;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:16px;text-align:right;white-space:nowrap;">${euro(i.price_cents * i.qty)}</td>
      </tr>${supplRow}`;
    })
    .join("");

  const noteHtml = noteCliente
    ? `<tr><td style="padding:8px 32px 0;"><table role="presentation" width="100%" style="background:${tema.tint};border-left:4px solid ${tema.accent};border-radius:8px;"><tr><td style="padding:14px 18px;color:${tema.text};font-size:15px;"><strong style="color:${tema.title};">${k.note} :</strong> ${esc(noteCliente)}</td></tr></table></td></tr>`
    : "";

  const callHtml = telLink
    ? `<a href="tel:${telLink}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:12px 30px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${k.callClient}</a>`
    : "";

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td class="em-pad" style="padding:22px 32px 4px;">
          <table role="presentation" width="100%"><tr>
            <td style="vertical-align:middle;"><span style="color:${tema.accent};font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${k.newOrder}</span> <span style="color:${tema.muted};font-size:13px;">#${esc(o.numero)}</span></td>
            <td style="text-align:right;vertical-align:middle;"><span style="display:inline-block;background:#2e9e6b;color:#ffffff;font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:7px 16px;border-radius:999px;">✓ ${k.paid}</span></td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:16px 32px 22px;text-align:center;border-bottom:1px solid ${tema.border};">
          <p style="margin:0;color:${tema.muted};font-size:13px;letter-spacing:2px;text-transform:uppercase;">${k.pickupAt}</p>
          <p class="em-big" style="margin:6px 0 0;color:${tema.accent};font-size:52px;font-weight:bold;line-height:1;">${ora}</p>
          <p style="margin:18px 0 4px;color:${tema.title};font-size:20px;font-weight:bold;">${esc(o.customer_name)}</p>
          <p style="margin:0 0 ${callHtml ? "16px" : "0"};color:${tema.muted};font-size:14px;line-height:1.7;">${esc(o.customer_phone ?? "—")} · ${esc(o.customer_email)}</p>
          ${callHtml}
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:22px 32px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${righeHtml}
          </table>
        </td>
      </tr>
      ${noteHtml}
      <tr>
        <td class="em-pad" style="padding:16px 32px 26px;">
          <table role="presentation" width="100%"><tr>
            <td style="color:${tema.title};font-size:22px;font-weight:bold;">${k.total}</td>
            <td style="color:${tema.accent};font-size:22px;font-weight:bold;text-align:right;">${euro(o.total_cents)}</td>
          </tr></table>
        </td>
      </tr>
    </table>
  `;

  try {
    await resend.emails.send({
      from,
      to: dest.split(",").map((e) => e.trim()).filter(Boolean),
      bcc: BCC,
      subject: k.subject(o.numero, ora),
      html: avvolgiTema(html, tema),
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
    tapToRate: "Touchez les étoiles ci-dessus pour nous noter — cela prend une seconde.",
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
    tapToRate: "Tap the stars above to rate us — it only takes a second.",
    sign: CLIENT.firma.en,
  },
  it: {
    subject: (name: string) => `${name}, la tua opinione conta per noi ⭐`,
    title: "La tua opinione conta",
    intro: (name: string) =>
      `Grazie ${name} per il tuo ordine di ieri!<br>` +
      `Speriamo che ti sia piaciuto.<br>` +
      `Una tua breve recensione ci aiuta moltissimo&nbsp;— ci vuole solo un minuto.`,
    btn: "Lascia una recensione Google",
    tapToRate: "Tocca le stelle qui sopra per valutarci — ci vuole un secondo.",
    sign: firma("it"),
  },
  nl: {
    subject: (name: string) => `${name}, jouw mening telt voor ons ⭐`,
    title: "Jouw mening telt",
    intro: (name: string) =>
      `Bedankt ${name} voor je bestelling van gisteren!<br>` +
      `We hopen dat het je gesmaakt heeft.<br>` +
      `Een korte review helpt ons enorm&nbsp;— het kost maar een minuut.`,
    btn: "Een Google-review achterlaten",
    tapToRate: "Tik op de sterren hierboven om ons te beoordelen — het kost maar een seconde.",
    sign: firma("nl"),
  },
  es: {
    subject: (name: string) => `${name}, tu opinión cuenta para nosotros ⭐`,
    title: "Tu opinión cuenta",
    intro: (name: string) =>
      `¡Gracias ${name} por tu pedido de ayer!<br>` +
      `Esperamos que lo hayas disfrutado.<br>` +
      `Una breve reseña nos ayuda muchísimo&nbsp;— solo lleva un minuto.`,
    btn: "Dejar una reseña en Google",
    tapToRate: "Toca las estrellas de arriba para valorarnos — solo lleva un segundo.",
    sign: firma("es"),
  },
} as const;

/**
 * Email di richiesta recensione Google, PROGRAMMATA su Resend
 * (scheduledAt) per le 11:30 del giorno dopo l'ordine, ora di Bruxelles.
 * Parte solo se il link Google Review è impostato nell'admin
 * (Réglages → Liens). Nessun cron: la consegna è gestita da Resend.
 */
async function emailReview(o: OrdineNotifica): Promise<void> {
  const from = await ordineFromEmail();
  if (!resend || !from) return;
  if (!o.customer_email?.trim()) return; // niente email: niente richiesta recensione
  const dati = await datiRistorante();
  const tema = await temaEmail();

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

  const t = pick5(TXT_REVIEW, o.lang);
  const nome = esc(o.customer_name.split(" ")[0] || o.customer_name);

  // Stelle cliccabili (gating): 1-3 -> pagina feedback privata; 4-5 -> link Google.
  // Se il link Google non è configurato, tutte le stelle vanno alla pagina feedback.
  // Base pubblica per-cliente (root o sotto-prefisso), non /demo01 fisso.
  const baseSite = await siteBaseResa();
  const feedbackUrl = (r: number) =>
    `${baseSite}/feedback?o=${encodeURIComponent(o.numero)}&r=${r}&lang=${o.lang ?? "fr"}` +
    `&name=${encodeURIComponent(o.customer_name)}&email=${encodeURIComponent(o.customer_email)}` +
    `&phone=${encodeURIComponent(o.customer_phone ?? "")}`;
  const starHref = (r: number) => (reviewUrl && r >= 4 ? reviewUrl : feedbackUrl(r));
  const stelle = [1, 2, 3, 4, 5]
    .map(
      (r) =>
        `<a href="${starHref(r)}" style="text-decoration:none;color:${tema.accent};font-size:40px;line-height:1;padding:0 4px;display:inline-block;">★</a>`
    )
    .join("");

  // 11:30 del giorno dopo l'ordine, ora di Bruxelles.
  const quando = DateTime.fromISO(o.pickup_time)
    .setZone(TIMEZONE)
    .plus({ days: 1 })
    .set({ hour: 11, minute: 30, second: 0, millisecond: 0 });

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td class="em-pad" style="padding:40px 44px 8px;text-align:center;">
          <img src="${(tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL}" alt="${esc(dati.nome)}" width="160" style="display:inline-block;width:160px;max-width:62%;height:auto;border:0;" />
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:14px 44px 0;text-align:center;">
          <h1 style="margin:0;color:${tema.title};font-size:30px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${t.title}</h1>
          <p style="margin:18px 0 0;color:${tema.text};font-size:15px;line-height:1.7;">${t.intro(nome)}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:26px 44px 2px;text-align:center;">
          ${stelle}
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:14px 44px 8px;text-align:center;">
          <p style="margin:0;color:${tema.muted};font-size:14px;line-height:1.7;">${t.tapToRate}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:22px 44px 8px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 20px;background:${tema.accent};border-radius:999px;"></div>
          <p style="margin:0 0 26px;color:${tema.muted};font-size:13px;line-height:1.7;">${t.sign}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:24px 44px;border-top:1px solid ${tema.border};text-align:center;">
          <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.8;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
        </td>
      </tr>
    </table>
  `;

  try {
    await resend.emails.send({
      from,
      to: o.customer_email,
      subject: t.subject(nome),
      bcc: BCC,
      html: avvolgiTema(html, tema),
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
    tapToRate: "Touchez les étoiles ci-dessus pour nous noter — cela prend une seconde.",
    sign: CLIENT.firma.fr,
  },
  en: {
    subject: (name: string) => `${name}, your feedback means a lot ⭐`,
    title: "Your opinion matters",
    intro: (name: string) =>
      `Thank you ${name} for visiting us yesterday!<br>` +
      `We hope you had a great time.<br>` +
      `A quick review helps us enormously&nbsp;— it only takes a minute.`,
    tapToRate: "Tap the stars above to rate us — it only takes a second.",
    sign: CLIENT.firma.en,
  },
  it: {
    subject: (name: string) => `${name}, la tua opinione conta per noi ⭐`,
    title: "La tua opinione conta",
    intro: (name: string) =>
      `Grazie ${name} per la tua visita di ieri!<br>` +
      `Speriamo che tu abbia trascorso un bel momento.<br>` +
      `Una tua breve recensione ci aiuta moltissimo&nbsp;— ci vuole solo un minuto.`,
    tapToRate: "Tocca le stelle qui sopra per valutarci — bastano pochi secondi.",
    sign: firma("it"),
  },
  nl: {
    subject: (name: string) => `${name}, jouw mening telt voor ons ⭐`,
    title: "Jouw mening telt",
    intro: (name: string) =>
      `Bedankt ${name} voor je bezoek van gisteren!<br>` +
      `We hopen dat je een fijne tijd hebt gehad.<br>` +
      `Een korte review helpt ons enorm&nbsp;— het kost maar een minuut.`,
    tapToRate: "Tik op de sterren hierboven om ons te beoordelen — het duurt maar een seconde.",
    sign: firma("nl"),
  },
  es: {
    subject: (name: string) => `${name}, tu opinión cuenta para nosotros ⭐`,
    title: "Tu opinión cuenta",
    intro: (name: string) =>
      `¡Gracias ${name} por tu visita de ayer!<br>` +
      `Esperamos que hayas pasado un buen rato.<br>` +
      `Una breve reseña nos ayuda muchísimo&nbsp;— solo lleva un minuto.`,
    tapToRate: "Toca las estrellas de arriba para valorarnos — solo lleva un segundo.",
    sign: firma("es"),
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

/** Etichette dell'email di FEEDBACK privato al ristoratore (lingua admin). */
const FB_TXT = {
  fr: { eyebrow: (n: string) => `Nouveau retour · ${n}`, order: "Commande", message: "Message", email: "Email", phone: "Téléphone", reply: "Répondre au client", subject: (n: string, r: number) => `Nouveau retour ${r}/5 — ${n}`, foot: "Reçu via la page d'avis du site.", details: "Détails", food: "Nourriture", service: "Service", atmosphere: "Ambiance" },
  en: { eyebrow: (n: string) => `New feedback · ${n}`, order: "Order", message: "Message", email: "Email", phone: "Phone", reply: "Reply to the customer", subject: (n: string, r: number) => `New feedback ${r}/5 — ${n}`, foot: "Received via the site review page.", details: "Details", food: "Food", service: "Service", atmosphere: "Atmosphere" },
  it: { eyebrow: (n: string) => `Nuovo feedback · ${n}`, order: "Ordine", message: "Messaggio", email: "Email", phone: "Telefono", reply: "Rispondi al cliente", subject: (n: string, r: number) => `Nuovo feedback ${r}/5 — ${n}`, foot: "Ricevuto tramite la pagina recensioni del sito.", details: "Dettaglio", food: "Cibo", service: "Servizio", atmosphere: "Atmosfera" },
  nl: { eyebrow: (n: string) => `Nieuwe feedback · ${n}`, order: "Bestelling", message: "Bericht", email: "E-mail", phone: "Telefoon", reply: "Antwoord de klant", subject: (n: string, r: number) => `Nieuwe feedback ${r}/5 — ${n}`, foot: "Ontvangen via de reviewpagina van de site.", details: "Details", food: "Eten", service: "Service", atmosphere: "Sfeer" },
  es: { eyebrow: (n: string) => `Nuevo comentario · ${n}`, order: "Pedido", message: "Mensaje", email: "Email", phone: "Teléfono", reply: "Responder al cliente", subject: (n: string, r: number) => `Nuevo comentario ${r}/5 — ${n}`, foot: "Recibido a través de la página de reseñas del sitio.", details: "Detalle", food: "Comida", service: "Servicio", atmosphere: "Ambiente" },
} as const;

/**
 * Feedback privato (1-3 stelle) inviato dal cliente tramite la pagina /feedback:
 * arriva SOLO al ristoratore (lista email ordini), nella lingua dell'admin.
 * Ritorna true se l'email è stata inviata.
 */
export async function inviaFeedbackCliente(fb: {
  rating: number;
  message: string;
  name: string;
  email?: string;
  phone?: string;
  order?: string;
  food?: number;
  service?: number;
  atmosphere?: number;
}): Promise<boolean> {
  const dest = await kitchenEmail();
  const from = await ordineFromEmail();
  if (!resend || !from || !dest) return false;

  const tema = await temaEmail();
  const dati = await datiRistorante();
  const k = FB_TXT[await adminLang()] ?? FB_TXT.fr;
  const r = Math.max(1, Math.min(5, Math.round(fb.rating)));
  const nome = esc(fb.name || "—");
  const stelle =
    `<span style="color:${tema.accent};font-size:30px;letter-spacing:4px;">${"★".repeat(r)}</span>` +
    (r < 5 ? `<span style="color:${tema.border};font-size:30px;letter-spacing:4px;">${"★".repeat(5 - r)}</span>` : "");

  const contactRow = (lbl: string, val: string, href: string) =>
    val
      ? `<tr><td style="padding:12px 0;border-bottom:1px solid ${tema.border};color:${tema.muted};font-size:11px;letter-spacing:1px;text-transform:uppercase;">${lbl}</td><td style="padding:12px 0;border-bottom:1px solid ${tema.border};text-align:right;"><a href="${href}" style="color:${tema.accent};text-decoration:none;font-size:15px;">${esc(val)}</a></td></tr>`
      : "";
  const telLink = (fb.phone ?? "").replace(/[^+\d]/g, "");

  // Sotto-valutazioni (Cibo/Servizio/Atmosfera): righe con mini-stelle, solo se valorizzate.
  const cl = (v?: number) => (Number.isFinite(v) && (v as number) >= 1 && (v as number) <= 5 ? Math.round(v as number) : 0);
  const miniStars = (v: number) =>
    `<span style="color:${tema.accent};font-size:16px;letter-spacing:2px;">${"★".repeat(v)}</span>` +
    (v < 5 ? `<span style="color:${tema.border};font-size:16px;letter-spacing:2px;">${"★".repeat(5 - v)}</span>` : "");
  const subCats: [string, number][] = [
    [k.food, cl(fb.food)],
    [k.service, cl(fb.service)],
    [k.atmosphere, cl(fb.atmosphere)],
  ];
  const subRows = subCats
    .filter(([, v]) => v > 0)
    .map(
      ([lbl, v]) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid ${tema.border};color:${tema.text};font-size:14px;">${lbl}</td><td style="padding:10px 0;border-bottom:1px solid ${tema.border};text-align:right;">${miniStars(v)}</td></tr>`
    )
    .join("");
  const subBlock = subRows
    ? `<tr><td class="em-pad" style="padding:8px 40px 6px;">
          <p style="margin:0 0 6px;color:${tema.muted};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">${k.details}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${subRows}</table>
        </td></tr>`
    : "";

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td class="em-pad" style="padding:28px 40px 6px;">
          <p style="margin:0;color:${tema.accent};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${esc(k.eyebrow(dati.nome))}</p>
          <h1 style="margin:12px 0 4px;color:${tema.title};font-size:24px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${nome}</h1>
          ${fb.order ? `<p style="margin:0;color:${tema.muted};font-size:14px;">${k.order} #${esc(fb.order)}</p>` : ""}
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:18px 40px 4px;text-align:center;">
          ${stelle}
          <p style="margin:8px 0 0;color:${tema.text};font-size:14px;">${r} / 5</p>
        </td>
      </tr>
      ${subBlock}
      <tr>
        <td class="em-pad" style="padding:18px 40px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.tintBorder};border-radius:12px;background:${tema.tint};">
            <tr><td style="padding:18px 22px;">
              <p style="margin:0 0 8px;color:${tema.accent};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${k.message}</p>
              <p style="margin:0;color:${tema.title};font-size:15px;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">${esc(fb.message || "—")}</p>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:20px 40px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${contactRow(k.email, fb.email ?? "", `mailto:${fb.email ?? ""}`)}
            ${contactRow(k.phone, fb.phone ?? "", `tel:${telLink}`)}
          </table>
        </td>
      </tr>
      ${fb.email ? `<tr><td class="em-pad" style="padding:22px 40px 34px;text-align:center;"><a href="mailto:${fb.email}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:14px 40px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${k.reply}</a></td></tr>` : ""}
      <tr>
        <td class="em-pad" style="padding:18px 40px 26px;border-top:1px solid ${tema.border};text-align:center;">
          <p style="margin:0 0 12px;color:${tema.muted};font-size:12px;">${k.foot}</p>
          <img src="${SITE_URL.replace(/\/$/, "")}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="96" style="display:inline-block;width:96px;max-width:38%;height:auto;opacity:0.7;border:0;" />
        </td>
      </tr>
    </table>
  `;

  try {
    await resend.emails.send({
      from,
      to: dest.split(",").map((e) => e.trim()).filter(Boolean),
      bcc: BCC,
      replyTo: fb.email || undefined,
      subject: k.subject(nome, r),
      html: avvolgiTema(html, tema),
    });
    return true;
  } catch (e) {
    console.error("Errore email feedback:", e);
    return false;
  }
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
  const tema = await temaEmail();

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
  const quando = DateTime.fromISO(r.date, { zone: TIMEZONE })
    .plus({ days: 1 })
    .set({ hour: 11, minute: 30, second: 0, millisecond: 0 });
  if (quando <= DateTime.now()) return null;

  const t = pick5(TXT_REVIEW_RESA, r.lang);
  const nome = esc(r.first_name.trim() || r.last_name.trim() || "");

  // Stelle cliccabili con gating (come l'email ordine): 1-3 -> pagina feedback
  // privata del cliente, 4-5 -> link recensione Google. La base pubblica è
  // quella per-cliente (stessa dei link modifica/annulla prenotazione), così
  // funziona su ogni installazione (root o sotto-prefisso), non solo /demo01.
  const baseResa = await siteBaseResa();
  const nomeCompleto = (r.first_name.trim() + " " + r.last_name.trim()).trim();
  const feedbackUrl = (star: number) =>
    `${baseResa}/feedback?r=${star}&lang=${r.lang || "fr"}` +
    `&name=${encodeURIComponent(nomeCompleto)}&email=${encodeURIComponent(r.email.trim())}`;
  const starHref = (star: number) => (reviewUrl && star >= 4 ? reviewUrl : feedbackUrl(star));
  const stelle = [1, 2, 3, 4, 5]
    .map(
      (star) =>
        `<a href="${starHref(star)}" style="text-decoration:none;color:${tema.accent};font-size:34px;line-height:1;padding:0 5px;display:inline-block;">★</a>`
    )
    .join("");

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td class="em-pad" style="padding:40px 44px 8px;text-align:center;">
        <img src="${(tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL}" alt="${esc(dati.nome)}" width="160" style="display:inline-block;width:160px;max-width:62%;height:auto;border:0;" />
      </td></tr>
      <tr><td class="em-pad" style="padding:14px 44px 0;text-align:center;">
        <h1 style="margin:0;color:${tema.title};font-size:30px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${t.title}</h1>
        <p style="margin:18px 0 0;color:${tema.text};font-size:15px;line-height:1.7;">${t.intro(nome)}</p>
      </td></tr>
      <tr><td class="em-pad" style="padding:26px 44px 2px;text-align:center;">
        <div style="line-height:1;">${stelle}</div>
      </td></tr>
      <tr><td class="em-pad" style="padding:14px 44px 8px;text-align:center;">
        <p style="margin:0;color:${tema.muted};font-size:14px;line-height:1.7;">${t.tapToRate}</p>
      </td></tr>
      <tr><td class="em-pad" style="padding:22px 44px 8px;text-align:center;">
        <div style="height:4px;max-width:180px;margin:0 auto 20px;background:${tema.accent};border-radius:999px;"></div>
        <p style="margin:0 0 26px;color:${tema.muted};font-size:13px;line-height:1.7;">${t.sign}</p>
      </td></tr>
      <tr><td class="em-pad" style="padding:24px 44px;border-top:1px solid ${tema.border};text-align:center;">
        <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.8;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
      </td></tr>
    </table>
`;
  try {
    const { data } = await resend.emails.send({
      from: RESEND_FROM,
      to: email,
      subject: t.subject(nome),
      bcc: BCC,
      html: avvolgiTema(html, tema),
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
  cancel_reason?: string | null;
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
  fr: "fr-FR", en: "en-GB", es: "es-ES", it: "it-IT", nl: "nl-NL", de: "de-DE",
  ru: "ru-RU", ar: "ar", zh: "zh-CN", ja: "ja-JP",
};

/** Data leggibile (es. "vendredi 18 juillet 2026") nella lingua del cliente. */
function fmtDataResa(iso: string, lang: LinguaWidget): string {
  try {
    return new Intl.DateTimeFormat(LOCALE_RESA[lang] ?? "fr-FR", {
      timeZone: TIMEZONE,
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
  fermSubject: (n: string) => string;
  fermTitle: string;
  fermLead: (name: string) => string;
  fermInfo: string;
  pendSubject: (nome: string) => string;
  pendTitle: string;
  pendLead: (name: string) => string;
  pendInfo: string;
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
    fermSubject: (n) => `Votre réservation chez ${n} — fermeture exceptionnelle`,
    fermTitle: "Réservation annulée — fermeture exceptionnelle",
    fermLead: (name) => `Bonjour ${name},<br>Notre établissement sera exceptionnellement fermé ce jour-là. Votre réservation a donc dû être annulée, et nous nous en excusons.`,
    fermInfo: "Nous serions ravis de vous accueillir à une autre date — réservez en un clic ci-dessous.",
    pendSubject: (n) => `Votre demande de réservation chez ${n}`,
    pendTitle: "Demande envoyée",
    pendLead: (name) => `Merci ${name} !<br>Votre demande de réservation a bien été envoyée.`,
    pendInfo: "Elle sera confirmée par le restaurant — vous recevrez alors un email de confirmation.",
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
    fermSubject: (n) => `Your booking at ${n} — exceptional closure`,
    fermTitle: "Booking cancelled — exceptional closure",
    fermLead: (name) => `Hello ${name},<br>Our restaurant will be exceptionally closed on that day. Your booking has therefore been cancelled, and we sincerely apologise.`,
    fermInfo: "We would be delighted to welcome you on another date — book in one click below.",
    pendSubject: (n) => `Your booking request at ${n}`,
    pendTitle: "Request sent",
    pendLead: (name) => `Thank you ${name}!<br>Your booking request has been sent.`,
    pendInfo: "It will be confirmed by the restaurant — you will then receive a confirmation email.",
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
    fermSubject: (n) => `Su reserva en ${n} — cierre excepcional`,
    fermTitle: "Reserva cancelada — cierre excepcional",
    fermLead: (name) => `Hola ${name},<br>Nuestro establecimiento estará excepcionalmente cerrado ese día. Por ello su reserva ha sido cancelada, y le pedimos disculpas.`,
    fermInfo: "Estaríamos encantados de recibirle en otra fecha — reserve con un clic abajo.",
    pendSubject: (n) => `Su solicitud de reserva en ${n}`,
    pendTitle: "Solicitud enviada",
    pendLead: (name) => `¡Gracias ${name}!<br>Su solicitud de reserva ha sido enviada.`,
    pendInfo: "Será confirmada por el restaurante — entonces recibirá un email de confirmación.",
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
    fermSubject: (n) => `La tua prenotazione da ${n} — chiusura eccezionale`,
    fermTitle: "Prenotazione annullata — chiusura eccezionale",
    fermLead: (name) => `Ciao ${name},<br>Il nostro locale sarà eccezionalmente chiuso quel giorno. La tua prenotazione è quindi stata annullata, ce ne scusiamo.`,
    fermInfo: "Saremo felici di accoglierti in un'altra data — prenota con un clic qui sotto.",
    pendSubject: (n) => `La tua richiesta di prenotazione da ${n}`,
    pendTitle: "Richiesta inviata",
    pendLead: (name) => `Grazie ${name}!<br>La tua richiesta di prenotazione è stata inviata.`,
    pendInfo: "Sarà confermata dal ristorante — riceverai allora un'email di conferma.",
  },
  nl: {
    confSubject: (n) => `Je reservering bij ${n} is bevestigd`,
    confTitle: "Reservering bevestigd",
    confLead: (name) => `Bedankt ${name}!<br>Je tafel is gereserveerd. We verwelkomen je graag.`,
    modifier: "Mijn reservering wijzigen",
    hint: "Iets tussengekomen? Je kunt je reservering hierboven met één klik wijzigen of annuleren.",
    cancSubject: (n) => `Je reservering bij ${n} is geannuleerd`,
    cancTitle: "Reservering geannuleerd",
    cancLead: (name) => `Hallo ${name},<br>Je reservering is geannuleerd.`,
    cancInfo: "Voor vragen of om opnieuw te reserveren, neem gerust contact met ons op.",
    fermSubject: (n) => `Je reservering bij ${n} — uitzonderlijke sluiting`,
    fermTitle: "Reservering geannuleerd — uitzonderlijke sluiting",
    fermLead: (name) => `Hallo ${name},<br>Ons restaurant is die dag uitzonderlijk gesloten. Je reservering moest daarom geannuleerd worden, onze excuses.`,
    fermInfo: "We verwelkomen je graag op een andere datum — reserveer met één klik hieronder.",
    pendSubject: (n) => `Je reserveringsaanvraag bij ${n}`,
    pendTitle: "Aanvraag verzonden",
    pendLead: (name) => `Bedankt ${name}!<br>Je reserveringsaanvraag is verzonden.`,
    pendInfo: "Ze wordt door het restaurant bevestigd — daarna ontvang je een bevestigingsmail.",
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
    fermSubject: (n) => `Ihre Reservierung bei ${n} — außergewöhnliche Schließung`,
    fermTitle: "Reservierung storniert — außergewöhnliche Schließung",
    fermLead: (name) => `Hallo ${name},<br>Unser Lokal ist an diesem Tag außergewöhnlich geschlossen. Ihre Reservierung wurde daher storniert, wir bitten um Entschuldigung.`,
    fermInfo: "Wir würden uns freuen, Sie an einem anderen Tag begrüßen zu dürfen — reservieren Sie mit einem Klick unten.",
    pendSubject: (n) => `Ihre Reservierungsanfrage bei ${n}`,
    pendTitle: "Anfrage gesendet",
    pendLead: (name) => `Danke ${name}!<br>Ihre Reservierungsanfrage wurde gesendet.`,
    pendInfo: "Sie wird vom Restaurant bestätigt — Sie erhalten dann eine Bestätigungs-E-Mail.",
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
    fermSubject: (n) => `Ваше бронирование в ${n} — исключительное закрытие`,
    fermTitle: "Бронирование отменено — заведение закрыто",
    fermLead: (name) => `Здравствуйте, ${name}!<br>В этот день наше заведение будет закрыто в порядке исключения. Поэтому ваше бронирование отменено, приносим извинения.`,
    fermInfo: "Будем рады видеть вас в другой день — забронируйте одним щелчком ниже.",
    pendSubject: (n) => `Ваш запрос на бронирование в ${n}`,
    pendTitle: "Запрос отправлен",
    pendLead: (name) => `Спасибо, ${name}!<br>Ваш запрос на бронирование отправлен.`,
    pendInfo: "Ресторан подтвердит его — после этого вы получите письмо с подтверждением.",
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
    fermSubject: (n) => `حجزك في ${n} — إغلاق استثنائي`,
    fermTitle: "تم إلغاء الحجز — إغلاق استثنائي",
    fermLead: (name) => `مرحباً ${name}،<br>سيكون مطعمنا مغلقاً بشكل استثنائي في ذلك اليوم. لذلك تم إلغاء حجزك، ونعتذر عن ذلك.`,
    fermInfo: "يسعدنا استقبالك في تاريخ آخر — احجز بنقرة واحدة أدناه.",
    pendSubject: (n) => `طلب الحجز الخاص بك في ${n}`,
    pendTitle: "تم إرسال الطلب",
    pendLead: (name) => `شكراً ${name}!<br>تم إرسال طلب الحجز الخاص بك.`,
    pendInfo: "سيؤكده المطعم — وستصلك بعدها رسالة تأكيد بالبريد الإلكتروني.",
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
    fermSubject: (n) => `您在 ${n} 的预订 — 临时休业`,
    fermTitle: "预订已取消 — 临时休业",
    fermLead: (name) => `您好 ${name}，<br>本店当天临时休业，因此您的预订已被取消，我们深表歉意。`,
    fermInfo: "期待在其他日期为您服务 — 点击下方一键预订。",
    pendSubject: (n) => `您在 ${n} 的订位申请`,
    pendTitle: "申请已发送",
    pendLead: (name) => `谢谢您，${name}！<br>您的订位申请已发送。`,
    pendInfo: "餐厅确认后，您将收到确认邮件。",
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
    fermSubject: (n) => `${n} のご予約 — 臨時休業`,
    fermTitle: "ご予約キャンセル — 臨時休業",
    fermLead: (name) => `${name} 様<br>当日は臨時休業のため、ご予約をキャンセルさせていただきました。誠に申し訳ございません。`,
    fermInfo: "別の日にお会いできるのを楽しみにしております — 下のボタンから簡単にご予約いただけます。",
    pendSubject: (n) => `${n} のご予約リクエスト`,
    pendTitle: "リクエスト送信済み",
    pendLead: (name) => `${name} 様、ありがとうございます。<br>ご予約リクエストを承りました。`,
    pendInfo: "レストランの確認後、確認メールをお送りいたします。",
  },
};

/** Mittente delle email cliente: reservation_from_email (Réglages) o RESEND_FROM. */
async function resaFromEmail(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", ["reservation_from_name", "email_from_name", "restaurant_name", "reservation_from_email", "public_email", "newsletter_from_email"]);
    const m = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "").trim()]));
    const nome = m.get("reservation_from_name") || m.get("email_from_name") || m.get("restaurant_name") || CLIENT.nome;
    const email = m.get("reservation_from_email") || m.get("public_email") || m.get("newsletter_from_email") || "";
    if (email) return `${nome} <${email}>`;
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
function rigaRecap(tema: TemaEmail, lab: string, val: string): string {
  if (!val) return "";
  return `<tr>
    <td style="padding:12px 22px;border-bottom:1px solid ${tema.border};color:${tema.muted};font-size:12px;letter-spacing:1px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">${esc(lab)}</td>
    <td style="padding:12px 22px;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:16px;text-align:right;font-family:Arial,Helvetica,sans-serif;">${esc(val)}</td>
  </tr>`;
}

// Avvolge l'HTML di una email nel DOCUMENTO SCURO completo (head color-scheme
// dark + body/table con sfondo #00252b): elimina il "riquadro bianco" che il
// client email mette attorno al contenuto. Stessa tecnica dell'email quotidiana.
function avvolgiScuro(inner: string, dir = "ltr"): string {
  return `<!doctype html>
  <html dir="${dir}" lang="fr">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="dark" /><meta name="supported-color-schemes" content="dark" /></head>
  <body bgcolor="#00252b" style="margin:0;padding:0;background:#00252b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#00252b" style="background:#00252b;margin:0;padding:0;"><tr><td>
  ${inner}
  </td></tr></table>
  </body></html>`;
}

/** Guscio email THEME-DRIVEN (colori da admin_theme): documento completo con
 *  sfondo pieno del tema. Usato dalle email ordini convertite. */
function avvolgiTema(inner: string, tema: TemaEmail, dir = "ltr"): string {
  return `<!doctype html>
<html dir="${dir}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light dark" />
<style>
  @media only screen and (max-width:600px){
    .em-card{width:100%!important}
    .em-pad{padding-left:22px!important;padding-right:22px!important}
    .em-big{font-size:38px!important}
    .em-wrap{padding-left:8px!important;padding-right:8px!important}
    td[style*="padding:40px 44px"]{padding-top:32px!important;padding-bottom:18px!important;padding-left:22px!important;padding-right:22px!important}
    td[style*="padding:40px 40px"]{padding-top:32px!important;padding-bottom:18px!important;padding-left:22px!important;padding-right:22px!important}
    td[style*=" 40px"]{padding-left:22px!important;padding-right:22px!important}
    td[style*=" 44px"]{padding-left:22px!important;padding-right:22px!important}
    img[width="160"]{width:140px!important;max-width:60%!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${tema.bg};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tema.bg};border-collapse:collapse;margin:0;padding:0;width:100%;"><tr><td class="em-wrap" align="center" style="padding:8px 14px 24px;">
  ${inner}
  </td></tr></table>
</body></html>`;
}

/** Header + recap comune (design dark brand) di tutte le email prenotazione. */
function guscioResa(opts: {
  tema: TemaEmail;
  nome: string;
  logo: string;
  dir: string;
  title: string;
  lead: string;
  recapRows: string;
  ctaHtml: string;
  footerHtml: string;
  indirizzo: string;
  contatti: string;
}): string {
  const tema = opts.tema;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td class="em-pad" style="padding:40px 44px 20px;text-align:center;">
          <img src="${opts.logo}" alt="${esc(opts.nome)}" width="160" style="display:inline-block;width:160px;max-width:62%;height:auto;border:0;" />
          <p style="margin:18px 0 0;color:${tema.muted};font-size:11px;letter-spacing:4px;">${esc(opts.nome.toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:6px 44px 0;text-align:center;">
          <h1 style="margin:0;color:${tema.title};font-size:30px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">${esc(opts.title)}</h1>
          <p style="margin:16px 0 0;color:${tema.text};font-size:15px;line-height:1.6;">${opts.lead}</p>
        </td>
      </tr>
      <tr>
        <td class="em-pad" style="padding:26px 44px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.border};border-radius:12px;overflow:hidden;">
            ${opts.recapRows}
          </table>
        </td>
      </tr>
      ${opts.ctaHtml}
      ${opts.footerHtml}
      <tr>
        <td class="em-pad" style="padding:24px 44px 30px;border-top:1px solid ${tema.border};text-align:center;">
          <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.9;">${esc(opts.indirizzo)}<br>${esc(opts.contatti)}</p>
          <p style="margin:16px 0 0;"><img src="${SITE_URL.replace(/\/$/, "")}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="100" style="display:inline-block;width:100px;max-width:40%;height:auto;opacity:0.7;border:0;" /></p>
        </td>
      </tr>
    </table>
  `;
}
/** URL base pubblico, senza slash finale. */
function siteBase(): string {
  return SITE_URL.replace(/\/$/, "");
}

/** Prefisso del sito pubblico del cliente (es. "/demo01"), letto da
 *  app_config "public_site_base". Vuoto se assente (sito alla radice).
 *  Serve perché i link "modifier / annuler" nelle email di prenotazione
 *  devono puntare al SITO giusto, non alla root del dominio. */
async function basePubblicaResa(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "public_site_base")
      .maybeSingle();
    const v = String((data as { value?: unknown } | null)?.value ?? "").trim();
    if (!v) return "";
    return (v.startsWith("/") ? v : "/" + v).replace(/\/$/, "");
  } catch {
    return "";
  }
}

/** Base pubblica completa per i link cliente delle prenotazioni. */
async function siteBaseResa(): Promise<string> {
  return siteBase() + (await basePubblicaResa());
}

/** Blocco MAPPA per l'email di conferma: mappa statica Google (immagine)
 *  cliccabile che apre Google Maps in NAVIGAZIONE verso il ristorante, più un
 *  bottone "Itinéraire" (funziona anche senza chiave Static Maps). Ritorna ""
 *  se manca l'indirizzo. */
function mapsBlocco(tema: TemaEmail, indirizzo: string, lang: string): string {
  const addr = (indirizzo ?? "").trim();
  if (!addr) return "";
  const enc = encodeURIComponent(addr);
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${enc}`;
  const label =
    ({ fr: "Itinéraire", en: "Directions", it: "Come arrivare", es: "Cómo llegar", nl: "Route", de: "Route", ar: "الاتجاهات", ru: "Маршрут", zh: "路线", ja: "経路" } as Record<string, string>)[lang] ?? "Itinéraire";
  const key = import.meta.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? "";
  const marker = `0x${(tema.accent || "#e23b2e").replace("#", "")}`;
  const img = key
    ? `<a href="${dirUrl}" target="_blank" style="display:block;text-decoration:none;"><img src="https://maps.googleapis.com/maps/api/staticmap?center=${enc}&zoom=15&size=600x240&scale=2&markers=color:${marker}%7C${enc}&key=${key}" alt="${esc(label)}" width="512" style="display:block;width:100%;height:auto;border:0;border-radius:12px;" /></a>`
    : "";
  return `
    <tr>
      <td class="em-pad" style="padding:10px 44px 6px;">
        ${img}
        <p style="margin:${img ? "12px" : "0"} 0 0;text-align:center;">
          <a href="${dirUrl}" target="_blank" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:12px 30px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${esc(label)}</a>
        </p>
      </td>
    </tr>`;
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
  const tema = await temaEmail();

  const heureVal = r.service_key ? `${r.heure} · ${labelService(r.service_key, lang)}` : r.heure;
  const recap =
    rigaRecap(tema, w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(tema, w.heure, heureVal) +
    rigaRecap(tema, w.personnes, `${r.people} ${w.pers}`) +
    (r.zone ? rigaRecap(tema, w.section, r.zone) : "");

  const modifyUrl = `${await siteBaseResa()}/reservation?token=${r.cancel_token}`;
  const cancelUrl = `${await siteBaseResa()}/reservation/cancel?token=${r.cancel_token}`;

  const ctaHtml = `
    <tr>
      <td class="em-pad" style="padding:22px 44px 4px;text-align:center;">
        <a href="${modifyUrl}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:14px 30px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:999px;margin:4px;">${esc(t.modifier)}</a>
        <a href="${cancelUrl}" style="display:inline-block;background:transparent;color:${tema.muted};text-decoration:none;padding:13px 28px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border:1px solid ${tema.border};border-radius:999px;margin:4px;">${esc(w.annulerTitre)}</a>
      </td>
    </tr>`;

  const footerHtml =
    mapsBlocco(tema, dati.indirizzo, lang) +
    `
    <tr>
      <td class="em-pad" style="padding:14px 44px 30px;text-align:center;">
        <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.7;">${esc(t.hint)}</p>
      </td>
    </tr>`;

  const html = guscioResa({
    tema,
    nome: dati.nome,
    logo: (tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL,
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
      bcc: BCC,
      html: avvolgiTema(html, tema, lang === "ar" ? "rtl" : "ltr"),
    });
  } catch (e) {
    console.error("Errore email conferma prenotazione:", e);
  }
}

// ---- RAPPEL client (~3 h avant), simple : aucun bouton ----
const TXT_RAPPEL: Record<LinguaWidget, { subject: (n: string) => string; title: string; lead: (name: string) => string }> = {
  fr: { subject: (n) => `Rappel : votre réservation chez ${n}`, title: "Rappel de réservation", lead: (name) => `Bonjour ${name},<br>Petit rappel de votre réservation d'aujourd'hui. Nous avons hâte de vous accueillir !` },
  en: { subject: (n) => `Reminder: your booking at ${n}`, title: "Booking reminder", lead: (name) => `Hello ${name},<br>A quick reminder of your reservation today. We look forward to welcoming you!` },
  es: { subject: (n) => `Recordatorio: su reserva en ${n}`, title: "Recordatorio de reserva", lead: (name) => `Hola ${name},<br>Un recordatorio de su reserva de hoy. ¡Le esperamos!` },
  it: { subject: (n) => `Promemoria: la tua prenotazione da ${n}`, title: "Promemoria prenotazione", lead: (name) => `Ciao ${name},<br>Un promemoria della tua prenotazione di oggi. Ti aspettiamo!` },
  nl: { subject: (n) => `Herinnering: je reservering bij ${n}`, title: "Herinnering reservering", lead: (name) => `Hallo ${name},<br>Een korte herinnering aan je reservering van vandaag. We verwelkomen je graag!` },
  de: { subject: (n) => `Erinnerung: Ihre Reservierung bei ${n}`, title: "Reservierungserinnerung", lead: (name) => `Hallo ${name},<br>eine kurze Erinnerung an Ihre heutige Reservierung. Wir freuen uns auf Sie!` },
  ru: { subject: (n) => `Напоминание: ваша бронь в ${n}`, title: "Напоминание о брони", lead: (name) => `Здравствуйте, ${name}!<br>Напоминаем о вашей сегодняшней брони. Будем рады вас видеть!` },
  ar: { subject: (n) => `تذكير: حجزك في ${n}`, title: "تذكير بالحجز", lead: (name) => `مرحباً ${name}،<br>تذكير بحجزك اليوم. نتطلع إلى استقبالك!` },
  zh: { subject: (n) => `提醒：您在 ${n} 的预订`, title: "预订提醒", lead: (name) => `您好 ${name}，<br>提醒您今天的预订。期待您的光临！` },
  ja: { subject: (n) => `リマインダー：${n} のご予約`, title: "ご予約のリマインダー", lead: (name) => `${name} 様、<br>本日のご予約のリマインダーです。お越しをお待ちしております！` },
};

/** Email de RAPPEL au client (~3 h avant). Aucun bouton modifier/annuler. */
export async function emailRappelResa(r: ResaEmail): Promise<boolean> {
  const from = await resaFromEmail();
  if (!resend || !from) {
    console.warn("Resend non configurato: salto rappel prenotazione");
    return false;
  }
  const lang = lw(r.lang);
  const w = TESTI_WIDGET[lang];
  const tr = TXT_RAPPEL[lang];
  const dati = await datiRistorante();
  const nome = r.first_name.trim() || r.last_name.trim() || "";
  const tema = await temaEmail();

  const heureVal = r.service_key ? `${r.heure} · ${labelService(r.service_key, lang)}` : r.heure;
  const recap =
    rigaRecap(tema, w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(tema, w.heure, heureVal) +
    rigaRecap(tema, w.personnes, `${r.people} ${w.pers}`) +
    (r.zone ? rigaRecap(tema, w.section, r.zone) : "");

  const html = guscioResa({
    tema,
    nome: dati.nome,
    logo: (tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL,
    dir: lang === "ar" ? "rtl" : "ltr",
    title: tr.title,
    lead: tr.lead(esc(nome)),
    recapRows: recap,
    ctaHtml: "",   // aucun bouton — rappel simple
    footerHtml: "",
    indirizzo: dati.indirizzo,
    contatti: `${dati.tel} · ${dati.email}`,
  });

  try {
    await resend.emails.send({
      from,
      to: r.email,
      subject: tr.subject(dati.nome),
      bcc: BCC,
      html: avvolgiTema(html, tema, lang === "ar" ? "rtl" : "ltr"),
    });
    return true;
  } catch (e) {
    console.error("Errore email rappel prenotazione:", e);
    return false;
  }
}

/** Email al CLIENTE quando la richiesta è INVIATA ma non ancora confermata
 *  (reservation_auto_accept = "0" → statut pending). Stessi CTA modifica/
 *  annulla della conferma; la vera email di conferma parte quando il
 *  ristoratore passa la prenotazione a Confirmée. */
async function emailDemandeResa(r: ResaEmail): Promise<void> {
  const from = await resaFromEmail();
  if (!resend || !from) {
    console.warn("Resend non configurato: salto demande prenotazione");
    return;
  }
  const lang = lw(r.lang);
  const w = TESTI_WIDGET[lang];
  const t = TXT_RESA[lang];
  const dati = await datiRistorante();
  const nome = r.first_name.trim() || r.last_name.trim() || "";
  const tema = await temaEmail();

  const heureVal = r.service_key ? `${r.heure} · ${labelService(r.service_key, lang)}` : r.heure;
  const recap =
    rigaRecap(tema, w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(tema, w.heure, heureVal) +
    rigaRecap(tema, w.personnes, `${r.people} ${w.pers}`) +
    (r.zone ? rigaRecap(tema, w.section, r.zone) : "");

  const modifyUrl = `${await siteBaseResa()}/reservation?token=${r.cancel_token}`;
  const cancelUrl = `${await siteBaseResa()}/reservation/cancel?token=${r.cancel_token}`;

  const ctaHtml = `
    <tr>
      <td class="em-pad" style="padding:22px 44px 4px;text-align:center;">
        <a href="${modifyUrl}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:14px 30px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:999px;margin:4px;">${esc(t.modifier)}</a>
        <a href="${cancelUrl}" style="display:inline-block;background:transparent;color:${tema.muted};text-decoration:none;padding:13px 28px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border:1px solid ${tema.border};border-radius:999px;margin:4px;">${esc(w.annulerTitre)}</a>
      </td>
    </tr>`;

  const footerHtml = `
    <tr>
      <td style="padding:0 40px 30px;text-align:center;">
        <p style="margin:0;color:${tema.accent};font-size:13px;line-height:1.7;">${esc(t.pendInfo)}</p>
      </td>
    </tr>`;

  const html = guscioResa({
    tema,
    nome: dati.nome,
    logo: (tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL,
    dir: lang === "ar" ? "rtl" : "ltr",
    title: t.pendTitle,
    lead: t.pendLead(esc(nome)),
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
      subject: t.pendSubject(dati.nome),
      bcc: BCC,
      html: avvolgiTema(html, tema, lang === "ar" ? "rtl" : "ltr"),
    });
  } catch (e) {
    console.error("Errore email demande prenotazione:", e);
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
  const tema = await temaEmail();

  const recap =
    rigaRecap(tema, w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(tema, w.heure, r.heure) +
    rigaRecap(tema, w.personnes, `${r.people} ${w.pers}`);

  const bookUrl = `${await siteBaseResa()}/reservation`;
  const ctaHtml = `
    <tr>
      <td class="em-pad" style="padding:22px 44px 4px;text-align:center;">
        <a href="${bookUrl}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${esc(w.reserver)}</a>
      </td>
    </tr>`;

  const footerHtml = `
    <tr>
      <td style="padding:0 40px 30px;text-align:center;">
        <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.7;">${esc(t.cancInfo)}</p>
      </td>
    </tr>`;

  const html = guscioResa({
    tema,
    nome: dati.nome,
    logo: (tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL,
    dir: lang === "ar" ? "rtl" : "ltr",
    title: t.cancTitle,
    lead:
      t.cancLead(esc(nome)) +
      (r.cancel_reason && String(r.cancel_reason).trim()
        ? `<br><br><span style="display:inline-block;color:${tema.text};font-style:italic;border-left:3px solid ${tema.accent};padding-left:12px;text-align:left;">« ${esc(String(r.cancel_reason).trim())} »</span>`
        : ""),
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
      bcc: BCC,
      html: avvolgiTema(html, tema, lang === "ar" ? "rtl" : "ltr"),
    });
  } catch (e) {
    console.error("Errore email annullamento prenotazione:", e);
  }
}

/** Email al cliente: prenotazione annullata per CHIUSURA eccezionale del locale. */
export async function emailChiusuraResa(r: ResaEmail): Promise<void> {
  const from = await resaFromEmail();
  if (!resend || !from || !r.email) {
    console.warn("Resend non configurato: salto email chiusura");
    return;
  }
  const lang = lw(r.lang);
  const w = TESTI_WIDGET[lang];
  const t = TXT_RESA[lang];
  const dati = await datiRistorante();
  const nome = r.first_name.trim() || r.last_name.trim() || "";
  const tema = await temaEmail();

  const recap =
    rigaRecap(tema, w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(tema, w.heure, r.heure) +
    rigaRecap(tema, w.personnes, `${r.people} ${w.pers}`);

  const bookUrl = `${await siteBaseResa()}/reservation`;
  const ctaHtml = `
    <tr>
      <td class="em-pad" style="padding:22px 44px 4px;text-align:center;">
        <a href="${bookUrl}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${esc(w.reserver)}</a>
      </td>
    </tr>`;

  const footerHtml = `
    <tr>
      <td style="padding:0 40px 30px;text-align:center;">
        <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.7;">${esc(t.fermInfo)}</p>
      </td>
    </tr>`;

  const html = guscioResa({
    tema,
    nome: dati.nome,
    logo: (tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL,
    dir: lang === "ar" ? "rtl" : "ltr",
    title: t.fermTitle,
    lead: t.fermLead(esc(nome)),
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
      subject: t.fermSubject(dati.nome),
      bcc: BCC,
      html: avvolgiTema(html, tema, lang === "ar" ? "rtl" : "ltr"),
    });
  } catch (e) {
    console.error("Errore email chiusura prenotazione:", e);
  }
}

/** Email di NOTIFICA al ristorante (FR, design chiaro operativo). */

// ---- Guscio condiviso delle notifiche PRENOTAZIONE al ristoratore ----
// Design volutamente DIVERSO dagli ordini (card chiara, centrata sui coperti,
// niente prezzi) + nastro colorato per tipo: verde=nuova, ambra=modifica,
// rosso=annullo. Colori fissi (non seguono il tema del cliente).
function compattaData(iso: string): { dateBig: string; year: string } {
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return { dateBig: iso, year: "" };
  return { dateBig: d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" }), year: String(d.getFullYear()) };
}
function detRigaResto(lab: string, val: string): string {
  if (!val) return "";
  return `<tr><td style="padding:9px 0;border-bottom:1px solid #eee;color:#666;font-size:14px;">${esc(lab)}</td><td style="padding:9px 0;border-bottom:1px solid #eee;color:#000;font-size:14px;text-align:right;font-weight:bold;">${esc(val)}</td></tr>`;
}
function notaResto(note?: string | null): string {
  return note ? `<div style="margin-top:14px;background:#fff4e0;border-left:4px solid #d8851b;padding:12px 16px;color:#7a4a09;font-size:14px;border-radius:0 8px 8px 0;"><strong>Note :</strong> ${esc(note)}</div>` : "";
}
function opzioniResa(r: ResaEmail): string {
  const o: string[] = [];
  if (r.high_chair) o.push("Chaise bébé");
  if (r.quiet) o.push("Endroit calme");
  if (r.business) o.push("Repas d'affaires" + (r.company ? ` (${r.company})` : ""));
  if (r.birthday) o.push("Anniversaire");
  if (r.special_event) o.push("Événement spécial");
  return o.join(" · ");
}
function guscioResaRisto(o: {
  accent: string; label: string; dataFr: string;
  subBanner: string; subBg: string; subText: string;
  nome: string; people: number; phone: string; email: string; telLink: string;
  dateBig: string; year: string; heure: string; serviceLabel: string;
  detailRows: string; noteHtml: string; nomeRisto: string;
}): string {
  const callBtn = o.telLink
    ? `<a href="tel:${o.telLink}" style="display:inline-block;margin-top:2px;background:${o.accent};color:#ffffff;text-decoration:none;padding:12px 28px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:999px;">Appeler le client</a>`
    : "";
  const sub = o.subBanner
    ? `<tr><td style="padding:13px 30px;background:${o.subBg};border-bottom:2px solid ${o.accent};"><p style="margin:0;color:${o.subText};font-size:14px;font-weight:bold;text-align:center;">${esc(o.subBanner)}</p></td></tr>`
    : "";
  const svcTile = o.serviceLabel
    ? `<td width="4%">&nbsp;</td><td width="28%" valign="middle" style="background:#ffffff;border:1px solid #e6e6e2;border-radius:12px;padding:14px 10px;text-align:center;"><p style="margin:0;color:${o.accent};font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Service</p><p style="margin:6px 0 0;color:#111;font-size:16px;font-weight:bold;line-height:1.2;">${esc(o.serviceLabel)}</p></td>`
    : "";
  const dateW = o.serviceLabel ? "40%" : "48%";
  const heureW = o.serviceLabel ? "28%" : "48%";
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#e8e6e1;padding:30px 14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:18px 30px;background:${o.accent};">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:14px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${esc(o.label)}</td>
            <td style="color:rgba(255,255,255,0.8);font-size:13px;text-align:right;">${esc(o.dataFr)}</td>
          </tr></table>
        </td>
      </tr>
      ${sub}
      <tr>
        <td style="padding:26px 30px 16px;text-align:center;background:#f6f7f5;">
          <p style="margin:0;color:#000;font-size:23px;font-weight:bold;">${esc(o.nome)} <span style="display:inline-block;margin-left:6px;background:${o.accent};color:#fff;font-size:13px;font-weight:bold;padding:4px 12px;border-radius:999px;vertical-align:middle;">${o.people} couverts</span></p>
          <p style="margin:8px 0 ${callBtn ? "16px" : "0"};color:#555;font-size:14px;">${esc(o.phone)} · ${esc(o.email)}</p>
          ${callBtn}
        </td>
      </tr>
      <tr>
        <td style="padding:6px 24px 22px;background:#f6f7f5;border-bottom:1px solid #e6e6e2;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="${dateW}" valign="middle" style="background:#ffffff;border:1px solid #e6e6e2;border-radius:12px;padding:14px 10px;text-align:center;">
              <p style="margin:0;color:${o.accent};font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Date</p>
              <p style="margin:6px 0 0;color:#111;font-size:17px;font-weight:bold;line-height:1.2;">${esc(o.dateBig)}</p>
              ${o.year ? `<p style="margin:1px 0 0;color:#888;font-size:12px;">${esc(o.year)}</p>` : ""}
            </td>
            <td width="4%">&nbsp;</td>
            <td width="${heureW}" valign="middle" style="background:#ffffff;border:1px solid #e6e6e2;border-radius:12px;padding:14px 10px;text-align:center;">
              <p style="margin:0;color:${o.accent};font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Heure</p>
              <p style="margin:6px 0 0;color:#111;font-size:20px;font-weight:bold;line-height:1;">${esc(o.heure)}</p>
            </td>
            ${svcTile}
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 30px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${o.detailRows}</table>
          ${o.noteHtml}
        </td>
      </tr>
      <tr><td style="padding:14px 30px 22px;text-align:center;background:#f6f7f5;border-top:1px solid #e6e6e2;color:#9a9a94;font-size:12px;">Réservation · ${esc(o.nomeRisto)}</td></tr>
    </table>
  </div>
  `;
}

async function emailNotificaResa(r: ResaEmail): Promise<void> {
  const dest = await resaNotifyEmail();
  const from = await resaFromEmail();
  if (!resend || !from || !dest) {
    console.warn("Resend/notify prenotazioni non configurati: salto notifica ristorante");
    return;
  }
  const dati = await datiRistorante();
  const servFr = labelService(r.service_key, "fr");
  const dataFr = fmtDataResa(r.date, "fr");
  const { dateBig, year } = compattaData(r.date);
  const nomeCompleto = `${r.first_name} ${r.last_name}`.trim();
  const telLink = (r.phone ?? "").replace(/[^+\d]/g, "");
  const detailRows = detRigaResto("Section", r.zone ?? "") + detRigaResto("Options", opzioniResa(r));

  const html = guscioResaRisto({
    accent: "#0e7a5f",
    label: "Nouvelle réservation",
    dataFr,
    subBanner: "",
    subBg: "",
    subText: "",
    nome: nomeCompleto,
    people: r.people,
    phone: r.phone,
    email: r.email,
    telLink,
    dateBig,
    year,
    heure: r.heure,
    serviceLabel: servFr,
    detailRows,
    noteHtml: notaResto(r.notes),
    nomeRisto: dati.nome,
  });

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

/** Email di NOTIFICA al ristorante quando il CLIENTE annulla (FR, tema rosso). */
export async function emailNotificaAnnulloResa(r: ResaEmail): Promise<void> {
  const dest = await resaNotifyEmail();
  const from = await resaFromEmail();
  if (!resend || !from || !dest) {
    console.warn("Resend/notify prenotazioni non configurati: salto notifica annullo");
    return;
  }
  const dati = await datiRistorante();
  const servFr = labelService(r.service_key, "fr");
  const dataFr = fmtDataResa(r.date, "fr");
  const { dateBig, year } = compattaData(r.date);
  const nomeCompleto = `${r.first_name} ${r.last_name}`.trim();
  const telLink = (r.phone ?? "").replace(/[^+\d]/g, "");
  const detailRows = detRigaResto("Section", r.zone ?? "") + detRigaResto("Options", opzioniResa(r));

  const html = guscioResaRisto({
    accent: "#b23b30",
    label: "Réservation annulée",
    dataFr,
    subBanner: "Annulée par le client",
    subBg: "#fdecea",
    subText: "#8f2d22",
    nome: nomeCompleto,
    people: r.people,
    phone: r.phone,
    email: r.email,
    telLink,
    dateBig,
    year,
    heure: r.heure,
    serviceLabel: servFr,
    detailRows,
    noteHtml: notaResto(r.notes),
    nomeRisto: dati.nome,
  });

  try {
    await resend.emails.send({
      from,
      to: dest.split(",").map((e) => e.trim()).filter(Boolean),
      bcc: BCC,
      subject: `Réservation annulée — ${dataFr} ${r.heure} · ${r.people} pers.`,
      html,
    });
  } catch (e) {
    console.error("Errore email notifica annullo ristorante:", e);
  }
}

/** Dati minimi di un buono regalo per le email. */
export interface BonEmail {
  code: string;
  initial_cents: number;
  expires_at?: string | null;
  recipient_name?: string | null;
  sender_name?: string | null;
  message?: string | null;
  ship?: boolean;
  ship_address?: string | null;
  ship_zip?: string | null;
  ship_city?: string | null;
  ship_country?: string | null;
  shipping_cents?: number | null;
  pay_url?: string | null;
  pdf_url?: string | null;
  paid?: boolean;
  // #70: lingue scelte nel modale (fallback = default pubblico)
  sender_lang?: string | null;
  recipient_lang?: string | null;
  // letti per l'email al ristoratore (presenti nel meta del buono)
  recipient_email?: string | null;
  sender_email?: string | null;
  payment_method?: string | null;
}

function euroCents(c: number): string {
  return (Math.round(Number(c) || 0) / 100).toFixed(2).replace(".", ",") + " €";
}

/**
 * Email di un BUONO REGALO (design dark brand).
 * `a`: "destinataire" = a chi riceve il regalo · "offrant" = copia a chi l'offre.
 * Non lancia mai eccezioni.
 */
type LangBon = "fr" | "en" | "it" | "nl" | "es";
const LANGS_BON: LangBon[] = ["fr", "en", "it", "nl", "es"];
function norm5(l: unknown): LangBon | "" {
  if (typeof l !== "string") return "";
  const c = l.trim().toLowerCase();
  return (LANGS_BON as string[]).includes(c) ? (c as LangBon) : "";
}
/** Lingua effettiva del buono: quella scelta, altrimenti default pubblico del sito. */
async function linguaBon(scelta: unknown): Promise<LangBon> {
  const s = norm5(scelta);
  if (s) return s;
  try { return norm5((await caricaBootAdmin()).publicLangDefault) || "fr"; } catch { return "fr"; }
}

interface TxtBon {
  subjDest: (resto: string, val: string) => string;
  subjOffr: (code: string) => string;
  titleDest: string;
  titleOffr: string;
  leadDestWith: (senderHtml: string, resto: string) => string;
  leadDestNo: (resto: string) => string;
  leadOffrWith: (recHtml: string) => string;
  leadOffrNo: string;
  votreCode: string;
  valeur: string;
  aUtiliser: string;
  fraisEnvoi: string;
  envoiPostal: string;
  payer: string;
  payerHint: string;
  pending: string;
  pendingHint: string;
  telecharger: string;
  footNote: string;
  valable: (date: string) => string;
}

const TXT_BON: Record<LangBon, TxtBon> = {
  fr: { subjDest: (r, v) => `Votre bon cadeau ${r} — ${v}`, subjOffr: (c) => `Bon cadeau créé — ${c}`, titleDest: "Votre bon cadeau", titleOffr: "Votre bon cadeau a été créé", leadDestWith: (s, r) => `Bonne nouvelle&nbsp;! ${s} vous offre un bon cadeau à utiliser chez ${r}.`, leadDestNo: (r) => `Vous avez reçu un bon cadeau à utiliser chez ${r}.`, leadOffrWith: (n) => `Voici le récapitulatif du bon cadeau destiné à ${n}.`, leadOffrNo: "Voici le récapitulatif de votre bon cadeau.", votreCode: "Votre code", valeur: "Valeur", aUtiliser: "À utiliser avant le", fraisEnvoi: "Frais d'envoi", envoiPostal: "Envoi postal", payer: "Payer maintenant", payerHint: "Le bon sera activé dès réception du paiement.", pending: "Paiement en attente", pendingHint: "Le restaurant vous transmettra le lien de paiement ; le bon sera activé dès réception.", telecharger: "Télécharger le PDF", footNote: "Présentez ce code sur place ou saisissez-le lors de votre commande en ligne.", valable: (d) => ` Valable jusqu'au ${d}.` },
  en: { subjDest: (r, v) => `Your gift card ${r} — ${v}`, subjOffr: (c) => `Gift card created — ${c}`, titleDest: "Your gift card", titleOffr: "Your gift card has been created", leadDestWith: (s, r) => `Good news! ${s} is giving you a gift card to use at ${r}.`, leadDestNo: (r) => `You have received a gift card to use at ${r}.`, leadOffrWith: (n) => `Here is the summary of the gift card for ${n}.`, leadOffrNo: "Here is the summary of your gift card.", votreCode: "Your code", valeur: "Value", aUtiliser: "Valid until", fraisEnvoi: "Shipping fee", envoiPostal: "Postal delivery", payer: "Pay now", payerHint: "The card will be activated once payment is received.", pending: "Payment pending", pendingHint: "The restaurant will send you the payment link; the card will be activated once received.", telecharger: "Download the PDF", footNote: "Show this code on site or enter it when ordering online.", valable: (d) => ` Valid until ${d}.` },
  it: { subjDest: (r, v) => `Il tuo buono regalo ${r} — ${v}`, subjOffr: (c) => `Buono regalo creato — ${c}`, titleDest: "Il tuo buono regalo", titleOffr: "Il tuo buono regalo è stato creato", leadDestWith: (s, r) => `Buona notizia! ${s} ti offre un buono regalo da usare da ${r}.`, leadDestNo: (r) => `Hai ricevuto un buono regalo da usare da ${r}.`, leadOffrWith: (n) => `Ecco il riepilogo del buono regalo destinato a ${n}.`, leadOffrNo: "Ecco il riepilogo del tuo buono regalo.", votreCode: "Il tuo codice", valeur: "Valore", aUtiliser: "Da usare entro il", fraisEnvoi: "Spese di spedizione", envoiPostal: "Spedizione postale", payer: "Paga ora", payerHint: "Il buono sarà attivato alla ricezione del pagamento.", pending: "Pagamento in attesa", pendingHint: "Il ristorante ti invierà il link di pagamento; il buono sarà attivato alla ricezione.", telecharger: "Scarica il PDF", footNote: "Presenta questo codice sul posto o inseriscilo al momento dell'ordine online.", valable: (d) => ` Valido fino al ${d}.` },
  nl: { subjDest: (r, v) => `Je cadeaubon ${r} — ${v}`, subjOffr: (c) => `Cadeaubon aangemaakt — ${c}`, titleDest: "Je cadeaubon", titleOffr: "Je cadeaubon is aangemaakt", leadDestWith: (s, r) => `Goed nieuws! ${s} biedt je een cadeaubon aan om te gebruiken bij ${r}.`, leadDestNo: (r) => `Je hebt een cadeaubon ontvangen om te gebruiken bij ${r}.`, leadOffrWith: (n) => `Hier is het overzicht van de cadeaubon bestemd voor ${n}.`, leadOffrNo: "Hier is het overzicht van je cadeaubon.", votreCode: "Je code", valeur: "Waarde", aUtiliser: "Te gebruiken vóór", fraisEnvoi: "Verzendkosten", envoiPostal: "Verzending per post", payer: "Nu betalen", payerHint: "De bon wordt geactiveerd zodra de betaling is ontvangen.", pending: "Betaling in afwachting", pendingHint: "Het restaurant stuurt je de betaallink; de bon wordt geactiveerd zodra deze is ontvangen.", telecharger: "Download de PDF", footNote: "Toon deze code ter plaatse of voer hem in bij je online bestelling.", valable: (d) => ` Geldig tot ${d}.` },
  es: { subjDest: (r, v) => `Tu tarjeta regalo ${r} — ${v}`, subjOffr: (c) => `Tarjeta regalo creada — ${c}`, titleDest: "Tu tarjeta regalo", titleOffr: "Tu tarjeta regalo ha sido creada", leadDestWith: (s, r) => `¡Buenas noticias! ${s} te ofrece una tarjeta regalo para usar en ${r}.`, leadDestNo: (r) => `Has recibido una tarjeta regalo para usar en ${r}.`, leadOffrWith: (n) => `Aquí tienes el resumen de la tarjeta regalo destinada a ${n}.`, leadOffrNo: "Aquí tienes el resumen de tu tarjeta regalo.", votreCode: "Tu código", valeur: "Valor", aUtiliser: "Usar antes del", fraisEnvoi: "Gastos de envío", envoiPostal: "Envío postal", payer: "Pagar ahora", payerHint: "La tarjeta se activará al recibir el pago.", pending: "Pago pendiente", pendingHint: "El restaurante te enviará el enlace de pago; la tarjeta se activará al recibirlo.", telecharger: "Descargar el PDF", footNote: "Muestra este código en el local o introdúcelo al hacer tu pedido online.", valable: (d) => ` Válido hasta el ${d}.` },
};

export async function emailBonCadeau(bon: BonEmail, a: "destinataire" | "offrant", dest: string): Promise<void> {
  if (!resend || !RESEND_FROM || !dest) {
    console.warn("Resend non configurato: salto l'email du bon cadeau");
    return;
  }
  const perDest = a === "destinataire";
  const L = TXT_BON[await linguaBon(perDest ? bon.recipient_lang : bon.sender_lang)];
  const dati = await datiRistorante();
  const tema = await temaEmail();
  const nomeDest = String(bon.recipient_name ?? "").trim();
  const nomeOffr = String(bon.sender_name ?? "").trim();
  const scadenza = bon.expires_at ? String(bon.expires_at).split("-").reverse().join("/") : "";

  const title = perDest ? L.titleDest : L.titleOffr;
  const offrHtml = `<strong style="color:${tema.title};">${esc(nomeOffr)}</strong>`;
  const destHtml = `<strong style="color:${tema.title};">${esc(nomeDest)}</strong>`;
  const lead = perDest
    ? (nomeOffr ? L.leadDestWith(offrHtml, esc(dati.nome)) : L.leadDestNo(esc(dati.nome)))
    : (nomeDest ? L.leadOffrWith(destHtml) : L.leadOffrNo);

  const riga = (k: string, v: string) =>
    `<tr><td style="padding:12px 16px;border-bottom:1px solid ${tema.border};color:${tema.muted};font-size:14px;">${esc(k)}</td><td style="padding:12px 16px;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:14px;text-align:right;font-weight:bold;">${esc(v)}</td></tr>`;

  const righe = [
    riga(L.valeur, euroCents(bon.initial_cents)),
    scadenza ? riga(L.aUtiliser, scadenza) : "",
    bon.ship && bon.shipping_cents ? riga(L.fraisEnvoi, euroCents(bon.shipping_cents)) : "",
  ].join("");

  const indirizzoSped = bon.ship
    ? [bon.ship_address, [bon.ship_zip, bon.ship_city].filter(Boolean).join(" "), bon.ship_country].filter(Boolean).join(", ")
    : "";

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td class="em-pad" style="padding:40px 44px 8px;text-align:center;">
        <img src="${(tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL}" alt="${esc(dati.nome)}" width="160" style="display:inline-block;width:160px;max-width:62%;height:auto;border:0;" />
      </td></tr>
      <tr><td class="em-pad" style="padding:12px 44px 0;text-align:center;">
        <h1 style="margin:0;color:${tema.title};font-size:28px;letter-spacing:1px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${esc(title)}</h1>
        <p style="margin:16px 0 0;color:${tema.text};font-size:15px;line-height:1.6;">${lead}</p>
      </td></tr>
      <tr><td class="em-pad" style="padding:26px 44px 6px;text-align:center;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px dashed ${tema.accent};border-radius:12px;">
          <tr><td style="padding:22px 16px;text-align:center;">
            <p style="margin:0;color:${tema.muted};font-size:11px;letter-spacing:3px;text-transform:uppercase;">${esc(L.votreCode)}</p>
            <p style="margin:10px 0 0;color:${tema.accent};font-size:28px;letter-spacing:3px;font-weight:bold;">${esc(bon.code)}</p>
            <p style="margin:12px 0 0;color:${tema.title};font-size:22px;font-weight:bold;">${esc(euroCents(bon.initial_cents))}</p>
          </td></tr>
        </table>
      </td></tr>
      ${bon.message ? `<tr><td class="em-pad" style="padding:18px 44px 0;"><table role="presentation" width="100%" style="background:${tema.tint};border-left:3px solid ${tema.accent};border-radius:8px;"><tr><td style="padding:14px 18px;color:${tema.text};font-size:14px;font-style:italic;line-height:1.6;">« ${esc(bon.message)} »${nomeOffr ? `<br><span style="color:${tema.muted};font-style:normal;font-size:13px;">— ${esc(nomeOffr)}</span>` : ""}</td></tr></table></td></tr>` : ""}
      <tr><td class="em-pad" style="padding:20px 44px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.border};border-radius:8px;">
          ${righe}
        </table>
      </td></tr>
      ${indirizzoSped ? `<tr><td class="em-pad" style="padding:8px 44px 0;"><p style="margin:0;color:${tema.muted};font-size:13px;line-height:1.7;">${esc(L.envoiPostal)}&nbsp;: ${esc(indirizzoSped)}</p></td></tr>` : ""}
      ${
        !perDest && bon.pay_url
          ? `<tr><td class="em-pad" style="padding:22px 44px 4px;text-align:center;"><a href="${esc(bon.pay_url)}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;font-size:15px;font-weight:bold;padding:14px 34px;border-radius:999px;">${esc(L.payer)}</a><p style="margin:12px 0 0;color:${tema.muted};font-size:12px;">${esc(L.payerHint)}</p></td></tr>`
          : !perDest && bon.paid === false
            ? `<tr><td class="em-pad" style="padding:22px 44px 4px;text-align:center;"><p style="margin:0;color:${tema.accent};font-size:14px;font-weight:bold;">${esc(L.pending)}</p><p style="margin:8px 0 0;color:${tema.muted};font-size:12px;">${esc(L.pendingHint)}</p></td></tr>`
            : ""
      }
      ${
        perDest && bon.pdf_url
          ? `<tr><td class="em-pad" style="padding:22px 44px 4px;text-align:center;"><a href="${esc(bon.pdf_url)}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;font-size:15px;font-weight:bold;padding:14px 34px;border-radius:999px;">${esc(L.telecharger)}</a></td></tr>`
          : ""
      }
      <tr><td class="em-pad" style="padding:20px 44px 26px;text-align:center;">
        <p style="margin:0;color:${tema.muted};font-size:13px;line-height:1.7;">${esc(L.footNote)}${scadenza ? esc(L.valable(scadenza)) : ""}</p>
      </td></tr>
      <tr><td class="em-pad" style="padding:22px 44px;border-top:1px solid ${tema.border};text-align:center;">
        <p style="margin:0 0 12px;color:${tema.muted};font-size:12px;line-height:1.8;">${esc(dati.nome)}<br>${esc(dati.indirizzo ?? "")}</p>
        <img src="${SITE_URL.replace(/\/$/, "")}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="100" style="display:inline-block;width:100px;max-width:40%;height:auto;opacity:0.7;border:0;" />
      </td></tr>
    </table>
`;
  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: dest,
      bcc: BCC,
      subject: perDest ? L.subjDest(dati.nome, euroCents(bon.initial_cents)) : L.subjOffr(bon.code),
      html: avvolgiTema(html, tema),
    });
  } catch (e) {
    console.error("Errore email bon cadeau:", e);
  }
}

// ---- Email al RISTORATORE alla creazione di un buono (lingua ADMIN) ----
interface TxtBonAdmin {
  subject: (code: string) => string;
  title: string;
  intro: string;
  code: string; value: string; beneficiaire: string; offertPar: string;
  emailDest: string; emailOffr: string; paymentMethod: string; status: string;
  paid: string; unpaid: string; expiry: string; noExpiry: string; shipping: string; messageLbl: string;
  mCash: string; mCard: string; mLink: string;
}
const TXT_BON_ADMIN: Record<LangBon, TxtBonAdmin> = {
  fr: { subject: (c) => `Nouveau bon cadeau créé — ${c}`, title: "Nouveau bon cadeau", intro: "Un bon cadeau vient d'être créé. Voici le récapitulatif.", code: "Code", value: "Valeur", beneficiaire: "Bénéficiaire", offertPar: "Offert par", emailDest: "Email destinataire", emailOffr: "Email offrant", paymentMethod: "Paiement", status: "Statut", paid: "Payé", unpaid: "En attente de paiement", expiry: "Échéance", noExpiry: "Sans échéance", shipping: "Envoi postal", messageLbl: "Message", mCash: "Espèces", mCard: "Carte", mLink: "Lien de paiement" },
  en: { subject: (c) => `New gift card created — ${c}`, title: "New gift card", intro: "A gift card has just been created. Here is the summary.", code: "Code", value: "Value", beneficiaire: "Recipient", offertPar: "From", emailDest: "Recipient email", emailOffr: "Sender email", paymentMethod: "Payment", status: "Status", paid: "Paid", unpaid: "Awaiting payment", expiry: "Expiry", noExpiry: "No expiry", shipping: "Postal delivery", messageLbl: "Message", mCash: "Cash", mCard: "Card", mLink: "Payment link" },
  it: { subject: (c) => `Nuovo buono regalo creato — ${c}`, title: "Nuovo buono regalo", intro: "È stato appena creato un buono regalo. Ecco il riepilogo.", code: "Codice", value: "Valore", beneficiaire: "Destinatario", offertPar: "Offerto da", emailDest: "Email destinatario", emailOffr: "Email offerente", paymentMethod: "Pagamento", status: "Stato", paid: "Pagato", unpaid: "In attesa di pagamento", expiry: "Scadenza", noExpiry: "Senza scadenza", shipping: "Spedizione postale", messageLbl: "Messaggio", mCash: "Contanti", mCard: "Carta", mLink: "Link di pagamento" },
  nl: { subject: (c) => `Nieuwe cadeaubon aangemaakt — ${c}`, title: "Nieuwe cadeaubon", intro: "Er is zojuist een cadeaubon aangemaakt. Hier is het overzicht.", code: "Code", value: "Waarde", beneficiaire: "Begunstigde", offertPar: "Aangeboden door", emailDest: "E-mail begunstigde", emailOffr: "E-mail aanbieder", paymentMethod: "Betaling", status: "Status", paid: "Betaald", unpaid: "In afwachting van betaling", expiry: "Vervaldatum", noExpiry: "Geen vervaldatum", shipping: "Verzending per post", messageLbl: "Bericht", mCash: "Contant", mCard: "Kaart", mLink: "Betaallink" },
  es: { subject: (c) => `Nueva tarjeta regalo creada — ${c}`, title: "Nueva tarjeta regalo", intro: "Se acaba de crear una tarjeta regalo. Aquí tienes el resumen.", code: "Código", value: "Valor", beneficiaire: "Beneficiario", offertPar: "Ofrecido por", emailDest: "Email destinatario", emailOffr: "Email ofertante", paymentMethod: "Pago", status: "Estado", paid: "Pagado", unpaid: "Pendiente de pago", expiry: "Vencimiento", noExpiry: "Sin vencimiento", shipping: "Envío postal", messageLbl: "Mensaje", mCash: "Efectivo", mCard: "Tarjeta", mLink: "Enlace de pago" },
};

/** Indirizzo email del ristoratore per le notifiche (notify > contact > public > CLIENT). */
async function emailRistoratore(): Promise<string> {
  try {
    const { data } = await supabaseAdmin.from("app_config").select("key, value").in("key", ["reservation_notify_email", "contact_emails", "public_email"]);
    const m = new Map((data ?? []).map((r) => [r.key, String(r.value ?? "").trim()]));
    const notif = m.get("reservation_notify_email");
    if (notif) return notif;
    const contact = (m.get("contact_emails") ?? "").split(",").map((e) => e.trim()).filter(Boolean)[0];
    if (contact) return contact;
    const pub = m.get("public_email");
    if (pub) return pub;
  } catch { /* best-effort */ }
  return CLIENT.email || "";
}

/** Notifica al ristoratore: un buono e' stato creato (lingua ADMIN). Best-effort. */
export async function emailBonRistoratore(bon: BonEmail): Promise<void> {
  const dest = await emailRistoratore();
  if (!resend || !RESEND_FROM || !dest) {
    console.warn("Resend/email ristoratore non configurati: salto notifica bon");
    return;
  }
  const L = TXT_BON_ADMIN[norm5(await adminLang()) || "fr"];
  const dati = await datiRistorante();
  const tema = await temaEmail();
  const scadenza = bon.expires_at ? String(bon.expires_at).split("-").reverse().join("/") : "";
  const metodo = bon.payment_method === "card" ? L.mCard : bon.payment_method === "link" ? L.mLink : L.mCash;
  const statoPag = bon.paid === false ? L.unpaid : L.paid;

  const riga = (k: string, v: string) =>
    v ? `<tr><td style="padding:12px 16px;border-bottom:1px solid ${tema.border};color:${tema.muted};font-size:14px;">${esc(k)}</td><td style="padding:12px 16px;border-bottom:1px solid ${tema.border};color:${tema.title};font-size:14px;text-align:right;font-weight:bold;">${esc(v)}</td></tr>` : "";

  const righe = [
    riga(L.code, bon.code),
    riga(L.value, euroCents(bon.initial_cents)),
    riga(L.beneficiaire, String(bon.recipient_name ?? "")),
    riga(L.emailDest, String(bon.recipient_email ?? "")),
    riga(L.offertPar, String(bon.sender_name ?? "")),
    riga(L.emailOffr, String(bon.sender_email ?? "")),
    riga(L.paymentMethod, metodo),
    riga(L.status, statoPag),
    riga(L.expiry, scadenza || L.noExpiry),
    bon.ship && bon.shipping_cents ? riga(L.shipping, euroCents(bon.shipping_cents)) : "",
  ].join("");

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td class="em-pad" style="padding:36px 44px 0;text-align:center;">
        <h1 style="margin:0;color:${tema.title};font-size:24px;letter-spacing:1px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${esc(L.title)}</h1>
        <p style="margin:14px 0 0;color:${tema.text};font-size:15px;line-height:1.6;">${esc(L.intro)}</p>
      </td></tr>
      <tr><td class="em-pad" style="padding:22px 44px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.border};border-radius:8px;">
          ${righe}
        </table>
      </td></tr>
      ${bon.message ? `<tr><td class="em-pad" style="padding:12px 44px 0;"><table role="presentation" width="100%" style="background:${tema.tint};border-left:3px solid ${tema.accent};border-radius:8px;"><tr><td style="padding:14px 18px;color:${tema.text};font-size:14px;font-style:italic;line-height:1.6;">${esc(L.messageLbl)}: « ${esc(bon.message)} »</td></tr></table></td></tr>` : ""}
      <tr><td class="em-pad" style="padding:22px 44px;border-top:1px solid ${tema.border};text-align:center;">
        <p style="margin:0 0 12px;color:${tema.muted};font-size:12px;line-height:1.8;">${esc(dati.nome)}</p>
        <img src="${SITE_URL.replace(/\/$/, "")}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="100" style="display:inline-block;width:100px;max-width:40%;height:auto;opacity:0.7;border:0;" />
      </td></tr>
    </table>
`;
  try {
    await resend.emails.send({ from: RESEND_FROM, to: dest, bcc: BCC, subject: L.subject(bon.code), html: avvolgiTema(html, tema) });
  } catch (e) {
    console.error("Errore email bon ristoratore:", e);
  }
}

/** Email di NOTIFICA al ristorante quando il CLIENTE modifica (FR, tema bleu). */
export async function emailNotificaModificaResa(r: ResaEmail): Promise<void> {
  const dest = await resaNotifyEmail();
  const from = await resaFromEmail();
  if (!resend || !from || !dest) {
    console.warn("Resend/notify prenotazioni non configurati: salto notifica modifica");
    return;
  }
  const dati = await datiRistorante();
  const servFr = labelService(r.service_key, "fr");
  const dataFr = fmtDataResa(r.date, "fr");
  const { dateBig, year } = compattaData(r.date);
  const nomeCompleto = `${r.first_name} ${r.last_name}`.trim();
  const telLink = (r.phone ?? "").replace(/[^+\d]/g, "");
  const detailRows = detRigaResto("Section", r.zone ?? "") + detRigaResto("Options", opzioniResa(r));

  const html = guscioResaRisto({
    accent: "#b5701a",
    label: "Réservation modifiée",
    dataFr,
    subBanner: "Modifiée par le client · nouvelles informations ci-dessous",
    subBg: "#fdf1df",
    subText: "#8a5410",
    nome: nomeCompleto,
    people: r.people,
    phone: r.phone,
    email: r.email,
    telLink,
    dateBig,
    year,
    heure: r.heure,
    serviceLabel: servFr,
    detailRows,
    noteHtml: notaResto(r.notes),
    nomeRisto: dati.nome,
  });

  try {
    await resend.emails.send({
      from,
      to: dest.split(",").map((e) => e.trim()).filter(Boolean),
      bcc: BCC,
      subject: `Réservation modifiée — ${dataFr} ${r.heure} · ${r.people} pers.`,
      html,
    });
  } catch (e) {
    console.error("Errore email notifica modifica ristorante:", e);
  }
}

/**
 * Invia le notifiche di una nuova prenotazione dal widget: conferma al
 * cliente + notifica al ristorante. Non lancia mai eccezioni.
 */
type TxtNoShow = {
  subject: (n: string) => string;
  title: string;
  lead: (name: string) => string;
  p1: string;
  p2: string;
  p3: string;
};
const TXT_NOSHOW: Record<string, TxtNoShow> = {
  fr: {
    subject: (n) => `Réservation non honorée — ${n}`,
    title: "Réservation non honorée",
    lead: (name) => `Bonjour ${name},<br>vous ne vous êtes pas présenté à votre réservation, et nous n'en avons pas été prévenus.`,
    p1: "Une table vous était réservée et est restée inoccupée. Un imprévu peut toujours arriver : un simple message pour annuler ou décaler votre venue nous aurait permis d'en faire profiter d'autres clients.",
    p2: "Par respect pour notre équipe et pour les clients en liste d'attente, nous accordons la priorité aux personnes qui honorent leur réservation ou nous préviennent à temps.",
    p3: "Nous restons bien sûr heureux de vous accueillir à l'avenir, et vous remercions de votre compréhension.",
  },
  en: {
    subject: (n) => `Missed reservation — ${n}`,
    title: "Reservation not honoured",
    lead: (name) => `Hello ${name},<br>you did not show up for your reservation, and we were not informed.`,
    p1: "A table was reserved for you and remained empty. Something unexpected can always happen: a simple message to cancel or postpone would have allowed us to offer the table to other guests.",
    p2: "Out of respect for our team and for guests on the waiting list, we give priority to those who honour their reservation or let us know in time.",
    p3: "We will of course be glad to welcome you in the future, and thank you for your understanding.",
  },
  it: {
    subject: (n) => `Prenotazione non rispettata — ${n}`,
    title: "Prenotazione non rispettata",
    lead: (name) => `Ciao ${name},<br>non ti sei presentato alla tua prenotazione e non siamo stati avvisati.`,
    p1: "Un tavolo era riservato per te ed è rimasto vuoto. Un imprevisto può sempre capitare: un semplice messaggio per annullare o spostare la prenotazione ci avrebbe permesso di offrirlo ad altri clienti.",
    p2: "Per rispetto verso il nostro team e verso i clienti in lista d'attesa, diamo la priorità a chi rispetta la prenotazione o ci avvisa in tempo.",
    p3: "Restiamo naturalmente felici di accoglierti in futuro e ti ringraziamo per la comprensione.",
  },
  es: {
    subject: (n) => `Reserva no cumplida — ${n}`,
    title: "Reserva no cumplida",
    lead: (name) => `Hola ${name},<br>no se presentó a su reserva y no se nos avisó.`,
    p1: "Le habíamos reservado una mesa y quedó vacía. Siempre puede surgir un imprevisto: un simple mensaje para cancelar o aplazar nos habría permitido ofrecerla a otros clientes.",
    p2: "Por respeto a nuestro equipo y a los clientes en lista de espera, damos prioridad a quienes cumplen su reserva o nos avisan a tiempo.",
    p3: "Estaremos encantados de recibirle en el futuro y le agradecemos su comprensión.",
  },
  nl: {
    subject: (n) => `Reservering niet nagekomen — ${n}`,
    title: "Reservering niet nagekomen",
    lead: (name) => `Hallo ${name},<br>je bent niet op je reservering verschenen en we zijn niet op de hoogte gebracht.`,
    p1: "Er was een tafel voor je gereserveerd die leeg is gebleven. Er kan altijd iets tussenkomen: een kort bericht om te annuleren of te verzetten had ons de kans gegeven de tafel aan andere gasten aan te bieden.",
    p2: "Uit respect voor ons team en voor de gasten op de wachtlijst geven we voorrang aan wie zijn reservering nakomt of ons op tijd verwittigt.",
    p3: "We verwelkomen je uiteraard graag in de toekomst en danken je voor je begrip.",
  },
  de: {
    subject: (n) => `Nicht wahrgenommene Reservierung — ${n}`,
    title: "Reservierung nicht wahrgenommen",
    lead: (name) => `Hallo ${name},<br>Sie sind nicht zu Ihrer Reservierung erschienen und wir wurden nicht informiert.`,
    p1: "Ein Tisch war für Sie reserviert und blieb leer. Es kann immer etwas dazwischenkommen: Eine kurze Nachricht zum Absagen oder Verschieben hätte uns erlaubt, den Tisch anderen Gästen anzubieten.",
    p2: "Aus Respekt vor unserem Team und den Gästen auf der Warteliste bevorzugen wir Gäste, die ihre Reservierung einhalten oder uns rechtzeitig Bescheid geben.",
    p3: "Wir freuen uns natürlich, Sie künftig begrüßen zu dürfen, und danken Ihnen für Ihr Verständnis.",
  },
  ru: {
    subject: (n) => `Несостоявшийся визит — ${n}`,
    title: "Бронь не была соблюдена",
    lead: (name) => `Здравствуйте, ${name}!<br>Вы не пришли на бронь, и нас об этом не предупредили.`,
    p1: "Для вас был зарезервирован столик, который остался свободным. Всякое бывает: короткое сообщение об отмене или переносе позволило бы нам предложить столик другим гостям.",
    p2: "Из уважения к нашей команде и к гостям в листе ожидания мы отдаём приоритет тем, кто соблюдает бронь или предупреждает заранее.",
    p3: "Мы, конечно, будем рады видеть вас снова и благодарим за понимание.",
  },
  ar: {
    subject: (n) => `حجز لم يُحترم — ${n}`,
    title: "حجز لم يُحترم",
    lead: (name) => `مرحباً ${name}،<br>لم تحضر إلى حجزك ولم يتم إبلاغنا بذلك.`,
    p1: "كانت هناك طاولة محجوزة لك وبقيت فارغة. قد يطرأ أمر غير متوقع دائماً: رسالة بسيطة للإلغاء أو التأجيل كانت ستتيح لنا تقديمها لضيوف آخرين.",
    p2: "احتراماً لفريقنا وللضيوف على قائمة الانتظار، نمنح الأولوية لمن يحترمون حجزهم أو يبلغوننا في الوقت المناسب.",
    p3: "يسعدنا بالطبع الترحيب بك مستقبلاً، ونشكرك على تفهّمك.",
  },
  zh: {
    subject: (n) => `未如约就餐 — ${n}`,
    title: "预订未如约",
    lead: (name) => `您好 ${name}，<br>您未按预订前来，也未提前告知我们。`,
    p1: "我们为您保留了餐桌，但一直空着。突发情况在所难免：一条简单的取消或改期消息，就能让我们把餐桌留给其他客人。",
    p2: "出于对团队和候补客人的尊重，我们会优先接待遵守预订或及时告知的客人。",
    p3: "我们当然欢迎您日后再次光临，并感谢您的理解。",
  },
  ja: {
    subject: (n) => `ご予約の不履行について — ${n}`,
    title: "ご予約の不履行",
    lead: (name) => `${name} 様、<br>ご予約にお越しにならず、ご連絡もいただけませんでした。`,
    p1: "お席をご用意しておりましたが、空いたままとなりました。急な事情はどなたにもございます。キャンセルや変更のひとことをいただければ、他のお客様にご案内できました。",
    p2: "スタッフおよびキャンセル待ちのお客様への配慮から、ご予約を守ってくださる方、また早めにご連絡くださる方を優先しております。",
    p3: "今後のご来店を心よりお待ちしております。ご理解に感謝申し上げます。",
  },
};

/** Email formale al cliente quando la prenotazione è messa in NO-SHOW.
 *  Tono rispettoso ma fermo. Nessun bottone. Stesso guscio a tema. */
export async function emailNoShowResa(r: ResaEmail): Promise<void> {
  const from = await resaFromEmail();
  if (!resend || !from || !r.email) {
    console.warn("Resend non configurato: salto email no-show");
    return;
  }
  const lang = lw(r.lang);
  const w = TESTI_WIDGET[lang];
  const t = TXT_NOSHOW[lang] ?? TXT_NOSHOW.fr;
  const dati = await datiRistorante();
  const tema = await temaEmail();
  const nome = r.first_name.trim() || r.last_name.trim() || "";

  const recap =
    rigaRecap(tema, w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(tema, w.heure, r.heure) +
    rigaRecap(tema, w.personnes, `${r.people} ${w.pers}`) +
    (r.zone ? rigaRecap(tema, w.section, r.zone) : "");

  const footerHtml = `
    <tr>
      <td class="em-pad" style="padding:20px 44px 30px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.tintBorder};border-radius:12px;background:${tema.tint};">
          <tr><td style="padding:20px 24px;">
            <p style="margin:0;color:${tema.text};font-size:14.5px;line-height:1.75;">${t.p1}</p>
            <p style="margin:14px 0 0;color:${tema.text};font-size:14.5px;line-height:1.75;">${t.p2}</p>
            <p style="margin:14px 0 0;color:${tema.text};font-size:14.5px;line-height:1.75;">${t.p3}</p>
          </td></tr>
        </table>
      </td>
    </tr>`;

  const html = guscioResa({
    tema,
    nome: dati.nome,
    logo: (tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) || dati.logo || LOGO_URL,
    dir: lang === "ar" ? "rtl" : "ltr",
    title: t.title,
    lead: t.lead(esc(nome)),
    recapRows: recap,
    ctaHtml: "",
    footerHtml,
    indirizzo: dati.indirizzo,
    contatti: `${dati.tel} · ${dati.email}`,
  });

  try {
    await resend.emails.send({
      from,
      to: r.email,
      subject: t.subject(dati.nome),
      bcc: BCC,
      html: avvolgiTema(html, tema, lang === "ar" ? "rtl" : "ltr"),
    });
  } catch (e) {
    console.error("Errore email no-show:", e);
  }
}

export async function inviaNotificheResa(r: ResaEmail): Promise<void> {
  await Promise.allSettled([emailConfermaResa(r), emailNotificaResa(r)]);
}

/** Solo la conferma al cliente (usata dopo una MODIFICA della prenotazione). */
export async function inviaConfermaResa(r: ResaEmail): Promise<void> {
  await emailConfermaResa(r);
}

/**
 * Notifiche di una DEMANDE (auto-accept spento): email « demande reçue » al
 * cliente + notifica al ristorante. La conferma parte solo quando il
 * ristoratore passa la prenotazione a Confirmée.
 */
export async function inviaNotificheDemandeResa(r: ResaEmail): Promise<void> {
  await Promise.allSettled([emailDemandeResa(r), emailNotificaResa(r)]);
}
