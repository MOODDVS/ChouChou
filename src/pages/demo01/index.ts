import type { APIRoute } from "astro";
import rawHtml from "./_page.html?raw";
import { supabaseAdmin } from "../../lib/db";
import { SITE_IMAGE_SLOTS } from "../../config/siteImageSlots";
import { datiRistorante } from "../../lib/ristorante";
import { linksSocial } from "../../lib/links";

// TEMPLATE demo01 — landing one-page, servita a /demo01. Hero a carousel (3
// immagini da Assets > Site) + sezione Accueil con i dati del ristorante presi
// dal motore. index.ts legge immagini e dati e li inietta al posto dei
// segnaposto __HERO_IMAGES__ / __RESTO_*__ nel _page.html.
export const prerender = false;

const HERO_KEYS = ["site_hero_1", "site_hero_2", "site_hero_3"];
const ACC_KEY = "site_story"; // foto sezione Accueil (Assets > Site > Section Story)
const GALLERY_KEYS = Array.from({ length: 10 }, (_, i) => `site_gallery_${i + 1}`); // galleria Le restaurant
const BANNER_KEY = "site_ambiance_hero"; // banner sfumato sotto la galleria
const MENUS_BG_KEY = "site_menu_hero"; // sfondo sezione Les menus
const fallbackOf = (key: string): string =>
  SITE_IMAGE_SLOTS.find((s) => s.key === key)?.fallback ?? "";

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const GET: APIRoute = async () => {
  // Immagini hero (Assets > Site) con fallback.
  let urls = HERO_KEYS.map(fallbackOf);
  let accImage = fallbackOf(ACC_KEY);
  let gallery = GALLERY_KEYS.map(fallbackOf);
  let banner = fallbackOf(BANNER_KEY);
  let menusBg = fallbackOf(MENUS_BG_KEY);
  let restoName = ""; // insegna pubblica (Reglages > General), NON CLIENT.nome
  try {
    const { data } = await supabaseAdmin.from("app_config").select("key, value").in("key", [...HERO_KEYS, ACC_KEY, ...GALLERY_KEYS, BANNER_KEY, MENUS_BG_KEY, "restaurant_name"]);
    const map = new Map(
      (data ?? []).map((r) => [String((r as { key: string }).key), String((r as { value?: unknown }).value ?? "")])
    );
    urls = HERO_KEYS.map((k) => {
      const v = (map.get(k) ?? "").trim();
      return v || fallbackOf(k);
    });
    const av = (map.get(ACC_KEY) ?? "").trim();
    accImage = av || fallbackOf(ACC_KEY);
    gallery = GALLERY_KEYS.map((k) => {
      const v = (map.get(k) ?? "").trim();
      return v || fallbackOf(k);
    });
    const bv = (map.get(BANNER_KEY) ?? "").trim();
    banner = bv || fallbackOf(BANNER_KEY);
    const mv = (map.get(MENUS_BG_KEY) ?? "").trim();
    menusBg = mv || fallbackOf(MENUS_BG_KEY);
    restoName = (map.get("restaurant_name") ?? "").trim();
  } catch {
    /* fallback */
  }

  // Dati ristorante (Reglages > General).
  let dati = { nome: "", tel: "", telLink: "", email: "", indirizzo: "" };
  try {
    dati = await datiRistorante();
  } catch {
    /* fallback vuoto */
  }

  const _addr = dati.indirizzo || "";
  const _ci = _addr.indexOf(",");
  const _via = (_ci >= 0 ? _addr.slice(0, _ci) : _addr).trim();
  const _city = _ci >= 0 ? _addr.slice(_ci + 1).trim() : "";
  const addrHtml = esc(_via) + (_city ? "<br>" + esc(_city) : "");
  const nome = restoName || dati.nome; // insegna admin, fallback al nome commerciale
  let socialHtml = "";
  try {
    const social = await linksSocial();
    socialHtml = social.map((sc) => `<a href="${esc(sc.url)}" target="_blank" rel="noopener" aria-label="${esc(sc.label)}">${sc.icon}</a>`).join("");
  } catch { /* nessun social */ }
  const year = String(new Date().getFullYear());

  const html = rawHtml
    .replace("__HERO_IMAGES__", JSON.stringify(urls))
    .replace(/__ACC_IMAGE__/g, esc(accImage))
    .replace("__GALLERY_IMAGES__", JSON.stringify(gallery))
    .replace(/__REST_BANNER__/g, esc(banner))
    .replace(/__MENUS_BG__/g, esc(menusBg))
    .replace(/__MAPS_EMBED__/g, esc(dati.indirizzo ? `https://www.google.com/maps?q=${encodeURIComponent(dati.indirizzo)}&output=embed` : ""))
    .replace(/__RESTO_NAME__/g, esc(nome))
    .replace(/__RESTO_PHONE__/g, esc(dati.tel))
    .replace(/__RESTO_TEL__/g, esc(dati.telLink))
    .replace(/__RESTO_EMAIL__/g, esc(dati.email))
    .replace(/__RESTO_ADDRESS__/g, esc(dati.indirizzo))
    .replace(/__RESTO_ADDR_HTML__/g, addrHtml)
    .replace(/__SOCIAL_LINKS__/g, socialHtml)
    .replace(/__YEAR__/g, year);

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
};
