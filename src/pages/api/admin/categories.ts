import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

const MAX_DEPTH = 3; // radice=0, poi -, --, --- (3 sotto-livelli)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type Cat = { id: string; name: string; sort_order: number; kind: string; parent_id: string | null; depth: number };

/** Legge tutte le sezioni. Tollerante se parent_id/depth non sono migrate. */
async function leggiCategorie(): Promise<Cat[] | null> {
  let res = await supabaseAdmin
    .from("menu_categories")
    .select("id, name, sort_order, kind, parent_id, depth");
  if (res.error && (String(res.error.message ?? "").includes("parent_id") || String(res.error.message ?? "").includes("depth"))) {
    const base = await supabaseAdmin.from("menu_categories").select("id, name, sort_order, kind");
    if (base.error) return null;
    return (base.data ?? []).map((c) => ({ ...(c as Omit<Cat, "parent_id" | "depth">), parent_id: null, depth: 0 }));
  }
  if (res.error) return null;
  return (res.data ?? []) as Cat[];
}

/** Ordina le categorie in profondità (depth-first) rispettando sort_order. */
function ordineAlbero(cats: Cat[]): Cat[] {
  const figli = new Map<string | null, Cat[]>();
  for (const c of cats) {
    const k = c.parent_id ?? null;
    if (!figli.has(k)) figli.set(k, []);
    figli.get(k)!.push(c);
  }
  for (const arr of figli.values()) arr.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const out: Cat[] = [];
  const visita = (pid: string | null) => {
    for (const c of figli.get(pid) ?? []) {
      out.push(c);
      visita(c.id);
    }
  };
  visita(null);
  return out;
}

// GET /api/admin/categories — sezioni (ad albero) + numero piatti
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const cats = await leggiCategorie();
  if (!cats) return json({ error: "Lecture impossible" }, 500);

  const { data: righe, error: errItems } = await supabaseAdmin.from("menu_items").select("category");
  if (errItems) return json({ error: "Lecture impossible" }, 500);
  const conteggi = new Map<string, number>();
  for (const r of righe ?? []) conteggi.set(r.category, (conteggi.get(r.category) ?? 0) + 1);

  // Anche i figli di una categoria la rendono "non vuota" (per il vincolo di eliminazione)
  const nFigli = new Map<string, number>();
  for (const c of cats) if (c.parent_id) nFigli.set(c.parent_id, (nFigli.get(c.parent_id) ?? 0) + 1);

  const ordinate = ordineAlbero(cats).map((c) => ({
    ...c,
    count: conteggi.get(c.name) ?? 0,
    children: nFigli.get(c.id) ?? 0,
  }));
  return json({ categories: ordinate });
};

// POST /api/admin/categories — crea una sezione (radice o sotto-categoria)
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { name?: string; kind?: string; parent_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (!name) return json({ error: "Nom requis" }, 400);
  const kind = body.kind === "drink" ? "drink" : "food";

  let parent_id: string | null = null;
  let depth = 0;
  const pid = String(body.parent_id ?? "").trim();
  if (pid) {
    if (!/^[0-9a-f-]{36}$/i.test(pid)) return json({ error: "Parent invalide" }, 400);
    const { data: parent } = await supabaseAdmin
      .from("menu_categories")
      .select("id, depth")
      .eq("id", pid)
      .maybeSingle();
    if (!parent) return json({ error: "Section parente introuvable" }, 400);
    depth = Number((parent as { depth?: number }).depth ?? 0) + 1;
    if (depth > MAX_DEPTH) return json({ error: `Profondeur max ${MAX_DEPTH} atteinte` }, 400);
    parent_id = pid;
  }

  const { data: max } = await supabaseAdmin
    .from("menu_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort_order = (max?.sort_order ?? 0) + 1;

  const { data, error } = await supabaseAdmin
    .from("menu_categories")
    .insert({ name, sort_order, kind, parent_id, depth })
    .select("id, name, sort_order, kind, parent_id, depth")
    .single();
  if (error) {
    if (error.code === "23505") return json({ error: "Cette section existe déjà" }, 400);
    return json({ error: "Création impossible" }, 500);
  }
  return json({ category: data });
};

// PUT /api/admin/categories — rinomina / cambia tipo / sposta (parent).
// Nome e ordine si propagano ai piatti (category / category_order).
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { id?: string; name?: string; sort_order?: number; kind?: string; parent_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const cats = await leggiCategorie();
  if (!cats) return json({ error: "Lecture impossible" }, 500);
  const attuale = cats.find((c) => c.id === id);
  if (!attuale) return json({ error: "Section introuvable" }, 404);

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

  // Spostamento (cambio parent): ricalcola depth del nodo e del suo sotto-albero
  let subtreeUpdates: { id: string; depth: number }[] = [];
  if ("parent_id" in body) {
    const nuovoPid = body.parent_id ? String(body.parent_id).trim() : null;
    if (nuovoPid) {
      if (!/^[0-9a-f-]{36}$/i.test(nuovoPid)) return json({ error: "Parent invalide" }, 400);
      if (nuovoPid === id) return json({ error: "Parent invalide" }, 400);
      const parent = cats.find((c) => c.id === nuovoPid);
      if (!parent) return json({ error: "Section parente introuvable" }, 400);
      // no cicli: il nuovo parent non deve stare nel sotto-albero del nodo
      const discendenti = new Set<string>();
      const raccogli = (pid: string) => {
        for (const c of cats) if (c.parent_id === pid) { discendenti.add(c.id); raccogli(c.id); }
      };
      raccogli(id);
      if (discendenti.has(nuovoPid)) return json({ error: "Déplacement invalide (cycle)" }, 400);
      const nuovoDepth = parent.depth + 1;
      // altezza del sotto-albero del nodo (0 se foglia)
      let altezza = 0;
      const misura = (pid: string, d: number) => {
        altezza = Math.max(altezza, d);
        for (const c of cats) if (c.parent_id === pid) misura(c.id, d + 1);
      };
      misura(id, 0);
      if (nuovoDepth + altezza > MAX_DEPTH) return json({ error: `Profondeur max ${MAX_DEPTH} dépassée` }, 400);
      campi.parent_id = nuovoPid;
      campi.depth = nuovoDepth;
      // ricalcola depth dei discendenti
      const delta = nuovoDepth - attuale.depth;
      subtreeUpdates = [...discendenti].map((did) => ({ id: did, depth: (cats.find((c) => c.id === did)!.depth) + delta }));
    } else {
      campi.parent_id = null;
      campi.depth = 0;
      const delta = 0 - attuale.depth;
      const discendenti: string[] = [];
      const raccogli = (pid: string) => { for (const c of cats) if (c.parent_id === pid) { discendenti.push(c.id); raccogli(c.id); } };
      raccogli(id);
      subtreeUpdates = discendenti.map((did) => ({ id: did, depth: cats.find((c) => c.id === did)!.depth + delta }));
    }
  }

  if (Object.keys(campi).length === 0) return json({ error: "Rien à modifier" }, 400);

  const { error: errUpd } = await supabaseAdmin.from("menu_categories").update(campi).eq("id", id);
  if (errUpd) {
    if (errUpd.code === "23505") return json({ error: "Cette section existe déjà" }, 400);
    return json({ error: "Modification impossible" }, 500);
  }
  for (const u of subtreeUpdates) {
    await supabaseAdmin.from("menu_categories").update({ depth: u.depth }).eq("id", u.id);
  }

  // Propaga ai piatti (nome/ordine). Il parent/kind non toccano i piatti.
  const aggiornaPiatti: Record<string, unknown> = {};
  if ("name" in campi) aggiornaPiatti.category = campi.name;
  if ("sort_order" in campi) aggiornaPiatti.category_order = campi.sort_order;
  if (Object.keys(aggiornaPiatti).length > 0) {
    const { error: errItems } = await supabaseAdmin.from("menu_items").update(aggiornaPiatti).eq("category", attuale.name);
    if (errItems) return json({ error: "Plats non synchronisés" }, 500);
  }
  return json({ ok: true });
};

// PATCH /api/admin/categories — riordina/riparenta in blocco (drag & drop).
// body: { nodes: [{ id, parent_id }] } in ordine di visualizzazione (depth-first),
//        oppure legacy { order: [id,...] } (riordino piatto senza gerarchia).
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { nodes?: { id: string; parent_id: string | null }[]; order?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  // Normalizza in una lista di nodi { id, parent_id }
  let nodes: { id: string; parent_id: string | null }[];
  if (Array.isArray(body.nodes)) {
    nodes = body.nodes.map((n) => ({ id: String(n.id), parent_id: n.parent_id ? String(n.parent_id) : null }));
  } else if (Array.isArray(body.order)) {
    nodes = body.order.map((id) => ({ id: String(id), parent_id: null }));
  } else {
    return json({ error: "Ordre requis" }, 400);
  }
  if (nodes.length === 0) return json({ error: "Ordre requis" }, 400);
  if (nodes.some((n) => !/^[0-9a-f-]{36}$/i.test(n.id))) return json({ error: "Id invalide" }, 400);
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length) return json({ error: "Doublons" }, 400);

  const cats = await leggiCategorie();
  if (!cats) return json({ error: "Lecture impossible" }, 500);
  const perId = new Map(cats.map((c) => [c.id, c.name]));
  if (nodes.length !== cats.length || nodes.some((n) => !perId.has(n.id))) {
    return json({ error: "Liste incomplète" }, 400);
  }

  // Calcola depth da parent, valida parent-prima-dei-figli e profondità max
  const posizione = new Map(nodes.map((n, i) => [n.id, i]));
  const depthDi = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.parent_id === null) { depthDi.set(n.id, 0); continue; }
    if (!perId.has(n.parent_id)) return json({ error: "Parent inconnu" }, 400);
    if (n.parent_id === n.id) return json({ error: "Parent invalide" }, 400);
    const pPos = posizione.get(n.parent_id);
    if (pPos === undefined || pPos >= i) return json({ error: "Parent après enfant" }, 400);
    const d = (depthDi.get(n.parent_id) ?? 0) + 1;
    if (d > MAX_DEPTH) return json({ error: `Profondeur max ${MAX_DEPTH} dépassée` }, 400);
    depthDi.set(n.id, d);
  }

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const { error: e1 } = await supabaseAdmin
      .from("menu_categories")
      .update({ sort_order: i + 1, parent_id: n.parent_id, depth: depthDi.get(n.id) ?? 0 })
      .eq("id", n.id);
    if (e1) return json({ error: "Enregistrement impossible" }, 500);
    const { error: e2 } = await supabaseAdmin
      .from("menu_items")
      .update({ category_order: i + 1 })
      .eq("category", perId.get(n.id)!);
    if (e2) return json({ error: "Plats non synchronisés" }, 500);
  }
  return json({ ok: true });
};

// DELETE /api/admin/categories?id=... — solo se vuota (nessun piatto E nessun figlio)
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

  // Ha sotto-categorie?
  const { count: nFigli } = await supabaseAdmin
    .from("menu_categories")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", id);
  if ((nFigli ?? 0) > 0) return json({ error: "Section avec sous-catégories : supprime-les d'abord" }, 400);

  const { count, error: errCount } = await supabaseAdmin
    .from("menu_items")
    .select("id", { count: "exact", head: true })
    .eq("category", cat.name);
  if (errCount) return json({ error: "Vérification impossible" }, 500);
  if ((count ?? 0) > 0) return json({ error: "Section non vide : déplace ou supprime d'abord ses plats" }, 400);

  const { error } = await supabaseAdmin.from("menu_categories").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
