import type { APIRoute } from "astro";
import { msg } from "../../../lib/admin/msgApi";
import { json } from "../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { statoCasellaGoogle, salvaGoogle, sincronizzaLivello } from "../../../lib/admin/googleCasella";

export const prerender = false;

// Super admin → Intégrations → casella Google Business (5/11/2026). SOLO super.
//
// GET  → l'account Google (stato vero), e per ogni livello (marchio, sedi):
//        Place ID, link recensioni, scheda, ultimo sync — e se sono SUOI.
// PUT  { livello, place_id?, review_url? } → scrive; un Place ID senza link
//        suo si porta dietro il link generato.
// POST { livello, azione: "sync" } → scarica subito le recensioni.
//
// La scheda si sceglie con /api/admin/google/locations (`sede` = il livello),
// il collegamento con /api/google/connect: non si rifanno qui.

async function leggiBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const livelloDi = (v: unknown) => String(v ?? "").trim().slice(0, 40);

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  return json(await statoCasellaGoogle());
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const body = await leggiBody(request);
  if (!body) return json({ error: await msg("err.body") }, 400);
  const esito = await salvaGoogle(livelloDi(body.livello), body);
  return json({ esito, stato: await statoCasellaGoogle() }, esito.ok ? 200 : 400);
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const body = await leggiBody(request);
  if (!body || body.azione !== "sync") return json({ error: await msg("err.request") }, 400);
  const esito = await sincronizzaLivello(livelloDi(body.livello));
  return json({ esito, stato: await statoCasellaGoogle() }, esito.ok ? 200 : 409);
};
