import type { APIRoute } from "astro";
import { msg } from "../../../lib/admin/msgApi";
import { json } from "../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { CLIENT } from "../../../config/client";
import { statoResend, salvaResend, importaDaEnv, togliResend, inviaProva } from "../../../lib/admin/resendStato";

export const prerender = false;

// Super admin → Intégrations → casella Resend (5/11/2026). SOLO super admin.
//
// GET    → lo stato: da dove vengono chiave e mittente (la chiave solo
//          mascherata), il dominio, le email del mese.
// PUT    { chiave?, nome?, email? } → scrive nella casella (chiave cifrata).
// POST   { azione: "prova" }   → e-mail di prova a chi preme il bottone.
//        { azione: "importa" } → copia nella casella la chiave e il
//                                mittente del `.env`.
// DELETE → toglie chiave e mittente dalla casella: torna a valere il `.env`.
//
// Ogni risposta porta lo stato nuovo, cosi' il modale si ridisegna da solo.

async function leggiBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  return json({ ...(await statoResend()), io: staff.email ?? "" });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const body = await leggiBody(request);
  if (!body) return json({ error: await msg("err.body") }, 400);
  const esito = await salvaResend(body, staff.email ?? staff.id);
  return json({ esito, stato: await statoResend() }, esito.ok ? 200 : 400);
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const body = await leggiBody(request);
  if (!body) return json({ error: await msg("err.body") }, 400);
  const azione = String(body.azione ?? "");
  const esito = azione === "prova" ? await inviaProva(staff.email ?? "", CLIENT.nome)
    : azione === "importa" ? await importaDaEnv(staff.email ?? staff.id)
    : null;
  if (!esito) return json({ error: await msg("err.request") }, 400);
  return json({ esito, stato: await statoResend() }, esito.ok ? 200 : 409);
};

export const DELETE: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  const esito = await togliResend();
  return json({ esito, stato: await statoResend() }, esito.ok ? 200 : 409);
};
