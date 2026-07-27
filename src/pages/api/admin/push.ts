import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { inviaPush } from "../../../lib/push";

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// POST { subscription } -> salva l'iscrizione del device.
// POST { test: true }   -> invia una notifica di prova a tutti i device iscritti.
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; test?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  if (body.test) {
    const r = await inviaPush({ title: "MOODD", body: "Les notifications fonctionnent \u2713", url: "/admin" });
    return json({ ok: true, sent: r.sent, found: r.found, err: r.errors[0] ?? null });
  }
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return json({ error: "Subscription invalide" }, 400);
  }
  const email = (staff as { email?: string }).email ?? null;
  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .upsert({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_email: email }, { onConflict: "endpoint" });
  if (error) return json({ error: "Enregistrement impossible" }, 500);
  return json({ ok: true });
};

// DELETE ?endpoint=  -> disattiva (rimuove) l'iscrizione di questo device.
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const endpoint = url.searchParams.get("endpoint") ?? "";
  if (endpoint) {
    try { await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", endpoint); } catch { /* best-effort */ }
  }
  return json({ ok: true });
};
