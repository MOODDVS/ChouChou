import type { APIRoute } from "astro";
import { Resend } from "resend";

const resend = new Resend(import.meta.env.RESEND_API_KEY);
const FROM = "La Molisana <info@lamolisana.be>";
const TO = "pizzeria@lamolisana.be";
const BCC = "enquiries@moodd.online";

// URL pubblico del sito (per il logo nell'email). In locale: http://localhost:4321
const SITE_URL = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
const LOGO_URL = `${SITE_URL.replace(/\/$/, "")}/icon-512.png`;
const TEL = "+32455131465";

type Lang = "fr" | "en";

// Testi dell'email al cliente, nelle due lingue.
const T = {
  fr: {
    subject: "Merci pour votre message — La Molisana",
    title: "Merci !",
    intro: (p: string) =>
      `Bonjour ${p},<br>nous avons bien reçu votre message et nous vous répondrons dans les plus brefs délais.`,
    yourMessage: "Votre message",
    urgent: "Pour toute demande urgente, n'hésitez pas à nous appeler directement.",
    callBtn: "Nous appeler",
  },
  en: {
    subject: "Thank you for your message — La Molisana",
    title: "Thank you!",
    intro: (p: string) =>
      `Hello ${p},<br>we have received your message and will get back to you as soon as possible.`,
    yourMessage: "Your message",
    urgent: "For any urgent request, feel free to call us directly.",
    callBtn: "Call us",
  },
} as const;

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
  const lang: Lang = body.lang === "en" ? "en" : "fr";
  const t = T[lang];

  if (!nome || !email || !messaggio) {
    return new Response(JSON.stringify({ error: "Champs requis manquants" }), { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: "Email invalide" }), { status: 400 });
  }

  // Prénom per il saluto (prima parola del nome).
  const prenom = nome.split(/\s+/)[0] || nome;

  // --- Email al ristorante (interna, sempre in francese) ---
  const htmlRistorante = `
    <h2>Nouveau message — site La Molisana</h2>
    <p><strong>Nom :</strong> ${esc(nome)}</p>
    <p><strong>Email :</strong> ${esc(email)}</p>
    <p><strong>Téléphone :</strong> ${esc(telefono) || "—"}</p>
    <p><strong>Objet :</strong> ${esc(oggetto) || "—"}</p>
    <p><strong>Langue client :</strong> ${lang.toUpperCase()}</p>
    <p><strong>Message :</strong></p>
    <p>${esc(messaggio).replace(/\n/g, "<br>")}</p>
  `;

  // --- Email di ringraziamento al cliente (template brand, bilingue) ---
  const htmlCliente = `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#1a1718; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#231f20;border:1px solid #3a3335;">
      <tr>
        <td style="padding:40px 40px 24px;text-align:center;">
          <img src="${LOGO_URL}" alt="La Molisana" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:18px 0 0;color:#b3aca6;font-size:11px;letter-spacing:4px;">LA MOLISANA · PIZZA &amp; PASTA</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:32px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${t.title}</h1>
          <p style="margin:18px 0 0;color:#cccccc;font-size:15px;line-height:1.6;">${t.intro(esc(prenom))}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:30px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dfab4e;">
            <tr>
              <td style="padding:18px 24px;color:#dfab4e;font-size:12px;letter-spacing:2px;text-transform:uppercase;vertical-align:top;">${t.yourMessage}</td>
              <td style="padding:18px 24px;color:#ffffff;font-size:14px;line-height:1.6;text-align:right;">${esc(messaggio).replace(/\n/g, "<br>")}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 30px;">
          <p style="margin:0;color:#cccccc;font-size:14px;line-height:1.7;">${t.urgent}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 40px;text-align:center;">
          <a href="tel:${TEL}" style="display:inline-block;background:#dfab4e;color:#231f20;text-decoration:none;padding:14px 34px;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${t.callBtn}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 40px;border-top:1px solid #3a3335;text-align:center;">
          <p style="margin:0;color:#8f8781;font-size:12px;line-height:1.8;">Av. Adolphe Demeur 37, 1060 Saint-Gilles — Bruxelles<br>+32 455 13 14 65 · info@lamolisana.be</p>
        </td>
      </tr>
    </table>
  </div>
  `;

  try {
    // 1) Messaggio al ristorante
    const { error: errR } = await resend.emails.send({
      from: FROM,
      to: TO,
      bcc: BCC,
      replyTo: email,
      subject: oggetto ? `Contact site : ${oggetto}` : "Nouveau message — site La Molisana",
      html: htmlRistorante,
    });
    if (errR) {
      return new Response(JSON.stringify({ error: "Envoi impossible" }), { status: 502 });
    }

    // 2) Ringraziamento al cliente (se fallisce, l'operazione resta ok)
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: t.subject,
      html: htmlCliente,
    });
  } catch {
    return new Response(JSON.stringify({ error: "Envoi impossible" }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
