import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../lib/db";
import { datiRistorante } from "../../lib/ristorante";
import { temaEmail } from "../../lib/temaBrand";
import { adminLang } from "../../lib/admin/adminLang";
import { CLIENT } from "../../config/client";
import { Resend } from "resend";

const resend = new Resend(import.meta.env.RESEND_API_KEY);
const FROM = (((import.meta.env.RESEND_FROM ?? "") as string).trim().replace(/^["']|["']$/g, "")) || `${CLIENT.nome} <${CLIENT.email}>`;
const TO_FALLBACK = CLIENT.email;

/** Destinatari del form: admin Réglages → Général → "Emails du formulaire
 *  de contact" (fallback sull'indirizzo storico se non impostato). */
async function destinatariContact(): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", ["contact_emails", "public_email"]);
    const m = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "").trim()]));
    const lista = (m.get("contact_emails") ?? "").split(",").map((e) => e.trim()).filter(Boolean);
    if (lista.length > 0) return lista;
    const pub = m.get("public_email") ?? "";
    if (pub) return [pub];
  } catch {
    // DB irraggiungibile: fallback
  }
  return [TO_FALLBACK];
}
/** Mittente delle email del form: "Nome mittente <email verificata>", con nome
 *  ed email dai Reglages (email_from_name + newsletter_from_email). Fallback su
 *  FROM (RESEND_FROM / config) se non configurati. */
async function mittenteForm(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", ["contact_from_name", "contact_from_email", "email_from_name", "public_email", "newsletter_from_email", "restaurant_name"]);
    const m = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "").trim()]));
    const nome = m.get("contact_from_name") || m.get("email_from_name") || m.get("restaurant_name") || CLIENT.nome;
    const email = m.get("contact_from_email") || m.get("public_email") || m.get("newsletter_from_email") || "";
    if (email) return `${nome} <${email}>`;
  } catch {
    // fallback
  }
  return FROM;
}
const BCC = "enquiries@moodd.online";

// URL pubblico del sito (per il logo nell'email). In locale: http://localhost:4321
const SITE_URL = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
const LOGO_URL = `${SITE_URL.replace(/\/$/, "")}/icon-512.png`;

type Lang = "fr" | "en" | "it" | "nl" | "es";

// Testi dell'email al cliente, nelle due lingue.
const T = {
  fr: {
    subject: (n: string) => `Merci pour votre message — ${n}`,
    title: "Merci !",
    intro: (p: string) =>
      `Bonjour ${p},<br>nous avons bien reçu votre message et nous vous répondrons dans les plus brefs délais.`,
    yourMessage: "Votre message",
    urgent: "Pour toute demande urgente, n'hésitez pas à nous appeler directement.",
    callBtn: "Nous appeler",
  },
  en: {
    subject: (n: string) => `Thank you for your message — ${n}`,
    title: "Thank you!",
    intro: (p: string) =>
      `Hello ${p},<br>we have received your message and will get back to you as soon as possible.`,
    yourMessage: "Your message",
    urgent: "For any urgent request, feel free to call us directly.",
    callBtn: "Call us",
  },
  it: {
    subject: (n: string) => `Grazie per il tuo messaggio — ${n}`,
    title: "Grazie !",
    intro: (p: string) =>
      `Ciao ${p},<br>abbiamo ricevuto il tuo messaggio e ti risponderemo il prima possibile.`,
    yourMessage: "Il tuo messaggio",
    urgent: "Per richieste urgenti, non esitare a chiamarci direttamente.",
    callBtn: "Chiamaci",
  },
  nl: {
    subject: (n: string) => `Bedankt voor je bericht — ${n}`,
    title: "Bedankt !",
    intro: (p: string) =>
      `Hallo ${p},<br>we hebben je bericht goed ontvangen en nemen zo snel mogelijk contact met je op.`,
    yourMessage: "Je bericht",
    urgent: "Voor dringende vragen kun je ons gerust rechtstreeks bellen.",
    callBtn: "Bel ons",
  },
  es: {
    subject: (n: string) => `Gracias por tu mensaje — ${n}`,
    title: "¡Gracias !",
    intro: (p: string) =>
      `Hola ${p},<br>hemos recibido tu mensaje y te responderemos lo antes posible.`,
    yourMessage: "Tu mensaje",
    urgent: "Para cualquier solicitud urgente, no dudes en llamarnos directamente.",
    callBtn: "Llámanos",
  },
} as const;

// Etichette dell'email di NOTIFICA al ristoratore: nella lingua dell'ADMIN
// (app_config "admin_lang"), non in quella del cliente.
const R_TXT: Record<string, {
  nuovoMsg: string; subject: string; email: string; phone: string;
  clientLang: string; message: string; footer: string;
  reply: (n: string) => string;
  subjectLine: (o: string) => string;
  subjectFallback: (b: string) => string;
}> = {
  fr: { nuovoMsg: "Nouveau message", subject: "Objet", email: "Email", phone: "Téléphone", clientLang: "Langue client", message: "Message", footer: "Reçu via le formulaire de contact du site.", reply: (n) => `Répondre à ${n}`, subjectLine: (o) => `Contact site : ${o}`, subjectFallback: (b) => `Nouveau message — site ${b}` },
  en: { nuovoMsg: "New message", subject: "Subject", email: "Email", phone: "Phone", clientLang: "Customer language", message: "Message", footer: "Received via the website contact form.", reply: (n) => `Reply to ${n}`, subjectLine: (o) => `Website contact: ${o}`, subjectFallback: (b) => `New message — ${b} website` },
  it: { nuovoMsg: "Nuovo messaggio", subject: "Oggetto", email: "Email", phone: "Telefono", clientLang: "Lingua cliente", message: "Messaggio", footer: "Ricevuto tramite il modulo di contatto del sito.", reply: (n) => `Rispondi a ${n}`, subjectLine: (o) => `Contatto sito: ${o}`, subjectFallback: (b) => `Nuovo messaggio — sito ${b}` },
  nl: { nuovoMsg: "Nieuw bericht", subject: "Onderwerp", email: "E-mail", phone: "Telefoon", clientLang: "Taal klant", message: "Bericht", footer: "Ontvangen via het contactformulier van de site.", reply: (n) => `Beantwoorden aan ${n}`, subjectLine: (o) => `Contact site: ${o}`, subjectFallback: (b) => `Nieuw bericht — site ${b}` },
  es: { nuovoMsg: "Nuevo mensaje", subject: "Asunto", email: "Email", phone: "Teléfono", clientLang: "Idioma del cliente", message: "Mensaje", footer: "Recibido a través del formulario de contacto del sitio.", reply: (n) => `Responder a ${n}`, subjectLine: (o) => `Contacto sitio: ${o}`, subjectFallback: (b) => `Nuevo mensaje — sitio ${b}` },
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400 });
  }

  const nome = String(body.nome ?? "").trim();
  const email = String(body.email ?? "").trim();
  const telefono = String(body.telefono ?? "").trim();
  const oggetto = String(body.oggetto ?? "").trim();
  const messaggio = String(body.messaggio ?? "").trim();
  const langIn = String(body.lang ?? "");
  const lang: Lang = (["fr", "en", "it", "nl", "es"] as Lang[]).includes(langIn as Lang)
    ? (langIn as Lang)
    : "fr";
  const t = T[lang];

  if (!nome || !email || !messaggio) {
    return new Response(JSON.stringify({ error: "Champs requis manquants" }), { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: "Email invalide" }), { status: 400 });
  }

  // Prénom per il saluto (prima parola del nome).
  const prenom = nome.split(/\s+/)[0] || nome;
  const dati = await datiRistorante();
  const from = await mittenteForm();
  const tema = await temaEmail();
  const logoEmail =
    (tema.isDark ? dati.logoNeg || dati.logoPos : dati.logoPos || dati.logoNeg) ||
    dati.logo ||
    LOGO_URL;
  const adminL = await adminLang();
  const R = R_TXT[adminL] ?? R_TXT.fr;

  // --- Email al ristorante (theme-driven, lingua admin) ---
  const htmlRistorante = `<!doctype html>
<html lang="${adminL}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light dark" /></head>
<body style="margin:0;padding:0;background:${tema.bg};font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tema.bg};border-collapse:collapse;margin:0;padding:0;width:100%;">
    <tr><td align="center" style="padding:34px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
        <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:32px 40px 6px;">
            <p style="margin:0;color:${tema.accent};font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:bold;">${R.nuovoMsg} &middot; ${esc(dati.nome)}</p>
            <h1 style="margin:12px 0 0;color:${tema.title};font-size:26px;font-weight:bold;letter-spacing:0.3px;">${esc(nome)}</h1>
            ${oggetto ? `<p style="margin:22px 0 0;color:${tema.muted};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">${R.subject}</p><p style="margin:5px 0 0;color:${tema.title};font-size:19px;font-weight:600;line-height:1.35;">${esc(oggetto)}</p>` : ""}
          </td>
        </tr>
        <tr>
          <td style="padding:22px 40px 6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${tema.border};">
              <tr>
                <td style="padding:14px 0;border-bottom:1px solid ${tema.border};color:${tema.muted};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;vertical-align:middle;">${R.email}</td>
                <td style="padding:14px 0;border-bottom:1px solid ${tema.border};text-align:right;"><a href="mailto:${esc(email)}" style="color:${tema.accent};text-decoration:none;font-size:15px;">${esc(email)}</a></td>
              </tr>
              ${telefono ? `<tr>
                <td style="padding:14px 0;border-bottom:1px solid ${tema.border};color:${tema.muted};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;vertical-align:middle;">${R.phone}</td>
                <td style="padding:14px 0;border-bottom:1px solid ${tema.border};text-align:right;"><a href="tel:${esc(telefono).replace(/[^+\d]/g, "")}" style="color:${tema.accent};text-decoration:none;font-size:15px;">${esc(telefono)}</a></td>
              </tr>` : ""}
              <tr>
                <td style="padding:14px 0;color:${tema.muted};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;vertical-align:middle;">${R.clientLang}</td>
                <td style="padding:14px 0;text-align:right;color:${tema.text};font-size:15px;">${lang.toUpperCase()}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.tintBorder};border-radius:12px;background:${tema.tint};">
              <tr><td style="padding:20px 24px;">
                <p style="margin:0 0 10px;color:${tema.accent};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:bold;">${R.message}</p>
                <p style="margin:0;color:${tema.title};font-size:15px;line-height:1.7;">${esc(messaggio).replace(/\n/g, "<br>")}</p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 40px 34px;text-align:center;">
            <a href="mailto:${esc(email)}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:14px 40px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-weight:bold;border-radius:999px;">${R.reply(esc(prenom))}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 26px;border-top:1px solid ${tema.border};text-align:center;">
            <p style="margin:0 0 12px;color:${tema.muted};font-size:12px;">${R.footer}</p>
            <img src="${SITE_URL.replace(/\/$/, "")}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="100" style="display:inline-block;width:100px;max-width:40%;height:auto;opacity:0.7;border:0;" />
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // --- Email di ringraziamento al cliente (template brand, bilingue) ---
  const htmlCliente = `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
</head>
<body style="margin:0;padding:0;background:${tema.bg};font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tema.bg};border-collapse:collapse;margin:0;padding:0;width:100%;">
    <tr>
      <td align="center" style="padding:34px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
          <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td style="padding:44px 44px 24px;text-align:center;">
              <img src="${logoEmail}" alt="${esc(dati.nome)}" width="220" style="display:inline-block;width:220px;max-width:74%;height:auto;border:0;" />
              <p style="margin:24px 0 0;color:${tema.muted};font-size:11px;letter-spacing:4px;">${esc(dati.nome.toUpperCase())}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 44px 0;text-align:center;">
              <h1 style="margin:0;color:${tema.title};font-size:34px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">${t.title}</h1>
              <p style="margin:18px 0 0;color:${tema.text};font-size:15px;line-height:1.66;">${t.intro(esc(prenom))}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 44px 6px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${tema.tintBorder};border-radius:12px;background:${tema.tint};">
                <tr><td style="padding:20px 26px;text-align:center;">
                  <p style="margin:0;color:${tema.accent};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${t.yourMessage}</p>
                  <p style="margin:11px 0 0;color:${tema.title};font-size:15px;line-height:1.6;">${esc(messaggio).replace(/\n/g, "<br>")}</p>
                </td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 44px 4px;text-align:center;">
              <p style="margin:0;color:${tema.muted};font-size:14px;line-height:1.7;">${t.urgent}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 44px 40px;text-align:center;">
              <a href="tel:${dati.telLink}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:15px 42px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${t.callBtn}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 44px 30px;border-top:1px solid ${tema.border};text-align:center;">
              <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.9;">${esc(dati.indirizzo)}<br>${esc(dati.tel)} &middot; ${esc(dati.email)}</p>
              <p style="margin:18px 0 0;"><img src="${SITE_URL.replace(/\/$/, "")}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="108" style="display:inline-block;width:108px;max-width:42%;height:auto;opacity:0.72;border:0;" /></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    // 1) Messaggio al ristorante
    const { error: errR } = await resend.emails.send({
      from,
      to: await destinatariContact(),
      bcc: BCC,
      replyTo: email,
      subject: oggetto ? R.subjectLine(oggetto) : R.subjectFallback(dati.nome),
      html: htmlRistorante,
    });
    if (errR) {
      return new Response(JSON.stringify({ error: "Envoi impossible" }), { status: 502 });
    }

    // 2) Ringraziamento al cliente (se fallisce, l'operazione resta ok)
    const { error: errC } = await resend.emails.send({
      from,
      to: email,
      bcc: BCC,
      subject: t.subject(dati.nome),
      html: htmlCliente,
    });
    if (errC) console.error("Contact: invio ringraziamento cliente fallito:", errC);
  } catch {
    return new Response(JSON.stringify({ error: "Envoi impossible" }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
