import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../lib/db";

export const prerender = false;

// Beacon public (sans auth) : enregistre la PROVENANCE d'une arrivée sur le
// site. Appelé par navigator.sendBeacon depuis le layout public. Aucune
// donnée personnelle : ni IP, ni cookie, ni identifiant.

function classer(refHost: string, utm: string): string {
  const u = utm.toLowerCase().trim();
  if (u) {
    if (/insta/.test(u)) return "instagram";
    if (/face|fb|meta/.test(u)) return "facebook";
    if (/google|gmb|search|maps/.test(u)) return "google";
    if (/tiktok/.test(u)) return "tiktok";
    if (/mail|news|email/.test(u)) return "newsletter";
    if (/whatsapp|wa\b/.test(u)) return "whatsapp";
    return u.slice(0, 40).replace(/[^a-z0-9_-]/g, "");
  }
  const h = refHost.toLowerCase();
  if (!h) return "direct";
  if (h.includes("google")) return "google";
  if (/facebook|fb\.me|fb\.com|fb\.watch/.test(h)) return "facebook";
  if (/instagram|ig\./.test(h)) return "instagram";
  if (/tiktok/.test(h)) return "tiktok";
  if (/t\.co|twitter|x\.com/.test(h)) return "x";
  if (/bing/.test(h)) return "bing";
  if (/yahoo/.test(h)) return "yahoo";
  if (/duckduckgo/.test(h)) return "duckduckgo";
  if (/linkedin|lnkd\.in/.test(h)) return "linkedin";
  if (/youtube|youtu\.be/.test(h)) return "youtube";
  if (/whatsapp|wa\.me/.test(h)) return "whatsapp";
  return "autre";
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // sendBeacon envoie du text/plain : on lit le texte puis on parse.
    const raw = await request.text();
    const body = JSON.parse(raw) as { p?: string; r?: string; u?: string };

    // Ignore les bots les plus courants (ils gonfleraient les chiffres).
    const ua = request.headers.get("user-agent") ?? "";
    if (/bot|crawl|spider|slurp|preview|facebookexternalhit|headless|monitor/i.test(ua)) {
      return new Response(null, { status: 204 });
    }

    const path = String(body.p ?? "").slice(0, 300);
    let refHost = "";
    try {
      if (body.r) refHost = new URL(String(body.r)).host;
    } catch {
      /* référent illisible */
    }
    const source = classer(refHost, String(body.u ?? ""));

    await supabaseAdmin.from("page_views").insert({ path, source, ref_host: refHost.slice(0, 120) });
    return new Response(null, { status: 204 });
  } catch {
    // Ne jamais casser la navigation pour une histoire de stats.
    return new Response(null, { status: 204 });
  }
};
