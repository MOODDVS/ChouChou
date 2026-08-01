import type { APIRoute } from "astro";
import crypto from "node:crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "../../lib/db";
import { registraCliente } from "../../lib/registraCliente";
import { datiRistorante } from "../../lib/ristorante";
import { linksSocial } from "../../lib/links";
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
    cta: "Découvrir la carte",
    cta2: "ou réserver une table",
    follow: "Suivez-nous",
    unsub: "Se désinscrire",
    menu: "/menu",
  },
  en: {
    subject: (n: string) => `Welcome to ${n}`,
    kicker: "Welcome",
    title: "You&rsquo;re one of us!",
    body: "Thanks for subscribing to our newsletter. You&rsquo;ll be among the first to hear about our latest news, events and little gourmet treats.",
    cta: "See the menu",
    cta2: "or book a table",
    follow: "Follow us",
    unsub: "Unsubscribe",
    menu: "/en/menu",
  },
} as const;

function welcomeHtml(lang: Lang, dati: { nome: string; indirizzo: string; tel: string; email: string }, socialHtml: string, unsubUrl: string): string {
  const t = T[lang];
  return `
  <div style="margin:0;padding:28px 12px;background:#20242f;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#20242f;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#353c4e;border:1px solid rgba(247,244,238,0.12);">
          <tr><td align="center" style="padding:40px 40px 8px;">
            <img src="${LOGO_URL}" alt="${esc(dati.nome)}" width="260" style="display:block;width:260px;max-width:70%;height:auto;border:0;" />
          </td></tr>
          <tr><td align="center" style="padding:22px 40px 0;">
            <p style="margin:0 0 12px;color:#ed2289;font-size:12px;letter-spacing:4px;text-transform:uppercase;font-weight:bold;">${t.kicker}</p>
            <h1 style="margin:0;color:#f7f4ee;font-size:27px;line-height:1.25;font-weight:600;">${t.title}</h1>
          </td></tr>
          <tr><td style="padding:20px 44px 6px;">
            <p style="margin:0;color:#d8dae2;font-size:15px;line-height:1.7;text-align:center;">${t.body}</p>
          </td></tr>
          <tr><td align="center" style="padding:28px 40px 6px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ed2289;">
              <a href="${SITE_URL}${t.menu}" style="display:inline-block;padding:15px 34px;color:#ffffff;font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;text-decoration:none;">${t.cta} &nbsp;&rarr;</a>
            </td></tr></table>
          </td></tr>
          <tr><td align="center" style="padding:4px 40px 30px;">
            <a href="${SITE_URL}/" style="color:#b9bed0;font-size:13px;letter-spacing:1px;text-decoration:none;">${t.cta2} &rarr;</a>
          </td></tr>
          ${socialHtml}
          <tr><td style="padding:0 40px;"><div style="border-top:1px solid rgba(247,244,238,0.12);height:1px;line-height:1px;">&nbsp;</div></td></tr>
          <tr><td align="center" style="padding:22px 40px 34px;">
            <p style="margin:0;color:#8f95a8;font-size:12px;line-height:1.8;">${esc(dati.nome)} · ${esc(dati.indirizzo)}<br>${esc(dati.tel)} · ${esc(dati.email)}</p>
            <p style="margin:14px 0 0;color:#7a8098;font-size:11px;letter-spacing:1px;">
              <a href="${unsubUrl}" style="color:#b9bed0;text-decoration:underline;">${t.unsub}</a> &nbsp;·&nbsp; <span style="color:#7a8098;">Powered by MOODD</span>
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;
}

function socialRow(lang: Lang, social: { label: string; url: string }[]): string {
  if (!social.length) return "";
  const t = T[lang];
  const links = social
    .map((s) => `<a href="${s.url}" style="color:#f7f4ee;font-size:13px;letter-spacing:1px;text-decoration:none;font-weight:bold;">${esc(s.label)}</a>`)
    .join(`<span style="color:#ed2289;padding:0 10px;">&bull;</span>`);
  return `<tr><td align="center" style="padding:6px 40px 30px;">
    <p style="margin:0 0 10px;color:#8f95a8;font-size:11px;letter-spacing:3px;text-transform:uppercase;">${t.follow}</p>
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
    const unsubUrl = `${SITE_URL}/api/newsletter-unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;

    // 3a) Email de bienvenue à l'inscrit
    await resend.emails.send({
      from: FROM,
      to: email,
      bcc: BCC,
      subject: T[lang].subject(dati.nome),
      html: welcomeHtml(lang, dati, socialRow(lang, social), unsubUrl),
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
