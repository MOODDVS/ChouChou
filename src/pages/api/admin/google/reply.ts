import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { accessToken, nomeRecensione, rispondiRecensione, eliminaRisposta } from "../../../../lib/googleBusiness";

export const prerender = false;

// POST   /api/admin/google/reply            body { reviewId, comment }  -> pubblica/aggiorna la risposta
// DELETE /api/admin/google/reply?reviewId=  (via POST + X-Method-Override) -> elimina la risposta

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { reviewId?: unknown; comment?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const reviewId = String(body.reviewId ?? "").trim();
  const comment = String(body.comment ?? "").trim();
  if (!reviewId) return json({ error: "reviewId manquant" }, 400);
  if (!comment) return json({ error: "Réponse vide" }, 400);

  const token = await accessToken();
  if (!token) return json({ error: "Google non collegato" }, 400);
  const name = await nomeRecensione(reviewId);
  if (!name) return json({ error: "Avis introuvable" }, 404);

  const ok = await rispondiRecensione(token, name, comment);
  if (!ok) return json({ error: "Publication de la réponse impossible" }, 502);

  await supabaseAdmin
    .from("google_reviews")
    .update({ reply_comment: comment, reply_time: new Date().toISOString() })
    .eq("review_id", reviewId);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const reviewId = url.searchParams.get("reviewId") ?? "";
  if (!reviewId) return json({ error: "reviewId manquant" }, 400);

  const token = await accessToken();
  if (!token) return json({ error: "Google non collegato" }, 400);
  const name = await nomeRecensione(reviewId);
  if (!name) return json({ error: "Avis introuvable" }, 404);

  const ok = await eliminaRisposta(token, name);
  if (!ok) return json({ error: "Suppression de la réponse impossible" }, 502);

  await supabaseAdmin
    .from("google_reviews")
    .update({ reply_comment: null, reply_time: null })
    .eq("review_id", reviewId);
  return json({ ok: true });
};
