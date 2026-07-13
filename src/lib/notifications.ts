import { Resend } from "resend";
import { supabaseAdmin } from "./db";

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const RESEND_FROM = import.meta.env.RESEND_FROM;
const KITCHEN_EMAIL = import.meta.env.KITCHEN_EMAIL;
const SLACK_WEBHOOK_URL = import.meta.env.SLACK_WEBHOOK_URL;
const BCC = "enquiries@moodd.online";

// URL pubblico del sito (per il logo nell'email cliente).
const SITE_URL = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
const LOGO_URL = `${SITE_URL.replace(/\/$/, "")}/logo-white-pizzeria77.png`;
const TEL = "+3226477777";

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

  const righeHtml = piatti
    .map(
      (i) => `
      <tr>
        <td style="padding:14px 24px;border-bottom:1px solid #2a2a2a;color:#ffffff;font-size:16px;">${i.qty}× ${esc(i.name)}</td>
        <td style="padding:14px 24px;border-bottom:1px solid #2a2a2a;color:#ffffff;font-size:16px;text-align:right;white-space:nowrap;">${euro(i.price_cents * i.qty)}</td>
      </tr>`
    )
    .join("");

  const noteHtml = noteCliente
    ? `<tr><td colspan="2" style="padding:14px 24px;border-bottom:1px solid #2a2a2a;color:#b3b3b3;font-size:13px;"><strong style="color:#fff;">${t.note} :</strong> ${esc(noteCliente)}</td></tr>`
    : "";

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#1a1a1a; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#000000;border:1px solid #2a2a2a;">
      <tr>
        <td style="padding:40px 40px 24px;text-align:center;">
          <img src="${LOGO_URL}" alt="Pizzeria 77" width="64" height="64" style="display:inline-block;border:0;" />
          <p style="margin:18px 0 0;color:#b3b3b3;font-size:11px;letter-spacing:4px;">THIS IS PIZZERIA 77</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:32px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${t.title}</h1>
          <p style="margin:18px 0 0;color:#cccccc;font-size:15px;line-height:1.6;">${t.intro(esc(o.customer_name), esc(o.numero))}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:30px 40px 8px;text-align:center;">
          <p style="margin:0;color:#b3b3b3;font-size:12px;letter-spacing:2px;text-transform:uppercase;">${t.pickup}</p>
          <p style="margin:6px 0 0;color:#ffffff;font-size:40px;font-weight:bold;line-height:1;">${ora}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ffffff;">
            ${righeHtml}
            ${noteHtml}
            <tr>
              <td style="padding:16px 24px;color:#ffffff;font-size:18px;font-weight:bold;">${t.total}</td>
              <td style="padding:16px 24px;color:#ffffff;font-size:18px;font-weight:bold;text-align:right;">${euro(o.total_cents)}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 40px;text-align:center;">
          <a href="tel:${TEL}" style="display:inline-block;background:#ffffff;color:#000000;text-decoration:none;padding:14px 34px;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${t.callBtn}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #2a2a2a;text-align:center;">
          <p style="margin:0;color:#777777;font-size:12px;line-height:1.8;">Chaussée de Bruxelles 77, 1410 Waterloo<br>+32 (0)2 647 77 77 · info@pizzeria77.be</p>
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
        <td style="padding:24px 32px;background:#000000;">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Nouvelle commande</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;">#${esc(o.numero)}</td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 22px;text-align:center;background:#f6f5f2;border-bottom:2px solid #000000;">
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