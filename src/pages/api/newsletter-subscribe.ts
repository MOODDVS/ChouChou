import type { APIRoute } from "astro";
import crypto from "node:crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "../../lib/db";
import { registraCliente } from "../../lib/registraCliente";
import { datiRistorante } from "../../lib/ristorante";
import { linksSocial } from "../../lib/links";
import { temaEmail, type TemaEmail } from "../../lib/temaBrand";
import { CLIENT } from "../../config/client";

export const prerender = false;

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const resend = new Resend(import.meta.env.RESEND_API_KEY);
const FROM = import.meta.env.RESEND_FROM ?? `${CLIENT.nome} <${CLIENT.email}>`;
const BCC = "enquiries@moodd.online";
const SITE_URL = (process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/logo-email.png`;

// Stesso token della pagina di disiscrizione (/api/newsletter-unsubscribe)
const UNSUB_SECRET = import.meta.env.SUPABASE_SERVICE_KEY ?? "lm-newsletter";
function unsubToken(email: string): string {
  return crypto.createHmac("sha256", UNSUB_SECRET).update(email.toLowerCase()).digest("hex").slice(0, 24);
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Destinatari della notifica interna (Réglages → Général → contact_emails)
async function destinatariNotifica(): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin.from("app_config").select("value").eq("key", "contact_emails").maybeSingle();
    const lista = String(data?.value ?? "").split(",").map((e) => e.trim()).filter(Boolean);
    if (lista.length > 0) return lista;
  } catch { /* fallback */ }
  return [CLIENT.email];
}

type Lang = "fr" | "en";
const T = {
  fr: {
    subject: (n: string) => `Bienvenue au ${n}`,
    kicker: "Bienvenue",
    title: "Vous êtes des nôtres&nbsp;!",
    body: "Merci de vous être inscrit·e à notre newsletter. Vous serez parmi les premiers informés de nos nouveautés, de nos événements et de nos petites attentions gourmandes.",
    ctaPrimary: "Réserver une table",
    ctaSecondary: "ou découvrir la carte",
    follow: "Suivez-nous",
    unsub: "Se désinscrire",
    reserve: "/reservation",
    menu: "/menu",
  },
  en: {
    subject: (n: string) => `Welcome to ${n}`,
    kicker: "Welcome",
    title: "You&rsquo;re one of us!",
    body: "Thanks for subscribing to our newsletter. You&rsquo;ll be among the first to hear about our latest news, events and little gourmet treats.",
    ctaPrimary: "Book a table",
    ctaSecondary: "or discover the menu",
    follow: "Follow us",
    unsub: "Unsubscribe",
    reserve: "/reservation?lang=en",
    menu: "/en/menu",
  },
} as const;

// Wrapper coerente con le email del motore (stesso <body>, media query, bg tema)
function avvolgiTema(inner: string, tema: TemaEmail): string {
  return `<!doctype html>
<html dir="ltr">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light dark" />
<style>
  @media only screen and (max-width:600px){
    .em-card{width:100%!important}
    .em-pad{padding-left:22px!important;padding-right:22px!important}
    .em-wrap{padding-left:8px!important;padding-right:8px!important}
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

function welcomeHtml(
  lang: Lang,
  dati: { nome: string; indirizzo: string; tel: string; email: string; logo: string; logoNeg: string; logoPos: string },
  tema: TemaEmail,
  socialHtml: string,
  unsubUrl: string
): string {
  const t = T[lang];
  const logo = dati.logoPos || `${SITE_URL}/logo-email-navy.png`;

  const card = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:600px;margin:0 auto;background:${tema.card};border:1px solid ${tema.border};border-radius:14px;overflow:hidden;">
      <tr><td style="height:4px;background:${tema.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td class="em-pad" style="padding:40px 44px 20px;text-align:center;">
        <img src="${logo}" alt="${esc(dati.nome)}" width="160" style="display:inline-block;width:160px;max-width:62%;height:auto;border:0;" />
        <p style="margin:18px 0 0;color:${tema.muted};font-size:11px;letter-spacing:4px;">${esc(dati.nome.toUpperCase())}</p>
      </td></tr>
      <tr><td class="em-pad" style="padding:6px 44px 0;text-align:center;">
        <p style="margin:0 0 12px;color:${tema.accent};font-size:11px;letter-spacing:4px;text-transform:uppercase;font-weight:bold;">${t.kicker}</p>
        <h1 style="margin:0;color:${tema.title};font-size:28px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">${t.title}</h1>
      </td></tr>
      <tr><td class="em-pad" style="padding:18px 44px 0;text-align:center;">
        <p style="margin:0;color:${tema.text};font-size:15px;line-height:1.7;">${t.body}</p>
      </td></tr>
      <tr><td class="em-pad" style="padding:30px 44px 4px;text-align:center;">
        <a href="${SITE_URL}${t.reserve}" style="display:inline-block;background:${tema.accent};color:${tema.onAccent};text-decoration:none;padding:15px 42px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:999px;">${t.ctaPrimary} &nbsp;&rarr;</a>
      </td></tr>
      <tr><td class="em-pad" style="padding:14px 44px 30px;text-align:center;">
        <a href="${SITE_URL}${t.menu}" style="color:${tema.muted};font-size:13px;letter-spacing:1px;text-decoration:none;">${t.ctaSecondary} &rarr;</a>
      </td></tr>
      ${socialHtml}
      <tr><td class="em-pad" style="padding:24px 44px 30px;border-top:1px solid ${tema.border};text-align:center;">
        <p style="margin:0;color:${tema.muted};font-size:12px;line-height:1.9;">${esc(dati.nome)} &middot; ${esc(dati.indirizzo)}<br>${esc(dati.tel)} &middot; ${esc(dati.email)}</p>
        <p style="margin:14px 0 0;color:${tema.muted};font-size:11px;letter-spacing:1px;">
          <a href="${unsubUrl}" style="color:${tema.muted};text-decoration:underline;">${t.unsub}</a>
        </p>
        <p style="margin:16px 0 0;"><img src="${SITE_URL}/restohub/wordmark${tema.isDark ? "-negative" : ""}.png" alt="RestoHub" width="100" style="display:inline-block;width:100px;max-width:40%;height:auto;opacity:0.7;border:0;" /></p>
      </td></tr>
    </table>`;

  return avvolgiTema(card, tema);
}

function socialRow(lang: Lang, social: { label: string; url: string }[], tema: TemaEmail): string {
  if (!social.length) return "";
  const t = T[lang];
  const links = social
    .map((s) => `<a href="${s.url}" style="color:${tema.title};font-size:13px;letter-spacing:1px;text-decoration:none;font-weight:bold;">${esc(s.label)}</a>`)
    .join(`<span style="color:${tema.accent};padding:0 10px;">&bull;</span>`);
  return `<tr><td class="em-pad" align="center" style="padding:8px 44px 30px;">
    <p style="margin:0 0 10px;color:${tema.muted};font-size:11px;letter-spacing:3px;text-transform:uppercase;">${t.follow}</p>
    ${links}
  </td></tr>`;
}

// POST /api/newsletter-subscribe
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const first = String(body.first_name ?? "").trim();
  const last = String(body.last_name ?? "").trim();
  const lang: Lang = body.lang === "en" ? "en" : "fr";

  if (!RE_EMAIL.test(email)) return json({ error: "email" }, 400);

  const name = [first, last].filter(Boolean).join(" ").trim();

  // 1) Ajoute / complète dans `clients` (opt-in par défaut)
  await registraCliente({ name: name || null, email, phone: null });

  // 2) Ré-inscription : retire des désinscrits
  try {
    await supabaseAdmin.from("newsletter_optout").delete().ilike("email", email);
  } catch { /* table absente */ }

  // 3) Emails (best-effort : n'empêchent jamais l'inscription)
  try {
    const dati = await datiRistorante();
    const social = await linksSocial();
    const temaBase = await temaEmail();
    // Email newsletter: versione CHIARA (fondo blanc), a prescindere dal tema admin.
    // Si mantiene solo l'accent (couleur brand) dinamico.
    const tema: TemaEmail = {
      ...temaBase,
      bg: "#f4f1ea",
      card: "#ffffff",
      title: "#353c4e",
      text: "#4a4f5c",
      muted: "#8a8f9b",
      border: "rgba(53, 60, 78, 0.12)",
      isDark: false,
    };
    const unsubUrl = `${SITE_URL}/api/newsletter-unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;

    // 3a) Email de bienvenue à l'inscrit
    await resend.emails.send({
      from: FROM,
      to: email,
      bcc: BCC,
      subject: T[lang].subject(dati.nome),
      html: welcomeHtml(lang, dati, tema, socialRow(lang, social, tema), unsubUrl),
    });

    // 3b) Notification SIMPLE (non graphique) au restaurateur
    const quand = new Date().toLocaleString("fr-BE", { timeZone: "Europe/Brussels" });
    await resend.emails.send({
      from: FROM,
      to: await destinatariNotifica(),
      subject: `Nouvelle inscription newsletter — ${dati.nome}`,
      text: `Nouvelle inscription à la newsletter.\n\nEmail : ${email}\nNom : ${name || "—"}\nLangue : ${lang.toUpperCase()}\nDate : ${quand}`,
      html: `<p style="font-family:Arial,sans-serif;font-size:14px;color:#222;">Nouvelle inscription à la newsletter.</p>
<p style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.7;">
<strong>Email :</strong> ${esc(email)}<br>
<strong>Nom :</strong> ${esc(name) || "—"}<br>
<strong>Langue :</strong> ${lang.toUpperCase()}<br>
<strong>Date :</strong> ${esc(quand)}</p>`,
    });
  } catch (e) {
    console.error("[newsletter-subscribe] email KO:", e);
  }

  return json({ ok: true }, 200);
};
