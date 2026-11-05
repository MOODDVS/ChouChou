import type { APIRoute } from "astro";
import { msg } from "../../../lib/admin/msgApi";
import { json } from "../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { statoSupabase, applicaPasso } from "../../../lib/admin/supabaseStato";
import { PASSI, type Passo } from "../../../lib/admin/supabaseRegole";

export const prerender = false;

// Super admin → Intégrations → casella Supabase (5/11/2026). SOLO super admin.
//
// GET  → lo stato del database: chiavi (confrontate, mai mostrate), migrazioni,
//        spazi di archivio, estensioni, job pg_cron.
// POST { passo: "estensioni" | "migrazioni" | "bucket" | "cron" }
//      → fa quel passo e rende lo stato nuovo. Le migrazioni vanno a pezzi
//        di ~8 s: la risposta dice quante `restano`, e il browser richiama.
//
// ⚠️ Deve funzionare anche su un database VUOTO: e' proprio la casella che lo
// riempie. Niente letture di tabelle del motore prima di aver controllato.

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  return json(await statoSupabase());
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  let body: { passo?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }
  const passo = String(body.passo ?? "") as Passo;
  if (!PASSI.includes(passo)) return json({ error: await msg("err.request") }, 400);
  const esito = await applicaPasso(passo);
  return json({ esito, stato: await statoSupabase() }, esito.ok ? 200 : 409);
};
