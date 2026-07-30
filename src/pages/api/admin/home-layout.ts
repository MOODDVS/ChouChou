import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// Layout PERSONALE della home per ogni utente admin: ordine, larghezza (1-4
// colonne) e altezza minima delle isole. Salvato in app_config con chiave
// "home_layout:<userId>" (nessuna migrazione). Vale solo per quell'utente.
// GET → { layout } (null = layout di default)
// PUT → { layout } salva

const TILE_KEYS = ["notes", "orders", "reservations", "settings", "special", "cuisine", "menu", "google", "visibilite", "stats", "assets"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const chiaveUtente = (id: string) => "home_layout:" + id;

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", chiaveUtente(staff.id))
      .maybeSingle();
    const layout = data?.value ? JSON.parse(data.value) : null;
    return json({ layout: Array.isArray(layout) ? layout : null });
  } catch {
    return json({ layout: null });
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { layout?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  if (!Array.isArray(body.layout)) return json({ error: "Layout invalide" }, 400);

  const puliti: { key: string; w: number; minH?: number; hidden?: boolean }[] = [];
  const visti = new Set<string>();
  for (const it of body.layout as { key?: unknown; w?: unknown; minH?: unknown; hidden?: unknown }[]) {
    const key = String(it?.key ?? "");
    if (!TILE_KEYS.includes(key) || visti.has(key)) continue;
    visti.add(key);
    const w = Math.min(4, Math.max(1, Math.floor(Number(it?.w)) || 1));
    const mh = Math.floor(Number(it?.minH));
    const minH = Number.isFinite(mh) && mh > 0 ? Math.min(900, Math.max(120, mh)) : 0;
    const voce: { key: string; w: number; minH?: number; hidden?: boolean } = minH ? { key, w, minH } : { key, w };
    if (it?.hidden === true) voce.hidden = true;
    puliti.push(voce);
  }

  const { error } = await supabaseAdmin
    .from("app_config")
    .upsert({ key: chiaveUtente(staff.id), value: JSON.stringify(puliti) }, { onConflict: "key" });
  if (error) return json({ error: "Enregistrement impossible" }, 500);

  return json({ ok: true, layout: puliti });
};
