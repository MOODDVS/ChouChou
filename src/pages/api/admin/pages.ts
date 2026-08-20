import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser, ruoloDi, PAGINE_SOLO_ADMIN, PAGINE_ADMIN, TABS_VALIDI, TEMA_CHIAVI, PUBLIC_LANG_CODES, PUBLIC_LANGS_DEFAULT, PUBLIC_LANG_DEFAULT, normalizzaLinguePubbliche } from "../../../lib/admin/superAdmin";
import { ADMIN_LANG_DEFAULT, isAdminLang, type AdminLang } from "../../../i18n/admin";
import { CHIAVE_ADMIN_LANG, CACHE_ADMIN_BOOT } from "../../../lib/admin/adminBoot";
import { cacheDel } from "../../../lib/cache";

export const prerender = false;

// Visibilità di pagine E tab dell'admin per gli utenti NON super (MOODD).
// - admin_pages_hidden : array JSON di chiavi pagina (es. ["stats","marketing"])
// - admin_tabs_hidden  : array JSON di "pagina:tab" (es. ["marketing:news"])
// GET → { hidden, hiddenTabs, super } : letto da AdminNav e dalle pagine con tab
// PUT → { hidden, hiddenTabs } : SOLO il super admin può modificarla

const CHIAVE = "admin_pages_hidden";
const CHIAVE_TABS = "admin_tabs_hidden";
// TEMA brand del cliente (Reglages -> Couleurs): oggetto {accent,hover,bg,...}
// con hex #rrggbb. Oggetto vuoto/assente = colori MOODD di default.
const CHIAVE_TEMA = "admin_theme";
// Lingue pubbliche (lato cliente): set attivo + lingua predefinita.
const CHIAVE_PUBLIC_LANGS = "public_languages";
const CHIAVE_PUBLIC_DEFAULT = "public_lang_default";
const RE_HEX = /^#[0-9a-fA-F]{6}$/;

/** Favicon del brand (Admin -> General): URL pubblico nel bucket brand.
 *  Se caricato, l'header dell'admin lo usa al posto del logo di default. */
async function leggiLogo(): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "brand_favicon")
      .maybeSingle();
    const v = String(data?.value ?? "").trim();
    return v.startsWith("https://") || v.startsWith("/") ? v : null;
  } catch {
    return null;
  }
}

/** Tema letto da app_config: SOLO chiavi conosciute e hex validi. */
async function leggiTema(): Promise<Record<string, string>> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", CHIAVE_TEMA)
      .maybeSingle();
    const obj = JSON.parse(data?.value ?? "{}");
    const out: Record<string, string> = {};
    for (const k of TEMA_CHIAVI) {
      const v = obj?.[k];
      if (typeof v === "string" && RE_HEX.test(v)) out[k] = v.toLowerCase();
    }
    // Effet verre: "on" = trasparenze+blur (assente = opaco, il default)
    if (obj?.glass === "on") out.glass = "on";
    // Intensita' delle ombre: "0".."100" (assente = default 15)
    if (typeof obj?.shadow === "string" && /^\d{1,3}$/.test(obj.shadow) && Number(obj.shadow) <= 100) {
      out.shadow = obj.shadow;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Lingue pubbliche: set attivo (>=1) + predefinita (sempre nel set attivo).
 * Solo codici noti (PUBLIC_LANG_CODES). Se app_config è vuoto/incoerente si
 * torna ai default storici (attive FR+EN, predefinita FR).
 */
async function leggiLinguePubbliche(): Promise<{ langs: string[]; def: string }> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", [CHIAVE_PUBLIC_LANGS, CHIAVE_PUBLIC_DEFAULT]);
    const m = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "")] as [string, string]));
    return normalizzaLinguePubbliche(m.get(CHIAVE_PUBLIC_LANGS) ?? "", m.get(CHIAVE_PUBLIC_DEFAULT) ?? "");
  } catch {
    return { langs: [...PUBLIC_LANGS_DEFAULT], def: PUBLIC_LANG_DEFAULT };
  }
}

/** Lingua globale dell'admin (app_config "admin_lang"), default francese. */
async function leggiLang(): Promise<AdminLang> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", CHIAVE_ADMIN_LANG)
      .maybeSingle();
    const v = String(data?.value ?? "").trim();
    return isAdminLang(v) ? v : ADMIN_LANG_DEFAULT;
  } catch {
    return ADMIN_LANG_DEFAULT;
  }
}

const VALIDE = PAGINE_ADMIN.map((p) => p.key);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function leggiLista(chiave: string, validi: string[]): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", chiave)
      .maybeSingle();
    const arr = JSON.parse(data?.value ?? "[]");
    return Array.isArray(arr) ? arr.filter((k) => validi.includes(k)) : [];
  } catch {
    return [];
  }
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const [hidden, hiddenTabs, theme, logo, lang, publicLang] = await Promise.all([
    leggiLista(CHIAVE, VALIDE),
    leggiLista(CHIAVE_TABS, TABS_VALIDI),
    leggiTema(),
    leggiLogo(),
    leggiLang(),
    leggiLinguePubbliche(),
  ]);
  // Ruolo "user": in più delle pagine spente in Réglages, mai Admin né Statistiques.
  const ruolo = ruoloDi(staff);
  const hiddenRuolo =
    ruolo === "user" ? [...new Set([...hidden, ...PAGINE_SOLO_ADMIN])] : hidden;
  return json({ hidden: hiddenRuolo, hiddenTabs, theme, logo, lang, publicLangs: publicLang.langs, publicLangDefault: publicLang.def, role: ruolo, super: isSuperUser(staff) });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuperUser(staff)) {
    return json({ error: "Réservé à l'administrateur MOODD" }, 403);
  }

  let body: { hidden?: string[]; hiddenTabs?: string[]; theme?: Record<string, string>; lang?: string; publicLangs?: string[]; publicLangDefault?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  // hidden è opzionale: aggiornato solo se presente (come theme, hiddenTabs, lang).
  // Così un salvataggio della sola lingua non tocca la visibilità delle pagine.
  let hidden: string[] | null = null;
  if (body.hidden !== undefined) {
    if (!Array.isArray(body.hidden)) return json({ error: "Liste invalide" }, 400);
    hidden = [...new Set(body.hidden.filter((k) => VALIDE.includes(k)))];
  }

  // hiddenTabs è opzionale: se assente, non lo tocca.
  const hiddenTabs = Array.isArray(body.hiddenTabs)
    ? [...new Set(body.hiddenTabs.filter((k) => TABS_VALIDI.includes(k)))]
    : null;

  // theme e' opzionale: se assente non lo tocca; {} = reset ai default MOODD.
  let theme: Record<string, string> | null = null;
  if (body.theme !== undefined) {
    if (typeof body.theme !== "object" || body.theme === null || Array.isArray(body.theme)) {
      return json({ error: "Thème invalide" }, 400);
    }
    theme = {};
    for (const k of TEMA_CHIAVI) {
      const v = (body.theme as Record<string, unknown>)[k];
      if (typeof v === "string" && RE_HEX.test(v)) theme[k] = v.toLowerCase();
    }
    if ((body.theme as Record<string, unknown>).glass === "on") theme.glass = "on";
    const sh = (body.theme as Record<string, unknown>).shadow;
    if (typeof sh === "string" && /^\d{1,3}$/.test(sh) && Number(sh) <= 100) theme.shadow = sh;
  }

  // lang opzionale: se presente e valida, aggiorna la lingua globale dell'admin.
  let lang: AdminLang | null = null;
  if (body.lang !== undefined) {
    if (!isAdminLang(body.lang)) return json({ error: "Langue invalide" }, 400);
    lang = body.lang;
  }

  // Lingue pubbliche opzionali. Si aggiornano SOLO se arriva publicLangs.
  // Regole: almeno una attiva, solo codici noti, la predefinita è nel set.
  let publicLangs: string[] | null = null;
  let publicDefault: string | null = null;
  if (body.publicLangs !== undefined) {
    if (!Array.isArray(body.publicLangs)) return json({ error: "Langues publiques invalides" }, 400);
    const set = new Set(body.publicLangs.filter((c) => PUBLIC_LANG_CODES.includes(c)));
    publicLangs = PUBLIC_LANG_CODES.filter((c) => set.has(c)); // ordine canonico
    if (!publicLangs.length) return json({ error: "Au moins une langue publique" }, 400);
    // predefinita: quella passata se valida e attiva, altrimenti FR se attivo, altrimenti la prima
    const richiesta = typeof body.publicLangDefault === "string" ? body.publicLangDefault : "";
    publicDefault = publicLangs.includes(richiesta)
      ? richiesta
      : (publicLangs.includes(PUBLIC_LANG_DEFAULT) ? PUBLIC_LANG_DEFAULT : publicLangs[0]);
  }

  const upserts: { key: string; value: string }[] = [];
  if (hidden !== null) upserts.push({ key: CHIAVE, value: JSON.stringify(hidden) });
  if (hiddenTabs !== null) upserts.push({ key: CHIAVE_TABS, value: JSON.stringify(hiddenTabs) });
  if (theme !== null) upserts.push({ key: CHIAVE_TEMA, value: JSON.stringify(theme) });
  if (lang !== null) upserts.push({ key: CHIAVE_ADMIN_LANG, value: lang });
  if (publicLangs !== null) upserts.push({ key: CHIAVE_PUBLIC_LANGS, value: JSON.stringify(publicLangs) });
  if (publicDefault !== null) upserts.push({ key: CHIAVE_PUBLIC_DEFAULT, value: publicDefault });

  if (upserts.length > 0) {
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert(upserts, { onConflict: "key" });
    if (error) return json({ error: "Enregistrement impossible" }, 500);
  }

  // Invalida subito la cache di boot (lingua + tema + favicon + lingue pubbliche,
  // lette in SSR da AdminHead/AdminHeader e dal modale ordine): il reload mostra
  // già i valori nuovi senza aspettare la scadenza dei 60s.
  if (lang !== null || theme !== null || publicLangs !== null) cacheDel(CACHE_ADMIN_BOOT);

  return json({ ok: true, hidden: hidden ?? undefined, hiddenTabs: hiddenTabs ?? undefined, theme: theme ?? undefined, lang: lang ?? undefined, publicLangs: publicLangs ?? undefined, publicLangDefault: publicDefault ?? undefined });
};
