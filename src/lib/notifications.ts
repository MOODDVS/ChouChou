import { Resend } from "resend";
import { DateTime } from "luxon";
import { supabaseAdmin } from "./db";
import { datiRistorante } from "./ristorante";
import { CLIENT } from "../config/client";
import { TESTI_WIDGET, SERVIZI_WIDGET, type LinguaWidget } from "./reservationI18n";
import { TIMEZONE } from "./slots";

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
  lang?: string;
}

function euro(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

/**
 * Notifiche dopo una MODIFICA di un ordine gia' PAGATO: conferma aggiornata al
 * cliente + ticket aggiornato in cucina (email + Slack). NIENTE email
 * recensione: quella e' programmata una volta alla creazione (11:30 del giorno
 * dopo) e richiamarla a ogni modifica creerebbe doppioni.
 */
export async function inviaModificaOrdine(
  o: OrdineNotifica,
  opts: { supplement_url?: string | null; supplement_cents?: number; refund_cents?: number } = {}
): Promise<void> {
  await Promise.allSettled([emailModificaCliente(o, opts), emailCucina(o), slackCucina(o)]);
}

/** Email di conferma al cliente (design dark brand). */
async function emailCliente(o: OrdineNotifica): Promise<void> {
  if (!resend || !RESEND_FROM) {
    console.warn("Resend non configurato: salto email cliente");
    return;
  }
  if (!o.customer_email?.trim()) return; // ordine pagato di persona senza email
  const t = pick5(TXT, o.lang);
  const { piatti, noteCliente } = separaItems(o);
  const ora = oraRitiro(o.pickup_time);
  const dati = await datiRistorante();

  const righeHtml = piatti
    .map(
      (i) => `
      <tr>
        <td style="padding:14px 24px;border-bottom:1px solid #0f434c;color:#ffffff;font-size:15px;font-family:Arial,Helvetica,sans-serif;">${i.qty}× ${esc(i.name)}</td>
        <td style="padding:14px 24px;border-bottom:1px solid #0f434c;color:#ffffff;font-size:15px;text-align:right;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;">${euro(i.price_cents * i.qty)}</td>
      </tr>`
    )
    .join("");

  const noteHtml = noteCliente
    ? `<tr><td colspan="2" style="padding:14px 24px;border-bottom:1px solid #0f434c;color:#8fb0b5;font-size:13px;font-family:Arial,Helvetica,sans-serif;"><strong style="color:#fff;">${t.note} :</strong> ${esc(noteCliente)}</td></tr>`
    : "";

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#00252b; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#002f35;border:1px solid #0f434c;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(dati.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#f04b4b;font-size:11px;letter-spacing:4px;font-family:Arial,Helvetica,sans-serif;">${esc((dati.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Arial,Helvetica,sans-serif;">${t.title}</h1>
          <p style="margin:16px 0 0;color:#8fb0b5;font-size:15px;line-height:1.6;">${t.intro(esc(o.customer_name), esc(o.numero))}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 40px 8px;text-align:center;">
          <p style="margin:0;color:#8fb0b5;font-size:12px;letter-spacing:2px;text-transform:uppercase;">${t.pickup}</p>
          <p style="margin:6px 0 0;color:#f04b4b;font-size:42px;line-height:1;font-family:Arial,Helvetica,sans-serif;">${ora}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #0f434c;">
            ${righeHtml}
            ${noteHtml}
            <tr>
              <td style="padding:16px 24px;color:#ffffff;font-size:17px;font-family:Arial,Helvetica,sans-serif;">${t.total}</td>
              <td style="padding:16px 24px;color:#f04b4b;font-size:19px;text-align:right;font-family:Arial,Helvetica,sans-serif;">${euro(o.total_cents)}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 4px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 24px;background:#f04b4b;"></div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 36px;text-align:center;">
          <a href="tel:${dati.telLink}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${t.callBtn}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #0f434c;text-align:center;">
          <p style="margin:0;color:#6f9096;font-size:12px;line-height:1.8;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
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
      bcc: BCC,
      html: avvolgiScuro(html),
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
  opts: { supplement_url?: string | null; supplement_cents?: number; refund_cents?: number }
): Promise<void> {
  if (!resend || !RESEND_FROM) {
    console.warn("Resend non configurato: salto email modifica");
    return;
  }
  if (!o.customer_email?.trim()) return;
  const t = pick5(TXT_MOD, o.lang);
  const { piatti, noteCliente } = separaItems(o);
  const ora = oraRitiro(o.pickup_time);
  const dati = await datiRistorante();

  const righeHtml = piatti
    .map(
      (i) => `
      <tr>
        <td style="padding:14px 24px;border-bottom:1px solid #0f434c;color:#ffffff;font-size:15px;font-family:Arial,Helvetica,sans-serif;">${i.qty}× ${esc(i.name)}</td>
        <td style="padding:14px 24px;border-bottom:1px solid #0f434c;color:#ffffff;font-size:15px;text-align:right;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;">${euro(i.price_cents * i.qty)}</td>
      </tr>`
    )
    .join("");
  const noteHtml = noteCliente
    ? `<tr><td colspan="2" style="padding:14px 24px;border-bottom:1px solid #0f434c;color:#8fb0b5;font-size:13px;font-family:Arial,Helvetica,sans-serif;"><strong style="color:#fff;">${t.note} :</strong> ${esc(noteCliente)}</td></tr>`
    : "";

  const suppCents = opts.supplement_cents ?? 0;
  const refCents = opts.refund_cents ?? 0;
  const blocco =
    suppCents > 0 && opts.supplement_url
      ? `
      <tr>
        <td style="padding:4px 40px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #7a4a12;background:#3a2708;">
            <tr>
              <td style="padding:20px 24px;text-align:center;">
                <p style="margin:0 0 6px;color:#ffcf8f;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">${t.supplTitle}</p>
                <p style="margin:0 0 16px;color:#ffffff;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${t.supplText(euro(suppCents))}</p>
                <a href="${opts.supplement_url}" style="display:inline-block;background:#f0a24b;color:#3a2708;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${t.payBtn}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
      : refCents > 0
        ? `
      <tr>
        <td style="padding:4px 40px 12px;text-align:center;">
          <p style="margin:0;color:#8fd6b0;font-size:14px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${t.refundText(euro(refCents))}</p>
        </td>
      </tr>`
        : "";

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#00252b; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#002f35;border:1px solid #0f434c;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(dati.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#f04b4b;font-size:11px;letter-spacing:4px;font-family:Arial,Helvetica,sans-serif;">${esc((dati.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Arial,Helvetica,sans-serif;">${t.title}</h1>
          <p style="margin:16px 0 0;color:#8fb0b5;font-size:15px;line-height:1.6;">${t.intro(esc(o.customer_name), esc(o.numero))}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 40px 8px;text-align:center;">
          <p style="margin:0;color:#8fb0b5;font-size:12px;letter-spacing:2px;text-transform:uppercase;">${t.pickup}</p>
          <p style="margin:6px 0 0;color:#f04b4b;font-size:42px;line-height:1;font-family:Arial,Helvetica,sans-serif;">${ora}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #0f434c;">
            ${righeHtml}
            ${noteHtml}
            <tr>
              <td style="padding:16px 24px;color:#ffffff;font-size:17px;font-family:Arial,Helvetica,sans-serif;">${t.total}</td>
              <td style="padding:16px 24px;color:#f04b4b;font-size:19px;text-align:right;font-family:Arial,Helvetica,sans-serif;">${euro(o.total_cents)}</td>
            </tr>
          </table>
        </td>
      </tr>
      ${blocco}
      <tr>
        <td style="padding:8px 40px 4px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 24px;background:#f04b4b;"></div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 36px;text-align:center;">
          <a href="tel:${dati.telLink}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${t.callBtn}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #0f434c;text-align:center;">
          <p style="margin:0;color:#6f9096;font-size:12px;line-height:1.8;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
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
      bcc: BCC,
      html: avvolgiScuro(html),
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
  if (!resend || !RESEND_FROM) {
    console.warn("Resend non configurato: salto email link di pagamento");
    return;
  }
  const t = pick5(TXT_PAY, o.lang);
  const { piatti, noteCliente } = separaItems(o);
  const ora = oraRitiro(o.pickup_time);
  const dati = await datiRistorante();

  const righeHtml = piatti
    .map(
      (i) => `
      <tr>
        <td style="padding:14px 24px;border-bottom:1px solid #0f434c;color:#ffffff;font-size:15px;font-family:Arial,Helvetica,sans-serif;">${i.qty}× ${esc(i.name)}</td>
        <td style="padding:14px 24px;border-bottom:1px solid #0f434c;color:#ffffff;font-size:15px;text-align:right;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;">${euro(i.price_cents * i.qty)}</td>
      </tr>`
    )
    .join("");
  const noteHtml = noteCliente
    ? `<tr><td colspan="2" style="padding:14px 24px;border-bottom:1px solid #0f434c;color:#8fb0b5;font-size:13px;font-family:Arial,Helvetica,sans-serif;"><strong style="color:#fff;">${t.note} :</strong> ${esc(noteCliente)}</td></tr>`
    : "";

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#00252b; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#002f35;border:1px solid #0f434c;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(dati.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#f04b4b;font-size:11px;letter-spacing:4px;font-family:Arial,Helvetica,sans-serif;">${esc((dati.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Arial,Helvetica,sans-serif;">${t.title}</h1>
          <p style="margin:16px 0 0;color:#8fb0b5;font-size:15px;line-height:1.6;">${t.intro(esc(o.customer_name), esc(o.numero))}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 40px 8px;text-align:center;">
          <p style="margin:0;color:#8fb0b5;font-size:12px;letter-spacing:2px;text-transform:uppercase;">${t.pickup}</p>
          <p style="margin:6px 0 0;color:#f04b4b;font-size:42px;line-height:1;font-family:Arial,Helvetica,sans-serif;">${ora}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #0f434c;">
            ${righeHtml}
            ${noteHtml}
            <tr>
              <td style="padding:16px 24px;color:#ffffff;font-size:17px;font-family:Arial,Helvetica,sans-serif;">${t.total}</td>
              <td style="padding:16px 24px;color:#f04b4b;font-size:19px;text-align:right;font-family:Arial,Helvetica,sans-serif;">${euro(o.total_cents)}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 8px;text-align:center;">
          <a href="${o.pay_url}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;padding:16px 40px;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${t.payBtn}</a>
          <p style="margin:14px 0 0;color:#6f9096;font-size:12px;">${t.valid}</p>
          ${o.cancel_url ? `<p style="margin:18px 0 0;"><a href="${o.cancel_url}" style="color:#ff8a8f;font-size:12px;text-decoration:underline;text-underline-offset:2px;">${t.cancelLink}</a></p>` : ""}
        </td>
      </tr>
      <tr>
        <td style="padding:20px 40px 4px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 24px;background:#f04b4b;"></div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 24px;text-align:center;">
          <p style="margin:0;color:#6f9096;font-size:12px;line-height:1.8;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
        </td>
      </tr>
    </table>
  </div>
  `;

  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: o.customer_email,
      subject: t.subject(o.numero),
      bcc: BCC,
      html: avvolgiScuro(html),
    });
  } catch (e) {
    console.error("Errore email link di pagamento:", e);
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
        <td style="padding:24px 32px;background:#002f35;">
          <table role="presentation" width="100%"><tr>
            <td style="color:#f04b4b;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Nouvelle commande</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;">#${esc(o.numero)}</td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 22px;text-align:center;background:#f6f5f2;border-bottom:2px solid #002f35;">
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
  it: {
    subject: (name: string) => `${name}, la tua opinione conta per noi ⭐`,
    title: "La tua opinione conta",
    intro: (name: string) =>
      `Grazie ${name} per il tuo ordine di ieri!<br>` +
      `Speriamo che ti sia piaciuto.<br>` +
      `Una tua breve recensione ci aiuta moltissimo&nbsp;— ci vuole solo un minuto.`,
    btn: "Lascia una recensione Google",
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
  if (!resend || !RESEND_FROM) return;
  if (!o.customer_email?.trim()) return; // niente email: niente richiesta recensione
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

  const t = pick5(TXT_REVIEW, o.lang);
  const nome = esc(o.customer_name.split(" ")[0] || o.customer_name);

  // 11:30 del giorno dopo l'ordine, ora di Bruxelles.
  const quando = DateTime.fromISO(o.pickup_time)
    .setZone(TIMEZONE)
    .plus({ days: 1 })
    .set({ hour: 11, minute: 30, second: 0, millisecond: 0 });

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#00252b; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#002f35;border:1px solid #0f434c;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(dati.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#f04b4b;font-size:11px;letter-spacing:4px;font-family:Arial,Helvetica,sans-serif;">${esc((dati.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Arial,Helvetica,sans-serif;">${t.title}</h1>
          <p style="margin:18px 0 0;color:#8fb0b5;font-size:15px;line-height:1.7;">${t.intro(nome)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 40px 6px;text-align:center;">
          <p style="margin:0;color:#f04b4b;font-size:26px;letter-spacing:6px;">★★★★★</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 40px 8px;text-align:center;">
          <a href="${reviewUrl}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${t.btn}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 40px 8px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 20px;background:#f04b4b;"></div>
          <p style="margin:0 0 26px;color:#6f9096;font-size:13px;line-height:1.7;">${t.sign}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #0f434c;text-align:center;">
          <p style="margin:0;color:#6f9096;font-size:12px;line-height:1.8;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
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
      bcc: BCC,
      html: avvolgiScuro(html),
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
  it: {
    subject: (name: string) => `${name}, la tua opinione conta per noi ⭐`,
    title: "La tua opinione conta",
    intro: (name: string) =>
      `Grazie ${name} per la tua visita di ieri!<br>` +
      `Speriamo che tu abbia trascorso un bel momento.<br>` +
      `Una tua breve recensione ci aiuta moltissimo&nbsp;— ci vuole solo un minuto.`,
    btn: "Lascia una recensione Google",
    sign: firma("it"),
  },
  nl: {
    subject: (name: string) => `${name}, jouw mening telt voor ons ⭐`,
    title: "Jouw mening telt",
    intro: (name: string) =>
      `Bedankt ${name} voor je bezoek van gisteren!<br>` +
      `We hopen dat je een fijne tijd hebt gehad.<br>` +
      `Een korte review helpt ons enorm&nbsp;— het kost maar een minuut.`,
    btn: "Een Google-review achterlaten",
    sign: firma("nl"),
  },
  es: {
    subject: (name: string) => `${name}, tu opinión cuenta para nosotros ⭐`,
    title: "Tu opinión cuenta",
    intro: (name: string) =>
      `¡Gracias ${name} por tu visita de ayer!<br>` +
      `Esperamos que hayas pasado un buen rato.<br>` +
      `Una breve reseña nos ayuda muchísimo&nbsp;— solo lleva un minuto.`,
    btn: "Dejar una reseña en Google",
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
  const quando = DateTime.fromISO(r.date, { zone: TIMEZONE })
    .plus({ days: 1 })
    .set({ hour: 11, minute: 30, second: 0, millisecond: 0 });
  if (quando <= DateTime.now()) return null;

  const t = pick5(TXT_REVIEW_RESA, r.lang);
  const nome = esc(r.first_name.trim() || r.last_name.trim() || "");

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#00252b; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#002f35;border:1px solid #0f434c;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(dati.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#f04b4b;font-size:11px;letter-spacing:4px;font-family:Arial,Helvetica,sans-serif;">${esc((dati.nome + " — " + CLIENT.claim).toUpperCase())}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Arial,Helvetica,sans-serif;">${t.title}</h1>
          <p style="margin:18px 0 0;color:#8fb0b5;font-size:15px;line-height:1.7;">${t.intro(nome)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 40px 6px;text-align:center;">
          <p style="margin:0;color:#f04b4b;font-size:26px;letter-spacing:6px;">★★★★★</p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 40px 8px;text-align:center;">
          <a href="${reviewUrl}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${t.btn}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 40px 8px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 20px;background:#f04b4b;"></div>
          <p style="margin:0 0 26px;color:#6f9096;font-size:13px;line-height:1.7;">${t.sign}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #0f434c;text-align:center;">
          <p style="margin:0;color:#6f9096;font-size:12px;line-height:1.8;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
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
      bcc: BCC,
      html: avvolgiScuro(html),
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
    <td style="padding:10px 24px;border-bottom:1px solid #0f434c;color:#8fb0b5;font-size:13px;letter-spacing:1px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">${esc(lab)}</td>
    <td style="padding:10px 24px;border-bottom:1px solid #0f434c;color:#ffffff;font-size:16px;text-align:right;font-family:Arial,Helvetica,sans-serif;">${esc(val)}</td>
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
  <div dir="${opts.dir}" style="font-family: Arial, Helvetica, sans-serif; background:#00252b; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#002f35;border:1px solid #0f434c;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(opts.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#f04b4b;font-size:11px;letter-spacing:4px;font-family:Arial,Helvetica,sans-serif;">${esc(opts.claimUpper)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Arial,Helvetica,sans-serif;">${esc(opts.title)}</h1>
          <p style="margin:16px 0 0;color:#8fb0b5;font-size:15px;line-height:1.6;">${opts.lead}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #0f434c;">
            ${opts.recapRows}
          </table>
        </td>
      </tr>
      ${opts.ctaHtml}
      <tr>
        <td style="padding:0 40px 4px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:8px auto 24px;background:#f04b4b;"></div>
        </td>
      </tr>
      ${opts.footerHtml}
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #0f434c;text-align:center;">
          <p style="margin:0;color:#6f9096;font-size:12px;line-height:1.8;">${esc(opts.indirizzo)}<br>${esc(opts.contatti)}</p>
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

  const modifyUrl = `${siteBase()}/reservation?token=${r.cancel_token}`;
  const cancelUrl = `${siteBase()}/reservation/cancel?token=${r.cancel_token}`;

  const ctaHtml = `
    <tr>
      <td style="padding:22px 40px 4px;text-align:center;">
        <a href="${modifyUrl}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;padding:13px 30px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:10px;margin:4px;">${esc(t.modifier)}</a>
        <a href="${cancelUrl}" style="display:inline-block;background:transparent;color:#8fb0b5;text-decoration:none;padding:12px 28px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border:1px solid #0f434c;border-radius:10px;margin:4px;">${esc(w.annulerTitre)}</a>
      </td>
    </tr>`;

  const footerHtml = `
    <tr>
      <td style="padding:0 40px 30px;text-align:center;">
        <p style="margin:0;color:#6f9096;font-size:12px;line-height:1.7;">${esc(t.hint)}</p>
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
      bcc: BCC,
      html: avvolgiScuro(html),
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

  const heureVal = r.service_key ? `${r.heure} · ${labelService(r.service_key, lang)}` : r.heure;
  const recap =
    rigaRecap(w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(w.heure, heureVal) +
    rigaRecap(w.personnes, `${r.people} ${w.pers}`) +
    (r.zone ? rigaRecap(w.section, r.zone) : "");

  const html = guscioResa({
    nome: dati.nome,
    claimUpper: (dati.nome + " — " + CLIENT.claim).toUpperCase(),
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
      html: avvolgiScuro(html),
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

  const heureVal = r.service_key ? `${r.heure} · ${labelService(r.service_key, lang)}` : r.heure;
  const recap =
    rigaRecap(w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(w.heure, heureVal) +
    rigaRecap(w.personnes, `${r.people} ${w.pers}`) +
    (r.zone ? rigaRecap(w.section, r.zone) : "");

  const modifyUrl = `${siteBase()}/reservation?token=${r.cancel_token}`;
  const cancelUrl = `${siteBase()}/reservation/cancel?token=${r.cancel_token}`;

  const ctaHtml = `
    <tr>
      <td style="padding:22px 40px 4px;text-align:center;">
        <a href="${modifyUrl}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;padding:13px 30px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:10px;margin:4px;">${esc(t.modifier)}</a>
        <a href="${cancelUrl}" style="display:inline-block;background:transparent;color:#8fb0b5;text-decoration:none;padding:12px 28px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border:1px solid #0f434c;border-radius:10px;margin:4px;">${esc(w.annulerTitre)}</a>
      </td>
    </tr>`;

  const footerHtml = `
    <tr>
      <td style="padding:0 40px 30px;text-align:center;">
        <p style="margin:0;color:#f04b4b;font-size:13px;line-height:1.7;">${esc(t.pendInfo)}</p>
      </td>
    </tr>`;

  const html = guscioResa({
    nome: dati.nome,
    claimUpper: (dati.nome + " — " + CLIENT.claim).toUpperCase(),
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
      html: avvolgiScuro(html),
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

  const recap =
    rigaRecap(w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(w.heure, r.heure) +
    rigaRecap(w.personnes, `${r.people} ${w.pers}`);

  const bookUrl = `${siteBase()}/reservation`;
  const ctaHtml = `
    <tr>
      <td style="padding:22px 40px 4px;text-align:center;">
        <a href="${bookUrl}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;padding:13px 32px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${esc(w.reserver)}</a>
      </td>
    </tr>`;

  const footerHtml = `
    <tr>
      <td style="padding:0 40px 30px;text-align:center;">
        <p style="margin:0;color:#6f9096;font-size:12px;line-height:1.7;">${esc(t.cancInfo)}</p>
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
      bcc: BCC,
      html: avvolgiScuro(html),
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

  const recap =
    rigaRecap(w.date, fmtDataResa(r.date, lang)) +
    rigaRecap(w.heure, r.heure) +
    rigaRecap(w.personnes, `${r.people} ${w.pers}`);

  const bookUrl = `${siteBase()}/reservation`;
  const ctaHtml = `
    <tr>
      <td style="padding:22px 40px 4px;text-align:center;">
        <a href="${bookUrl}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;padding:13px 32px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${esc(w.reserver)}</a>
      </td>
    </tr>`;

  const footerHtml = `
    <tr>
      <td style="padding:0 40px 30px;text-align:center;">
        <p style="margin:0;color:#6f9096;font-size:12px;line-height:1.7;">${esc(t.fermInfo)}</p>
      </td>
    </tr>`;

  const html = guscioResa({
    nome: dati.nome,
    claimUpper: (dati.nome + " — " + CLIENT.claim).toUpperCase(),
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
      html: avvolgiScuro(html),
    });
  } catch (e) {
    console.error("Errore email chiusura prenotazione:", e);
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
        <td style="padding:24px 32px;background:#002f35;">
          <table role="presentation" width="100%"><tr>
            <td style="color:#f04b4b;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Nouvelle réservation</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;">${esc(dataFr)}</td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 22px;text-align:center;background:#f6f5f2;border-bottom:2px solid #002f35;">
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

/** Email di NOTIFICA al ristorante quando il CLIENTE annulla (FR, tema rosso). */
export async function emailNotificaAnnulloResa(r: ResaEmail): Promise<void> {
  const dest = await resaNotifyEmail();
  const from = await resaFromEmail();
  if (!resend || !from || !dest) {
    console.warn("Resend/notify prenotazioni non configurati: salto notifica annullo");
    return;
  }
  const servFr = labelService(r.service_key, "fr");
  const dataFr = fmtDataResa(r.date, "fr");
  const nomeCompleto = `${r.first_name} ${r.last_name}`.trim();

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#e8e6e1; padding:30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;">
      <tr>
        <td style="padding:24px 32px;background:#002f35;">
          <table role="presentation" width="100%"><tr>
            <td style="color:#e2483d;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Réservation annulée</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;">${esc(dataFr)}</td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 32px;background:#fdecea;border-bottom:2px solid #e2483d;">
          <p style="margin:0;color:#a5281c;font-size:14px;font-weight:bold;text-align:center;">Annulée par le client</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 18px;text-align:center;background:#f6f5f2;">
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
            ${r.zone ? `<tr><td style="padding:6px 0;color:#555;font-size:14px;">Section</td><td style="padding:6px 0;color:#000;font-size:14px;text-align:right;font-weight:bold;">${esc(r.zone)}</td></tr>` : ""}
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
}

function euroCents(c: number): string {
  return (Math.round(Number(c) || 0) / 100).toFixed(2).replace(".", ",") + " €";
}

/**
 * Email di un BUONO REGALO (design dark brand).
 * `a`: "destinataire" = a chi riceve il regalo · "offrant" = copia a chi l'offre.
 * Non lancia mai eccezioni.
 */
export async function emailBonCadeau(bon: BonEmail, a: "destinataire" | "offrant", dest: string): Promise<void> {
  if (!resend || !RESEND_FROM || !dest) {
    console.warn("Resend non configurato: salto l'email du bon cadeau");
    return;
  }
  const dati = await datiRistorante();
  const perDest = a === "destinataire";
  const nomeDest = String(bon.recipient_name ?? "").trim();
  const nomeOffr = String(bon.sender_name ?? "").trim();
  const scadenza = bon.expires_at ? String(bon.expires_at).split("-").reverse().join("/") : "";

  const title = perDest ? "Votre bon cadeau" : "Votre bon cadeau a été créé";
  const lead = perDest
    ? (nomeOffr
        ? `Bonne nouvelle&nbsp;! <strong style="color:#fff;">${esc(nomeOffr)}</strong> vous offre un bon cadeau à utiliser chez ${esc(dati.nome)}.`
        : `Vous avez reçu un bon cadeau à utiliser chez ${esc(dati.nome)}.`)
    : (nomeDest
        ? `Voici le récapitulatif du bon cadeau destiné à <strong style="color:#fff;">${esc(nomeDest)}</strong>.`
        : "Voici le récapitulatif de votre bon cadeau.");

  const riga = (k: string, v: string) =>
    `<tr><td style="padding:12px 16px;border-bottom:1px solid #0f434c;color:#8fb0b5;font-size:14px;">${esc(k)}</td><td style="padding:12px 16px;border-bottom:1px solid #0f434c;color:#ffffff;font-size:14px;text-align:right;font-weight:bold;">${esc(v)}</td></tr>`;

  const righe = [
    riga("Valeur", euroCents(bon.initial_cents)),
    scadenza ? riga("À utiliser avant le", scadenza) : "",
    bon.ship && bon.shipping_cents ? riga("Frais d'envoi", euroCents(bon.shipping_cents)) : "",
  ].join("");

  const indirizzoSped = bon.ship
    ? [bon.ship_address, [bon.ship_zip, bon.ship_city].filter(Boolean).join(" "), bon.ship_country].filter(Boolean).join(", ")
    : "";

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#00252b; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#002f35;border:1px solid #0f434c;">
      <tr>
        <td style="padding:40px 40px 20px;text-align:center;">
          <img src="${LOGO_URL}" alt="${esc(dati.nome)}" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:1px;font-weight:normal;font-family:Arial,Helvetica,sans-serif;">${esc(title)}</h1>
          <p style="margin:16px 0 0;color:#8fb0b5;font-size:15px;line-height:1.6;">${lead}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 40px 6px;text-align:center;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px dashed #f04b4b;">
            <tr><td style="padding:22px 16px;text-align:center;">
              <p style="margin:0;color:#8fb0b5;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Votre code</p>
              <p style="margin:10px 0 0;color:#f04b4b;font-size:28px;letter-spacing:3px;font-weight:bold;">${esc(bon.code)}</p>
              <p style="margin:12px 0 0;color:#ffffff;font-size:22px;font-weight:bold;">${esc(euroCents(bon.initial_cents))}</p>
            </td></tr>
          </table>
        </td>
      </tr>
      ${bon.message ? `<tr><td style="padding:18px 40px 0;"><table role="presentation" width="100%" style="background:#2b2526;border-left:3px solid #f04b4b;"><tr><td style="padding:14px 18px;color:#e8e2dc;font-size:14px;font-style:italic;line-height:1.6;">« ${esc(bon.message)} »${nomeOffr ? `<br><span style="color:#8fb0b5;font-style:normal;font-size:13px;">— ${esc(nomeOffr)}</span>` : ""}</td></tr></table></td></tr>` : ""}
      <tr>
        <td style="padding:20px 40px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #0f434c;">
            ${righe}
          </table>
        </td>
      </tr>
      ${indirizzoSped ? `<tr><td style="padding:8px 40px 0;"><p style="margin:0;color:#8fb0b5;font-size:13px;line-height:1.7;">Envoi postal&nbsp;: ${esc(indirizzoSped)}</p></td></tr>` : ""}
      ${
        !perDest && bon.pay_url
          ? `<tr><td style="padding:22px 40px 4px;text-align:center;">
               <a href="${bon.pay_url}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 34px;border-radius:999px;">Payer maintenant</a>
               <p style="margin:12px 0 0;color:#6f9096;font-size:12px;">Le bon sera activé dès réception du paiement.</p>
             </td></tr>`
          : !perDest && bon.paid === false
            ? `<tr><td style="padding:22px 40px 4px;text-align:center;">
                 <p style="margin:0;color:#f04b4b;font-size:14px;font-weight:bold;">Paiement en attente</p>
                 <p style="margin:8px 0 0;color:#6f9096;font-size:12px;">Le restaurant vous transmettra le lien de paiement&nbsp;; le bon sera activé dès réception.</p>
               </td></tr>`
            : ""
      }
      ${
        perDest && bon.pdf_url
          ? `<tr><td style="padding:22px 40px 4px;text-align:center;">
               <a href="${bon.pdf_url}" style="display:inline-block;background:#f04b4b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 34px;border-radius:999px;">Télécharger le PDF</a>
             </td></tr>`
          : ""
      }
      <tr>
        <td style="padding:20px 40px 26px;text-align:center;">
          <p style="margin:0;color:#6f9096;font-size:13px;line-height:1.7;">Présentez ce code sur place ou saisissez-le lors de votre commande en ligne.${scadenza ? ` Valable jusqu'au ${esc(scadenza)}.` : ""}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 40px;border-top:1px solid #0f434c;text-align:center;">
          <p style="margin:0;color:#6f9096;font-size:12px;line-height:1.8;">${esc(dati.nome)}<br>${esc(dati.indirizzo ?? "")}</p>
        </td>
      </tr>
    </table>
  </div>
  `;

  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: dest,
      bcc: BCC,
      subject: perDest ? `Votre bon cadeau ${dati.nome} — ${euroCents(bon.initial_cents)}` : `Bon cadeau créé — ${bon.code}`,
      html: avvolgiScuro(html),
    });
  } catch (e) {
    console.error("Errore email bon cadeau:", e);
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
    r.notes ? `<tr><td colspan="2" style="padding:10px 0 0;"><div style="background:#eef4ff;border-left:4px solid #3b82f6;padding:12px 16px;color:#1e40af;font-size:14px;"><strong>Note :</strong> ${esc(r.notes)}</div></td></tr>` : "",
  ].join("");

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#e8e6e1; padding:30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;">
      <tr>
        <td style="padding:24px 32px;background:#002f35;">
          <table role="presentation" width="100%"><tr>
            <td style="color:#5b9bff;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Réservation modifiée</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;">${esc(dataFr)}</td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 32px;background:#eef4ff;border-bottom:2px solid #3b82f6;">
          <p style="margin:0;color:#1e40af;font-size:14px;font-weight:bold;text-align:center;">Modifiée par le client · nouvelles informations ci-dessous</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 18px;text-align:center;background:#f6f5f2;">
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
