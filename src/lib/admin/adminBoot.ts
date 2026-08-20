import { supabaseAdmin } from "../db";
import { cacheOr } from "../cache";
import { TEMA_CHIAVI, normalizzaLinguePubbliche } from "./superAdmin";
import { ADMIN_LANG_DEFAULT, isAdminLang, type AdminLang } from "../../i18n/admin";

/**
 * BOOT dell'admin: tutto quello che serve PRIMA del primo paint (lingua,
 * tema del cliente, favicon del brand) letto in UNA sola query su app_config
 * e tenuto in cache 60s.
 *
 * PERCHE' ESISTE: prima il tema arrivava solo lato client (AdminNav ->
 * getSession -> fetch /api/admin/pages), con una cache localStorage applicata
 * da uno script piazzato centinaia di righe dentro il <body>. Il browser
 * dipingeva molto prima di arrivarci: si vedevano i colori MOODD di default
 * e poi, di colpo, quelli veri. Leggendoli qui e stampandoli nel <head>
 * (componente AdminHead) il flash sparisce del tutto, anche al primo accesso
 * su un browser nuovo o in navigazione privata, dove la cache non c'e'.
 *
 * La cache e' condivisa con adminLang(): le pagine che gia' chiamavano
 * adminLang() non pagano NESSUNA query in piu'.
 */

/** Chiave app_config della lingua admin (globale, scelta dal super). */
export const CHIAVE_ADMIN_LANG = "admin_lang";
/** Chiave app_config del tema per-cliente (Réglages → Design). */
export const CHIAVE_ADMIN_TEMA = "admin_theme";
/** Chiave app_config della favicon del brand (Admin → Général). */
export const CHIAVE_BRAND_FAVICON = "brand_favicon";
/** Chiavi app_config delle lingue pubbliche (lato cliente). */
export const CHIAVE_PUBLIC_LANGS = "public_languages";
export const CHIAVE_PUBLIC_DEFAULT = "public_lang_default";
/** Voce di cache condivisa: invalidarla dopo un salvataggio di lingua/tema/logo. */
export const CACHE_ADMIN_BOOT = "admin:boot";

const RE_HEX = /^#[0-9a-fA-F]{6}$/;

export interface AdminBoot {
  lang: AdminLang;
  /** Solo chiavi conosciute e hex validi (+ eventuali glass/shadow). */
  theme: Record<string, string>;
  /** URL della favicon del brand, o null = logo di default del client. */
  logo: string | null;
  /** Lingue pubbliche attive (codici, ordine canonico) e predefinita. */
  publicLangs: string[];
  publicLangDefault: string;
}

const VUOTO: AdminBoot = { lang: ADMIN_LANG_DEFAULT, theme: {}, logo: null, publicLangs: ["fr", "en"], publicLangDefault: "fr" };

/** Stesse regole di validazione dell'endpoint /api/admin/pages. */
function pulisciTema(grezzo: string): Record<string, string> {
  try {
    const obj = JSON.parse(grezzo || "{}");
    const out: Record<string, string> = {};
    for (const k of TEMA_CHIAVI) {
      const v = obj?.[k];
      if (typeof v === "string" && RE_HEX.test(v)) out[k] = v.toLowerCase();
    }
    if (obj?.glass === "on") out.glass = "on";
    if (typeof obj?.shadow === "string" && /^\d{1,3}$/.test(obj.shadow) && Number(obj.shadow) <= 100) {
      out.shadow = obj.shadow;
    }
    return out;
  } catch {
    return {};
  }
}

export async function caricaBootAdmin(): Promise<AdminBoot> {
  try {
    return await cacheOr(CACHE_ADMIN_BOOT, async () => {
      const { data, error } = await supabaseAdmin
        .from("app_config")
        .select("key, value")
        .in("key", [CHIAVE_ADMIN_LANG, CHIAVE_ADMIN_TEMA, CHIAVE_BRAND_FAVICON, CHIAVE_PUBLIC_LANGS, CHIAVE_PUBLIC_DEFAULT]);
      if (error) throw error;
      const m = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "")] as [string, string]));

      const l = (m.get(CHIAVE_ADMIN_LANG) ?? "").trim();
      const logo = (m.get(CHIAVE_BRAND_FAVICON) ?? "").trim();
      const pub = normalizzaLinguePubbliche(m.get(CHIAVE_PUBLIC_LANGS) ?? "", m.get(CHIAVE_PUBLIC_DEFAULT) ?? "");

      return {
        lang: isAdminLang(l) ? l : ADMIN_LANG_DEFAULT,
        theme: pulisciTema(m.get(CHIAVE_ADMIN_TEMA) ?? ""),
        logo: logo.startsWith("https://") || logo.startsWith("/") ? logo : null,
        publicLangs: pub.langs,
        publicLangDefault: pub.def,
      } satisfies AdminBoot;
    });
  } catch {
    // app_config illeggibile: si parte coi default MOODD, mai un errore in faccia
    return VUOTO;
  }
}

/**
 * Regola CSS da stampare nel <head>. Mira `html` (stessa specificita' di
 * `:root`, ma piu' in basso nel documento => vince) e dichiara SOLO le
 * variabili davvero salvate: le altre restano quelle di default della pagina.
 * Ritorna "" se non c'e' niente da scrivere.
 */
export function cssTema(theme: Record<string, string>): string {
  const decl: string[] = [];
  for (const k of TEMA_CHIAVI) {
    const v = theme[k];
    if (typeof v === "string" && RE_HEX.test(v)) decl.push(`--c-${k}:${v}`);
  }
  if (/^\d{1,3}$/.test(String(theme.shadow))) {
    decl.push(`--sh:${Math.min(100, Number(theme.shadow)) / 100}`);
  }
  return decl.length ? `html{${decl.join(";")}}` : "";
}
