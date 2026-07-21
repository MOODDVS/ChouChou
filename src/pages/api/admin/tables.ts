import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// Plan de salle — tavoli disegnati per ogni section (Réglages → Réservations).
// Coordinate in unità astratte: canvas 1000×600 (lo snap è lato client).
// L'AREA della sala (rettangolo, 4 angoli) vive in app_config
// chiave "reservation_plan_areas": { "<zone>": [[x,y], …] }.
// Le LIAISONS (gruppi di tavoli unibili) in "reservation_plan_links":
// { "<zone>": [["id1","id2"], …] }.
// GET ?zone=  → { tables, area, links }
// POST        → crea { zone, name, seats, shape, x, y, w, h }
// PATCH       → aggiorna { id, ...campi }
// DELETE ?id= → elimina (il client invia POST + X-Method-Override: il
//               middleware lo ritrasforma — il WAF blocca DELETE dai mobili)

const SELECT = "id, zone, name, seats, shape, x, y, w, h";
const FORME = ["round", "square", "rect"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const zone = (url.searchParams.get("zone") ?? "").trim();
  let q = supabaseAdmin.from("restaurant_tables").select(SELECT).order("created_at", { ascending: true });
  if (zone) q = q.eq("zone", zone);
  const { data, error } = await q;
  if (error) return json({ error: "Lecture impossible" }, 500);

  let area: number[][] | null = null;
  let links: unknown = [];
  let planMode = false;
  try {
    const { data: cfg } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", ["reservation_plan_areas", "reservation_plan_links", "reservation_plan_mode"]);
    const m = new Map((cfg ?? []).map((r) => [r.key, r.value ?? ""]));
    planMode = m.get("reservation_plan_mode") === "1";
    const aree = JSON.parse(m.get("reservation_plan_areas") || "{}") as Record<string, unknown>;
    const legami = JSON.parse(m.get("reservation_plan_links") || "{}") as Record<string, unknown>;
    if (zone) {
      if (Array.isArray(aree[zone])) area = aree[zone] as number[][];
      links = Array.isArray(legami[zone]) ? (legami[zone] as unknown[]).filter(Array.isArray) : [];
    } else {
      links = legami; // mappa completa { zone: [[id,…], …] }
    }
  } catch { /* nessuna area/liaison */ }
  return json({ tables: data ?? [], area, links, plan_mode: planMode });
};

/** Aggiorna una mappa { zone: valore } in app_config. */
async function salvaMappa(chiave: string, zone: string, valore: unknown | null): Promise<boolean> {
  let mappa: Record<string, unknown> = {};
  try {
    const { data: cfg } = await supabaseAdmin.from("app_config").select("value").eq("key", chiave).maybeSingle();
    mappa = JSON.parse(cfg?.value || "{}") as Record<string, unknown>;
  } catch { mappa = {}; }
  if (valore !== null) mappa[zone] = valore;
  else delete mappa[zone];
  const { error } = await supabaseAdmin
    .from("app_config")
    .upsert({ key: chiave, value: JSON.stringify(mappa) }, { onConflict: "key" });
  return !error;
}

// PUT — salva/cancella l'AREA (perimetro) di una section: { zone, area | null }
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { zone?: unknown; area?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const zone = String(body.zone ?? "").trim().slice(0, 60);
  if (!zone) return json({ error: "Section obligatoire" }, 400);

  // Liaisons: { zone, links: [["id","id"], …] } (validate e salvate a parte)
  if ("links" in body) {
    const grezzi = Array.isArray((body as { links?: unknown }).links) ? ((body as { links: unknown[] }).links) : [];
    const links: string[][] = [];
    for (const g of grezzi.slice(0, 40)) {
      if (!Array.isArray(g)) continue;
      const ids = g.map((x) => String(x)).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      if (ids.length >= 2 && ids.length <= 8) links.push(ids);
    }
    const ok = await salvaMappa("reservation_plan_links", zone, links.length ? links : null);
    if (!ok) return json({ error: "Enregistrement impossible" }, 500);
    return json({ ok: true, links });
  }

  let area: number[][] | null = null;
  if (Array.isArray(body.area)) {
    if (body.area.length < 3 || body.area.length > 80) return json({ error: "Zone invalide (3–80 points)" }, 400);
    area = (body.area as unknown[]).map((pt) => {
      const p2 = Array.isArray(pt) ? pt : [0, 0];
      return [num(p2[0], 0, 1000, 0), num(p2[1], 0, 600, 0)];
    });
  }

  const ok = await salvaMappa("reservation_plan_areas", zone, area);
  if (!ok) return json({ error: "Enregistrement impossible" }, 500);
  return json({ ok: true, area });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const zone = String(body.zone ?? "").trim().slice(0, 60);
  const name = String(body.name ?? "").trim().slice(0, 12);
  if (!zone || !name) return json({ error: "Section et nom obligatoires" }, 400);
  const shape = FORME.includes(String(body.shape)) ? String(body.shape) : "square";

  const riga = {
    zone,
    name,
    seats: num(body.seats, 1, 30, 4),
    shape,
    x: num(body.x, 0, 1000, 40),
    y: num(body.y, 0, 600, 40),
    w: num(body.w, 20, 400, 100),
    h: num(body.h, 20, 400, 100),
  };
  const { data, error } = await supabaseAdmin.from("restaurant_tables").insert(riga).select(SELECT).single();
  if (error || !data) return json({ error: "Création impossible" }, 500);
  return json({ table: data }, 201);
};

export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const campi: Record<string, unknown> = {};
  if ("name" in body) {
    const nome = String(body.name ?? "").trim().slice(0, 12);
    if (!nome) return json({ error: "Nom obligatoire" }, 400);
    campi.name = nome;
  }
  if ("seats" in body) campi.seats = num(body.seats, 1, 30, 4);
  if ("shape" in body) {
    if (!FORME.includes(String(body.shape))) return json({ error: "Forme invalide" }, 400);
    campi.shape = String(body.shape);
  }
  if ("x" in body) campi.x = num(body.x, 0, 1000, 0);
  if ("y" in body) campi.y = num(body.y, 0, 600, 0);
  if ("w" in body) campi.w = num(body.w, 20, 400, 100);
  if ("h" in body) campi.h = num(body.h, 20, 400, 100);
  if (Object.keys(campi).length === 0) return json({ error: "Rien à modifier" }, 400);

  const { data, error } = await supabaseAdmin
    .from("restaurant_tables")
    .update(campi)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error || !data) return json({ error: "Modification impossible" }, 500);
  return json({ table: data });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const { error } = await supabaseAdmin.from("restaurant_tables").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
