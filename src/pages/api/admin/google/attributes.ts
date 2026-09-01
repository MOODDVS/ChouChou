import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { accessToken, locationSalvata, leggiAttributi, aggiornaAttributi } from "../../../../lib/googleBusiness";
import type { AttrType } from "../../../../lib/googleBusiness";

export const prerender = false;

// GET  /api/admin/google/attributes?lang=fr  -> gruppi di attributi + valori correnti
// PUT  /api/admin/google/attributes           -> salva gli attributi modificati

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function preludio(request: Request) {
  const staff = await verificaStaff(request);
  if (!staff) return { err: nonAutorizzato() };
  const token = await accessToken();
  if (!token) return { err: json({ error: "Google non collegato" }, 400) };
  const loc = await locationSalvata();
  if (!loc?.path) return { err: json({ error: "Scheda Google non configurata" }, 400) };
  return { token, path: loc.path };
}

export const GET: APIRoute = async ({ request, url }) => {
  const p = await preludio(request);
  if (p.err) return p.err;
  const lang = (url.searchParams.get("lang") || "fr").slice(0, 5);
  const { gruppi, error } = await leggiAttributi(p.token!, p.path!, lang);
  if (!gruppi) return json({ error: error || "Lecture des attributs impossible" }, 502);
  return json({ gruppi });
};

const TIPI: AttrType[] = ["BOOL", "ENUM", "URL", "REPEATED_ENUM"];

export const PUT: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;

  let b: { items?: unknown };
  try { b = await request.json(); } catch { return json({ error: "Corps invalide" }, 400); }
  if (!Array.isArray(b.items)) return json({ error: "Rien à mettre à jour" }, 400);

  const items: { id: string; type: AttrType; bool?: boolean | null; enumVal?: string | null; set?: string[]; unset?: string[]; urls?: string[] }[] = [];
  for (const raw of b.items as Record<string, unknown>[]) {
    const id = String(raw?.id ?? "");
    const type = String(raw?.type ?? "") as AttrType;
    if (!id.startsWith("attributes/") || !TIPI.includes(type)) continue;
    const it: { id: string; type: AttrType; bool?: boolean | null; enumVal?: string | null; set?: string[]; unset?: string[]; urls?: string[] } = { id, type };
    if (type === "BOOL") it.bool = raw.bool === true ? true : raw.bool === false ? false : null;
    else if (type === "ENUM") it.enumVal = raw.enumVal != null && raw.enumVal !== "" ? String(raw.enumVal) : null;
    else if (type === "REPEATED_ENUM") {
      it.set = Array.isArray(raw.set) ? (raw.set as unknown[]).map(String) : [];
      it.unset = Array.isArray(raw.unset) ? (raw.unset as unknown[]).map(String) : [];
    }
    else if (type === "URL") it.urls = Array.isArray(raw.urls) ? (raw.urls as unknown[]).map(String).filter(Boolean) : [];
    items.push(it);
  }
  if (!items.length) return json({ error: "Rien à mettre à jour" }, 400);

  const { ok, error, notApplied, resp } = await aggiornaAttributi(p.token!, p.path!, items);
  if (!ok) return json({ error: error || "Mise à jour impossible" }, 502);
  return json({ ok: true, notApplied: notApplied ?? [], resp });
};
