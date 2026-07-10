import type { APIRoute } from "astro";
import { Resend } from "resend";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../lib/db";

const resend = new Resend(import.meta.env.RESEND_API_KEY);
const FROM = "Pizzeria 77 <manager@pizzeria77.be>";
const TO = "manager@pizzeria77.be";
const BCC = "enquiries@moodd.online";

// URL pubblico del sito (per il logo nell'email). In locale: http://localhost:4321
const SITE_URL = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
const LOGO_URL = `${SITE_URL.replace(/\/$/, "")}/logo-white-pizzeria77.png`;
const TEL = "+3226477777"; // fisso, formato tel:

type Lang = "fr" | "en";

// Testi dell'email al cliente, nelle due lingue.
const T = {
  fr: {
    subject: "Votre demande de réservation — Pizzeria 77",
    title: "Réservation reçue",
    intro: (p: string) =>
      `Bonjour ${p},<br>nous avons bien reçu votre demande de réservation.`,
    date: "Date",
    time: "Heure",
    people: "Personnes",
    body: "Votre réservation est enregistrée. Sauf indication contraire de notre part, vous pouvez la considérer comme confirmée. Si nous devions l'annuler ou la modifier, nous vous contacterons rapidement.",
    callBtn: "Nous contacter",
  },
  en: {
    subject: "Your booking request — Pizzeria 77",
    title: "Booking received",
    intro: (p: string) =>
      `Hello ${p},<br>we have received your booking request.`,
    date: "Date",
    time: "Time",
    people: "Guests",
    body: "Your booking is registered. Unless we tell you otherwise, you can consider it confirmed. If we need to cancel or change it, we will contact you quickly.",
    callBtn: "Contact us",
  },
} as const;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// "2026-06-13" -> data leggibile nella lingua scelta (fallback alla stringa se non valida)
function dataLeggibile(iso: string, lang: Lang): string {
  const d = DateTime.fromISO(iso, { zone: "Europe/Brussels" }).setLocale(lang);
  return d.isValid ? d.toFormat("cccc d LLLL yyyy") : iso;
}

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400 });
  }

  const prenom = String(body.prenom ?? "").trim();
  const nom = String(body.nom ?? "").trim();
  const email = String(body.email ?? "").trim();
  const telephone = String(body.telephone ?? "").trim();
  const date = String(body.date ?? "").trim();
  const heure = String(body.heure ?? "").trim();
  const personnes = String(body.personnes ?? "").trim();
  const societe = String(body.societe ?? "").trim();
  const notes = String(body.notes ?? "").trim();
  const lang: Lang = body.lang === "en" ? "en" : "fr";
  const t = T[lang];

  if (!prenom || !nom || !email || !telephone || !date || !heure || !personnes) {
    return new Response(JSON.stringify({ error: "Champs requis manquants" }), { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: "Email invalide" }), { status: 400 });
  }

  const nomeCompleto = `${prenom} ${nom}`.trim();
  // Data per l'email cliente (nella sua lingua) e per quella interna (sempre FR).
  const dataCliente = dataLeggibile(date, lang);
  const dataFr = dataLeggibile(date, "fr");

  // Salva la prenotazione in DB (per lo storico e la futura area admin).
  // Se il salvataggio fallisce, NON blocchiamo: l'email resta il canale primario.
  try {
    const { error: errDb } = await supabaseAdmin.from("bookings").insert({
      customer_name: nomeCompleto,
      customer_email: email,
      customer_phone: telephone,
      booking_date: date,
      booking_time: heure,
      people: parseInt(personnes, 10) || null,
      company: societe || null,
      notes: notes || null,
      lang,
      source: "web",
    });
    if (errDb) {
      console.error("Salvataggio prenotazione fallito (email comunque inviata):", errDb.message);
    }
  } catch (e) {
    console.error("Errore salvataggio prenotazione:", e);
  }

  // --- Email alla pizzeria (interna, sempre in francese) ---
  const htmlPizzeria = `
    <h2>Nouvelle demande de réservation — site Pizzeria 77</h2>
    <p><strong>Nom :</strong> ${esc(nomeCompleto)}</p>
    <p><strong>Email :</strong> ${esc(email)}</p>
    <p><strong>Téléphone :</strong> ${esc(telephone)}</p>
    <p><strong>Date :</strong> ${esc(dataFr)}</p>
    <p><strong>Heure :</strong> ${esc(heure)}</p>
    <p><strong>Nombre de personnes :</strong> ${esc(personnes)}</p>
    <p><strong>Société :</strong> ${esc(societe) || "—"}</p>
    <p><strong>Langue client :</strong> ${lang.toUpperCase()}</p>
    <p><strong>Notes :</strong></p>
    <p>${esc(notes).replace(/\n/g, "<br>") || "—"}</p>
  `;

  // --- Email al cliente (template dark brand, bilingue) ---
  const htmlCliente = `
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
          <p style="margin:18px 0 0;color:#cccccc;font-size:15px;line-height:1.6;">${t.intro(esc(prenom))}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:30px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ffffff;">
            <tr>
              <td style="padding:18px 24px;border-bottom:1px solid #2a2a2a;color:#b3b3b3;font-size:12px;letter-spacing:2px;text-transform:uppercase;">${t.date}</td>
              <td style="padding:18px 24px;border-bottom:1px solid #2a2a2a;color:#ffffff;font-size:17px;text-align:right;">${esc(dataCliente)}</td>
            </tr>
            <tr>
              <td style="padding:18px 24px;border-bottom:1px solid #2a2a2a;color:#b3b3b3;font-size:12px;letter-spacing:2px;text-transform:uppercase;">${t.time}</td>
              <td style="padding:18px 24px;border-bottom:1px solid #2a2a2a;color:#ffffff;font-size:17px;text-align:right;">${esc(heure)}</td>
            </tr>
            <tr>
              <td style="padding:18px 24px;color:#b3b3b3;font-size:12px;letter-spacing:2px;text-transform:uppercase;">${t.people}</td>
              <td style="padding:18px 24px;color:#ffffff;font-size:17px;text-align:right;">${esc(personnes)}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 30px;">
          <p style="margin:0;color:#cccccc;font-size:14px;line-height:1.7;">${t.body}</p>
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
    const { error: errP } = await resend.emails.send({
      from: FROM,
      to: TO,
      bcc: BCC,
      replyTo: email,
      subject: `Réservation : ${nomeCompleto} — ${dataFr} ${heure} (${personnes} p.)`,
      html: htmlPizzeria,
    });
    if (errP) {
      return new Response(JSON.stringify({ error: "Envoi impossible" }), { status: 502 });
    }

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