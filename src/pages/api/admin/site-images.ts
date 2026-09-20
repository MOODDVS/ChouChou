import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { SITE_IMAGE_KEYS } from "../../../config/siteImageSlots";

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

// GET /api/admin/site-images -> { images: { <key>: url } } per gli slot noti.
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const { data, error } = await supabaseAdmin
    .from("app_config")
    .select("key, value")
    .in("key", SITE_IMAGE_KEYS);
  if (error) return json({ error: await msg("err.read") }, 500);
  const images: Record<string, string> = {};
  for (const k of SITE_IMAGE_KEYS) images[k] = "";
  for (const r of data ?? []) images[(r as { key: string }).key] = String((r as { value?: unknown }).value ?? "");
  return json({ images });
};

// PUT /api/admin/site-images  { key, url }  (url vuoto = ripristina il default).
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  let body: { key?: string; url?: string };
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
  const { error } = await supabaseAdmin
    .from("app_config")
    .upsert({ key, value: url }, { onConflict: "key" });
  if (error) return json({ error: await msg("err.save") }, 500);
  return json({ ok: true });
};
