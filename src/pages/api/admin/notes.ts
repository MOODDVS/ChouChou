import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi, inserisci, aggiorna, cancella } from "../../../lib/admin/sede";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

const SELECT = "id, content, author, done, created_at, tags";
const SELECT_BASE = "id, content, author, done, created_at";
const MAX_LEN = 1000;
const TAGS_VALIDI = ["important", "recurrent", "fournisseur"];

/** true se l'errore è "colonna tags assente" (migrazione #34 non lanciata). */
function senzaTags(err: { message?: string } | null): boolean {
  return !!err && String(err.message ?? "").includes("tags");
}

function leggiTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((t) => String(t)).filter((t) => TAGS_VALIDI.includes(t)))];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET /api/admin/notes — tutte le note, attive prima poi le fatte, recenti in cima.
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const ambito = await ambitoDiRichiesta(request, staff);
  let { data, error } = await leggi("admin_notes", ambito, SELECT)
    .order("done", { ascending: true })
    .order("created_at", { ascending: false });
  if (senzaTags(error)) {
    const retry = await leggi("admin_notes", ambito, SELECT_BASE)
      .order("done", { ascending: true })
      .order("created_at", { ascending: false });
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error) return json({ error: await msg("err.read") }, 500);
  return json({ notes: data ?? [] });
};

// POST /api/admin/notes — crea una nota. Autore = email dello staff loggato.
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }

  // Cancellazione via POST: il firewall dell'hosting blocca il metodo
  // DELETE dai browser mobili (403 prima di arrivare all'app), quindi la
  // suppression viaggia come POST { delete_id }.
  const delId = String(body.delete_id ?? "");
  if (delId) {
    if (!/^[0-9a-f-]{36}$/i.test(delId)) return json({ error: await msg("err.id") }, 400);
    const { error } = await cancella("admin_notes", ambito).eq("id", delId);
    if (error) return json({ error: "Suppression impossible : " + String(error.message ?? "") }, 500);
    return json({ ok: true });
  }

  const content = String(body.content ?? "").trim();
  if (!content) return json({ error: await msg("err.noteEmpty") }, 400);
  const author = (staff.email ?? "").slice(0, 120) || null;
  const tags = leggiTags(body.tags);

  let { data, error } = await inserisci("admin_notes", ambito, {
    content: content.slice(0, MAX_LEN), author, tags: tags.length ? tags : null,
  }).select(SELECT).single();
  if (senzaTags(error)) {
    const retry = await inserisci("admin_notes", ambito, {
      content: content.slice(0, MAX_LEN), author,
    }).select(SELECT_BASE).single();
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error || !data) return json({ error: await msg("err.create") }, 500);
  return json({ note: data });
};

// PUT /api/admin/notes — modifica una nota: done (fatto/da fare) e/o content.
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  const campi: Record<string, unknown> = {};
  if ("done" in body) campi.done = !!body.done;
  if ("content" in body) {
    const c = String(body.content ?? "").trim();
    if (!c) return json({ error: await msg("err.noteEmpty") }, 400);
    campi.content = c.slice(0, MAX_LEN);
  }
  if (Object.keys(campi).length === 0) return json({ error: await msg("err.nothing") }, 400);

  let { data, error } = await aggiorna("admin_notes", ambito, campi)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (senzaTags(error)) {
    const retry = await aggiorna("admin_notes", ambito, campi)
      .eq("id", id)
      .select(SELECT_BASE)
      .single();
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error || !data) return json({ error: await msg("err.update") }, 500);
  return json({ note: data });
};

// DELETE /api/admin/notes?id=... — elimina una nota.
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  const { error } = await cancella("admin_notes", ambito).eq("id", id);
  if (error) return json({ error: "Suppression impossible : " + String(error.message ?? "") }, 500);
  return json({ ok: true });
};
