import type { APIRoute } from "astro";
import { msg } from "../../../lib/admin/msgApi";
import { json } from "../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { statoStripe, salvaStripe, togliStripe, importaStripe, creaWebhook } from "../../../lib/admin/stripeStato";

export const prerender = false;

// Super admin → Intégrations → casella Stripe (5/11/2026). SOLO super admin.
//
// Livelli: «marchio» (brand_secrets, #95) e ogni sede (location_secrets).
// La sede senza chiave sua eredita dal marchio, il marchio dal `.env`.
//
// GET    ?livello=        → riepilogo di tutti i livelli; con `livello`
//                           anche quello che Stripe dice di quel conto.
// `conto`: "principale" (default), l'id di un conto alternativo (#96) o,
// per PUT, "nuovo" (lo crea: servono nome e chiave).
//
// PUT    { livello, conto?, nome?, chiave?, firma? } → scrive (cifrato, sola scrittura).
// POST   { livello, conto?, azione: "webhook" } → crea il webhook su Stripe e
//                                         ne salva il segreto accanto alla chiave.
//        { azione: "importa" }          → copia nel marchio le chiavi del `.env`.
// DELETE { livello, conto? } → principale: toglie chiave e firma PROPRIE
//        (torna a ereditare); alternativo: toglie il conto.
//
// ⚠️ Nessun segreto in risposta: solo `sk_live_••••xxxx` e la fonte.

async function leggiBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const livelloDi = (v: unknown) => String(v ?? "").trim().slice(0, 40);

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  return json(await statoStripe(livelloDi(url.searchParams.get("livello")) || undefined, livelloDi(url.searchParams.get("conto")) || undefined));
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const body = await leggiBody(request);
  if (!body) return json({ error: await msg("err.body") }, 400);
  const livello = livelloDi(body.livello);
  const esito = await salvaStripe(livello, body, staff.email ?? staff.id);
  // Un conto appena creato si riapre col suo id.
  const conto = esito.ok ? esito.conto : livelloDi(body.conto) || undefined;
  return json({ esito, stato: await statoStripe(livello, conto) }, esito.ok ? 200 : 400);
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const body = await leggiBody(request);
  if (!body) return json({ error: await msg("err.body") }, 400);
  const livello = livelloDi(body.livello) || "marchio";
  const azione = String(body.azione ?? "");
  const conto = livelloDi(body.conto) || undefined;
  const esito = azione === "webhook" ? await creaWebhook(livello, staff.email ?? staff.id, conto)
    : azione === "importa" ? await importaStripe(staff.email ?? staff.id)
    : null;
  if (!esito) return json({ error: await msg("err.request") }, 400);
  return json({ esito, stato: await statoStripe(livello, conto) }, esito.ok ? 200 : 409);
};

export const DELETE: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const body = await leggiBody(request);
  const livello = livelloDi(body?.livello);
  const conto = livelloDi(body?.conto) || undefined;
  const esito = await togliStripe(livello, conto);
  return json({ esito, stato: await statoStripe(livello, esito.ok ? undefined : conto) }, esito.ok ? 200 : 409);
};
