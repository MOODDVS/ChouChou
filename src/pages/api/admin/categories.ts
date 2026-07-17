import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET /api/admin/categories — sezioni ordinate + numero piatti
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const { data: cats, error } = await supabaseAdmin
    .from("menu_categories")
    .select("id, name, sort_order, kind")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return json({ error: "Lecture impossible" }, 500);

  const { data: righe, error: errItems } = await supabaseAdmin
    .from("menu_items")
    .select("category");
  if (errItems) return json({ error: "Lecture impossible" }, 500);

  const conteggi = new Map<string, number>();
  for (const r of righe ?? []) {
    conteggi.set(r.category, (conteggi.get(r.category) ?? 0) + 1);
  }

  return json({
    categories: (cats ?? []).map((c) => ({ ...c, count: conteggi.get(c.name) ?? 0 })),
  });
};

// POST /api/admin/categories — crea una sezione (kind: food | drink)
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { name?: string; kind?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (!name) return json({ error: "Nom requis" }, 400);
  const kind = body.kind === "drink" ? "drink" : "food";

  const { data: max } = await supabaseAdmin
    .from("menu_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort_order = (max?.sort_order ?? 0) + 1;

  const { data, error } = await supabaseAdmin
    .from("menu_categories")
    .insert({ name, sort_order, kind })
    .select("id, name, sort_order, kind")
    .single();

  if (error) {
    if (error.code === "23505") return json({ error: "Cette section existe déjà" }, 400);
    return json({ error: "Création impossible" }, 500);
  }
  return json({ category: data });
};

// PUT /api/admin/categories — rinomina, riordina e/o cambia tipo.
// Nome e ordine si propagano ai piatti (category / category_order).
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { id?: string; name?: string; sort_order?: number; kind?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const { data: attuale, error: errCur } = await supabaseAdmin
    .from("menu_categories")
    .select("id, name, sort_order")
    .eq("id", id)
    .single();
  if (errCur || !attuale) return json({ error: "Section introuvable" }, 404);

  const campi: Record<string, unknown> = {};
  if ("name" in body) {
    const name = String(body.name ?? "").trim().slice(0, 60);
    if (!name) return json({ error: "Nom requis" }, 400);
    campi.name = name;
  }
  if ("sort_order" in body) {
    const n = Math.floor(Number(body.sort_order));
    if (!Number.isFinite(n) || n < 0 || n > 999) return json({ error: "Ordre invalide" }, 400);
    campi.sort_order = n;
  }
  if ("kind" in body) {
    if (body.kind !== "food" && body.kind !== "drink") return json({ error: "Type invalide" }, 400);
    campi.kind = body.kind;
  }
  if (Object.keys(campi).length === 0) return json({ error: "Rien à modifier" }, 400);

  const { error: errUpd } = await supabaseAdmin
    .from("menu_categories")
    .update(campi)
    .eq("id", id);
  if (errUpd) {
    if (errUpd.code === "23505") return json({ error: "Cette section existe déjà" }, 400);
    return json({ error: "Modification impossible" }, 500);
  }

  // Propaga ai piatti della sezione (nome vecchio -> nuovo, ordine).
  // Il kind riguarda solo la sezione: niente da propagare.
  const aggiornaPiatti: Record<string, unknown> = {};
  if ("name" in campi) aggiornaPiatti.category = campi.name;
  if ("sort_order" in campi) aggiornaPiatti.category_order = campi.sort_order;
  if (Object.keys(aggiornaPiatti).length > 0) {
    const { error: errItems } = await supabaseAdmin
      .from("menu_items")
      .update(aggiornaPiatti)
      .eq("category", attuale.name);
    if (errItems) return json({ error: "Plats non synchronisés" }, 500);
  }

  return json({ ok: true });
};

// PATCH /api/admin/categories — riordina TUTTE le sezioni in un colpo.
// body: { order: [id, id, ...] } nell'ordine desiderato (drag & drop).
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { order?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  const order = body.order;
  if (!Array.isArray(order) || order.length === 0) return json({ error: "Ordre requis" }, 400);
  if (order.some((id) => !/^[0-9a-f-]{36}$/i.test(String(id)))) return json({ error: "Id invalide" }, 400);
  if (new Set(order).size !== order.length) return json({ error: "Doublons dans l'ordre" }, 400);

  const { data: tutte, error: errCats } = await supabaseAdmin
    .from("menu_categories")
    .select("id, name");
  if (errCats || !tutte) return json({ error: "Lecture impossible" }, 500);
  const perId = new Map(tutte.map((c) => [c.id, c.name]));
  if (order.length !== tutte.length || order.some((id) => !perId.has(id))) {
    return json({ error: "Liste incomplète" }, 400);
  }

  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const { error: e1 } = await supabaseAdmin
      .from("menu_categories")
      .update({ sort_order: i + 1 })
      .eq("id", id);
    if (e1) return json({ error: "Enregistrement impossible" }, 500);
    const { error: e2 } = await supabaseAdmin
      .from("menu_items")
      .update({ category_order: i + 1 })
      .eq("category", perId.get(id)!);
    if (e2) return json({ error: "Plats non synchronisés" }, 500);
  }
  return json({ ok: true });
};

// DELETE /api/admin/categories?id=... — solo se la sezione è vuota
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const { data: cat, error: errCur } = await supabaseAdmin
    .from("menu_categories")
    .select("name")
    .eq("id", id)
    .single();
  if (errCur || !cat) return json({ error: "Section introuvable" }, 404);

  const { count, error: errCount } = await supabaseAdmin
    .from("menu_items")
    .select("id", { count: "exact", head: true })
    .eq("category", cat.name);
  if (errCount) return json({ error: "Vérification impossible" }, 500);
  if ((count ?? 0) > 0) {
    return json({ error: "Section non vide : déplace ou supprime d'abord ses plats" }, 400);
  }

  const { error } = await supabaseAdmin.from("menu_categories").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
