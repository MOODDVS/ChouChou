import type { APIRoute } from "astro";
import crypto from "node:crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/adminAuth";
import { statoQuota, QUOTA_MESE } from "../../../lib/newsletterQuota";

export const prerender = false;

// Newsletter (admin Marketing → Newsletter).
// GET  → stato: inviate questo mese, quota, destinatari raggiungibili, storico.
// POST → invio: { subject, message, image_url?, btn_label?, btn_url?, test? }
//   - test: true  → una sola email all'indirizzo dello staff loggato
//   - test assente → invio a TUTTI i clienti (rubrica ordini + manuali),
//     esclusi i disiscritti, nel limite di 1000 email per mese solare.
// Ogni email contiene il link di disiscrizione obbligatorio.

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const RESEND_FROM = import.meta.env.RESEND_FROM;
const SITE_URL = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
const SECRET = import.meta.env.SUPABASE_SERVICE_KEY ?? "lm-newsletter";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Token anti-abuso del link di disiscrizione (HMAC dell'email). */
function tokenDisiscrizione(email: string): string {
  return crypto.createHmac("sha256", SECRET).update(email.toLowerCase()).digest("hex").slice(0, 24);
}

/** Rubrica: email uniche dagli ordini incassati + clienti manuali,
 *  meno i nascosti e i disiscritti. */
async function destinatari(): Promise<string[]> {
  const emails = new Set<string>();
  const nascosti = new Set<string>();

  const PAGINA = 1000;
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("customer_email")
      .in("status", ["paid", "done"])
      .range(da, da + PAGINA - 1);
    if (error) break;
    for (const r of data ?? []) {
      const e = (r.customer_email ?? "").trim().toLowerCase();
      if (e) emails.add(e);
    }
    if (!data || data.length < PAGINA) break;
  }

  const { data: manuali } = await supabaseAdmin.from("clients").select("email, hidden");
  for (const r of manuali ?? []) {
    const e = (r.email ?? "").trim().toLowerCase();
    if (!e) continue;
    if (r.hidden) nascosti.add(e);
    else emails.add(e);
  }
  for (const e of nascosti) emails.delete(e);

  const { data: optout } = await supabaseAdmin.from("newsletter_optout").select("email");
  for (const r of optout ?? []) emails.delete((r.email ?? "").toLowerCase());

  return [...emails];
}

function htmlNewsletter(input: {
  subject: string;
  message: string;
  image_url?: string;
  btn_label?: string;
  btn_url?: string;
  email: string;
}): string {
  const logo = `${SITE_URL.replace(/\/$/, "")}/icon-512.png`;
  const unsub = `${SITE_URL.replace(/\/$/, "")}/api/newsletter-unsubscribe?e=${encodeURIComponent(input.email)}&t=${tokenDisiscrizione(input.email)}`;
  const img = input.image_url
    ? `<tr><td><img src="${esc(input.image_url)}" alt="" width="600" style="display:block;width:100%;max-height:280px;object-fit:cover;border:0;" /></td></tr>`
    : "";
  const btn = input.btn_label && input.btn_url
    ? `<tr><td style="padding:6px 40px 10px;text-align:center;">
        <a href="${esc(input.btn_url)}" style="display:inline-block;background:#dfab4e;color:#231f20;text-decoration:none;padding:14px 34px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;border-radius:10px;">${esc(input.btn_label)}</a>
      </td></tr>`
    : "";

  return `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#1c1819; padding:30px 0; margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#231f20;border:1px solid #3a3335;">
      <tr>
        <td style="padding:36px 40px 18px;text-align:center;">
          <img src="${logo}" alt="La Molisana" width="64" height="64" style="display:inline-block;border:0;border-radius:12px;" />
          <p style="margin:16px 0 0;color:#dfab4e;font-size:11px;letter-spacing:4px;font-family:Georgia,'Times New Roman',serif;">LA MOLISANA — PIZZA &amp; PASTA</p>
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
      <tr>
        <td style="padding:16px 40px 8px;text-align:center;">
          <div style="height:4px;max-width:180px;margin:0 auto 20px;background:linear-gradient(90deg,#007153 0%,#007153 33%,#ffffff 33%,#ffffff 66%,#ed1c24 66%,#ed1c24 100%);"></div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 28px;border-top:1px solid #3a3335;">
          <p style="margin:20px 0 0;color:#8f8781;font-size:12px;line-height:1.8;text-align:center;">
            Av. Adolphe Demeur 37, 1060 Saint-Gilles — Bruxelles<br>+32 455 13 14 65 · pizzeria@lamolisana.be<br>
            Vous recevez cet email car vous êtes client de La Molisana.
            <a href="${unsub}" style="color:#b3aca6;">Se désinscrire</a>
          </p>
        </td>
      </tr>
    </table>
  </div>`;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const [quota, dest, { data: log }] = await Promise.all([
    statoQuota(),
    destinatari(),
    supabaseAdmin
      .from("newsletter_log")
      .select("subject, count, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  return json({
    sent_this_month: quota.sent_this_month,
    quota: QUOTA_MESE,
    remaining: quota.total_remaining,
    purchased_balance: quota.purchased_balance,
    recipients: dest.length,
    history: log ?? [],
  });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  if (!resend || !RESEND_FROM) {
    return json({ error: "Resend non configuré (RESEND_API_KEY / RESEND_FROM)" }, 500);
  }

  let body: {
    subject?: string;
    message?: string;
    image_url?: string;
    btn_label?: string;
    btn_url?: string;
    test?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const subject = (body.subject ?? "").trim();
  const message = (body.message ?? "").trim();
  if (!subject) return json({ error: "L'objet est obligatoire" }, 400);
  if (!message) return json({ error: "Le message est obligatoire" }, 400);

  const contenuto = {
    subject,
    message,
    image_url: (body.image_url ?? "").trim(),
    btn_label: (body.btn_label ?? "").trim(),
    btn_url: (body.btn_url ?? "").trim(),
  };

  // ---- Invio di TEST: solo all'email dello staff loggato ----
  if (body.test === true) {
    const dest = staff.email ?? "";
    if (!dest) return json({ error: "Email du compte staff introuvable" }, 400);
    try {
      await resend.emails.send({
        from: RESEND_FROM,
        to: dest,
        subject: `[TEST] ${subject}`,
        html: htmlNewsletter({ ...contenuto, email: dest }),
      });
    } catch {
      return json({ error: "Envoi du test impossible" }, 502);
    }
    return json({ ok: true, test: true, to: dest });
  }

  // ---- Invio reale: quota (incluse del mese + crediti acquistati) ----
  const quota = await statoQuota();
  const dest = await destinatari();

  if (dest.length === 0) return json({ error: "Aucun destinataire" }, 400);
  if (dest.length > quota.total_remaining) {
    return json(
      { error: `Quota insuffisant : ${dest.length} destinataires, ${quota.total_remaining} envois disponibles (${quota.free_remaining} inclus ce mois-ci + ${quota.purchased_balance} crédits). Achetez des crédits pour continuer.` },
      409
    );
  }

  // Batch Resend: max 100 email per chiamata, piccola pausa tra i lotti.
  let inviateOra = 0;
  try {
    for (let i = 0; i < dest.length; i += 100) {
      const lotto = dest.slice(i, i + 100).map((email) => ({
        from: RESEND_FROM as string,
        to: email,
        subject,
        html: htmlNewsletter({ ...contenuto, email }),
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
      await supabaseAdmin.from("newsletter_log").insert({ subject, count: inviateOra });
    }
    return json({ error: `Envoi interrompu après ${inviateOra} emails. Réessayez plus tard.` }, 502);
  }

  await supabaseAdmin.from("newsletter_log").insert({ subject, count: inviateOra });
  return json({ ok: true, sent: inviateOra });
};
