import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { statoQuota } from "../../../lib/admin/newsletterQuota";
import {
  parseSegment,
  contatoriSegmenti,
  inviaNewsletter,
  inviaTest,
  resendPronto,
} from "../../../lib/newsletterSend";

export const prerender = false;

// Newsletter (admin Marketing → Newsletter). Motore d'invio in lib/newsletterSend.
// GET  → stato: inviate questo mese, quota, segmenti (con conteggi), storico.
// POST → invio: { subject, message, image_url?, btn_label?, btn_url?, segment?, test? }
//   - test: true  → una sola email all'indirizzo dello staff loggato
//   - segment     → 'tous' (default) | 'nouveaux' | 'fr' | 'en' | 'top50' | 'resa' | 'commande'
//     invio al GRUPPO scelto, esclusi i disiscritti, nel limite di
//     1000 email/mese + crediti acquistati.
// Ogni email contiene il link di disiscrizione obbligatorio.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const [quota, seg] = await Promise.all([statoQuota(), contatoriSegmenti()]);
  // Storico: prova con le colonne extra (card), fallback al log basico
  let log: unknown[] = [];
  {
    const esteso = await supabaseAdmin
      .from("newsletter_log")
      .select("subject, count, created_at, image_url, message, segment, btn_label, btn_url, btn2_label, btn2_url")
      .order("created_at", { ascending: false })
      .limit(12);
    if (!esteso.error) {
      log = esteso.data ?? [];
    } else {
      const basico = await supabaseAdmin
        .from("newsletter_log")
        .select("subject, count, created_at")
        .order("created_at", { ascending: false })
        .limit(12);
      log = basico.data ?? [];
    }
  }

  return json({
    sent_this_month: quota.sent_this_month,
    quota: quota.monthly_quota,
    remaining: quota.total_remaining,
    purchased_balance: quota.purchased_balance,
    recipients: seg.counts.tous?.tous ?? 0,
    opted_out: seg.esclusi,
    segments: seg.counts,
    history: log,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  if (!resendPronto()) {
    return json({ error: "Resend non configuré (RESEND_API_KEY / RESEND_FROM)" }, 500);
  }

  let body: {
    subject?: string;
    message?: string;
    image_url?: string;
    btn_label?: string;
    btn_url?: string;
    btn2_label?: string;
    btn2_url?: string;
    segment?: string;
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
    btn2_label: (body.btn2_label ?? "").trim(),
    btn2_url: (body.btn2_url ?? "").trim(),
  };
  const { lang, group } = parseSegment(String(body.segment ?? ""));

  // ---- Invio di TEST: solo all'email dello staff loggato ----
  if (body.test === true) {
    const dest = staff.email ?? "";
    if (!dest) return json({ error: "Email du compte staff introuvable" }, 400);
    const ok = await inviaTest(dest, contenuto);
    if (!ok) return json({ error: "Envoi du test impossible" }, 502);
    return json({ ok: true, test: true, to: dest });
  }

  // ---- Invio reale al segmento ----
  const esito = await inviaNewsletter(contenuto, lang, group);
  if (!esito.ok) return json({ error: esito.error }, esito.status);
  return json({ ok: true, sent: esito.sent });
};
