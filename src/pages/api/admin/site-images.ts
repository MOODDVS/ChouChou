import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { SITE_IMAGE_KEYS } from "../../../config/siteImageSlots";
import { chiaveMisure, leggiMisure } from "../../../lib/siteImagesRegole";
import { cacheDel } from "../../../lib/cache";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

const SLOT = new Set(SITE_IMAGE_KEYS);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET /api/admin/site-images -> { images: { <key>: url }, misure: { <key>: "1200x800" } }
// per gli slot noti. `misure` serve all'admin per rimisurare chi non le ha.
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const { data, error } = await supabaseAdmin
    .from("app_config")
    .select("key, value")
    .in("key", [...SITE_IMAGE_KEYS, ...SITE_IMAGE_KEYS.map(chiaveMisure)]);
  if (error) return json({ error: await msg("err.read") }, 500);
  const images: Record<string, string> = {};
  const misure: Record<string, string> = {};
  for (const k of SITE_IMAGE_KEYS) images[k] = "";
  const valori = new Map((data ?? []).map((r) => [(r as { key: string }).key, String((r as { value?: unknown }).value ?? "")]));
  for (const k of SITE_IMAGE_KEYS) {
    images[k] = valori.get(k) ?? "";
    const m = leggiMisure(valori.get(chiaveMisure(k)));
    if (images[k] && m) misure[k] = `${m.w}x${m.h}`;
  }
  return json({ images, misure });
};

/** Le misure accanto all'immagine: salvate se valide, altrimenti TOLTE —
 *  una foto nuova non deve portarsi dietro la forma della vecchia. */
async function salvaMisure(key: string, wh: string | null): Promise<boolean> {
  const k = chiaveMisure(key);
  const { error } = wh
    ? await supabaseAdmin.from("app_config").upsert({ key: k, value: wh }, { onConflict: "key" })
    : await supabaseAdmin.from("app_config").delete().eq("key", k);
  return !error;
}

// PUT /api/admin/site-images  { key, url, wh? }  (url vuoto = ripristina il default).
//   `wh` = "1200x800", letto dal browser dell'admin al momento della scelta.
// PUT { key, url, wh, solo_misure: true } → salva SOLO le misure, e solo se
//   l'immagine di quella chiave e' ancora `url` (l'admin rimisura le foto
//   scelte prima delle misure: se nel frattempo qualcuno l'ha cambiata, le
//   misure della vecchia non si attaccano alla nuova).
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  let body: { key?: string; url?: string; wh?: string; solo_misure?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }
  const key = String(body.key ?? "");
  if (!SLOT.has(key)) return json({ error: await msg("err.slotUnknown") }, 400);
  const url = String(body.url ?? "").trim();
  if (url && !(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/"))) {
    return json({ error: await msg("err.url") }, 400);
  }
  const m = url ? leggiMisure(body.wh) : null;
  const wh = m ? `${m.w}x${m.h}` : null;
  if (body.solo_misure) {
    if (!wh) return json({ error: await msg("err.request") }, 400);
    const { data: ora } = await supabaseAdmin.from("app_config").select("value").eq("key", key).maybeSingle();
    if (String((ora as { value?: unknown } | null)?.value ?? "").trim() !== url) return json({ ok: true, saltato: true });
    if (!(await salvaMisure(key, wh))) return json({ error: await msg("err.save") }, 500);
    cacheDel("site:images:v2");
    return json({ ok: true });
  }
  const { error } = await supabaseAdmin
    .from("app_config")
    .upsert({ key, value: url }, { onConflict: "key" });
  if (error) return json({ error: await msg("err.save") }, 500);
  await salvaMisure(key, wh);
  cacheDel("site:images:v2");
  return json({ ok: true });
};
