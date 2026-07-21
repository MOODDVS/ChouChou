import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

const SELECT = "id, content, author, done, created_at";
const MAX_LEN = 1000;

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

  const { data, error } = await supabaseAdmin
    .from("admin_notes")
    .select(SELECT)
    .order("done", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return json({ error: "Lecture impossible" }, 500);
  return json({ notes: data ?? [] });
};

// POST /api/admin/notes — crea una nota. Autore = email dello staff loggato.
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  // Cancellazione via POST: il firewall dell'hosting blocca il metodo
  // DELETE dai browser mobili (403 prima di arrivare all'app), quindi la
  // suppression viaggia come POST { delete_id }.
  const delId = String(body.delete_id ?? "");
  if (delId) {
    if (!/^[0-9a-f-]{36}$/i.test(delId)) return json({ error: "Id invalide" }, 400);
    const { error } = await supabaseAdmin.from("admin_notes").delete().eq("id", delId);
    if (error) return json({ error: "Suppression impossible : " + String(error.message ?? "") }, 500);
    return json({ ok: true });
  }

  const content = String(body.content ?? "").trim();
  if (!content) return json({ error: "Note vide" }, 400);
  const author = (staff.email ?? "").slice(0, 120) || null;

  const { data, error } = await supabaseAdmin
    .from("admin_notes")
    .insert({ content: content.slice(0, MAX_LEN), author })
    .select(SELECT)
    .single();

  if (error || !data) return json({ error: "Création impossible" }, 500);
  return json({ note: data });
};

// PUT /api/admin/notes — modifica una nota: done (fatto/da fare) e/o content.
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const campi: Record<string, unknown> = {};
  if ("done" in body) campi.done = !!body.done;
  if ("content" in body) {
    const c = String(body.content ?? "").trim();
    if (!c) return json({ error: "Note vide" }, 400);
    campi.content = c.slice(0, MAX_LEN);
  }
  if (Object.keys(campi).length === 0) return json({ error: "Rien à modifier" }, 400);

  const { data, error } = await supabaseAdmin
    .from("admin_notes")
    .update(campi)
    .eq("id", id)
    .select(SELECT)
    .single();

  if (error || !data) return json({ error: "Modification impossible" }, 500);
  return json({ note: data });
};

// DELETE /api/admin/notes?id=... — elimina una nota.
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const { error } = await supabaseAdmin.from("admin_notes").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible : " + String(error.message ?? "") }, 500);
  return json({ ok: true });
};
