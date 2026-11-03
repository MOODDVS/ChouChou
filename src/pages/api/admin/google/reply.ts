import type { APIRoute } from "astro";
import { msg } from "../../../../lib/admin/msgApi";
import { json } from "../../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { tokenGoogle, erroreGoogle, nomeRecensione, rispondiRecensione, eliminaRisposta } from "../../../../lib/googleBusiness";
import { ambitoDiRichiesta, aggiorna } from "../../../../lib/admin/sede";

export const prerender = false;



// POST   /api/admin/google/reply            body { reviewId, comment }  -> pubblica/aggiorna la risposta
// DELETE /api/admin/google/reply?reviewId=  (via POST + X-Method-Override) -> elimina la risposta


export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { reviewId?: unknown; comment?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }
  const reviewId = String(body.reviewId ?? "").trim();
  const comment = String(body.comment ?? "").trim();
  if (!reviewId) return json({ error: await msg("err.reviewId") }, 400);
  if (!comment) return json({ error: await msg("err.replyEmpty") }, 400);

  const { token: token, stato: sttoken } = await tokenGoogle();
  if (!token) return json({ error: await erroreGoogle(sttoken) }, 400);
  const ambito = await ambitoDiRichiesta(request, staff);
  const name = await nomeRecensione(reviewId, ambito);
  if (!name) return json({ error: await msg("err.reviewNotFound") }, 404);

  const ok = await rispondiRecensione(token, name, comment);
  if (!ok) return json({ error: await msg("err.replyPublish") }, 502);

  await aggiorna("google_reviews", ambito, { reply_comment: comment, reply_time: new Date().toISOString() })
    .eq("review_id", reviewId);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const reviewId = url.searchParams.get("reviewId") ?? "";
  if (!reviewId) return json({ error: await msg("err.reviewId") }, 400);

  const { token: token, stato: sttoken } = await tokenGoogle();
  if (!token) return json({ error: await erroreGoogle(sttoken) }, 400);
  const ambito = await ambitoDiRichiesta(request, staff);
  const name = await nomeRecensione(reviewId, ambito);
  if (!name) return json({ error: await msg("err.reviewNotFound") }, 404);

  const ok = await eliminaRisposta(token, name);
  if (!ok) return json({ error: await msg("err.replyDelete") }, 502);

  await aggiorna("google_reviews", ambito, { reply_comment: null, reply_time: null })
    .eq("review_id", reviewId);
  return json({ ok: true });
};
