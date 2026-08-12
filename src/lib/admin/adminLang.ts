import { supabaseAdmin } from "../db";
import { cacheOr } from "../cache";
import { ADMIN_LANG_DEFAULT, isAdminLang, type AdminLang } from "../../i18n/admin";

/** Chiave app_config e chiave cache della lingua admin (condivise con l'API). */
export const CHIAVE_ADMIN_LANG = "admin_lang";
export const CACHE_ADMIN_LANG = "admin:lang";

/**
 * Lingua GLOBALE dell'admin, scelta dal super admin (app_config "admin_lang").
 * Default = francese. Cache 60s (invalidata subito al salvataggio via cacheDel,
 * così il reload dopo il cambio mostra già la nuova lingua).
 */
export async function adminLang(): Promise<AdminLang> {
  try {
    return await cacheOr(CACHE_ADMIN_LANG, async () => {
      const { data, error } = await supabaseAdmin
        .from("app_config")
        .select("value")
        .eq("key", CHIAVE_ADMIN_LANG)
        .maybeSingle();
      if (error) throw error;
      const v = String(data?.value ?? "").trim();
      return isAdminLang(v) ? v : ADMIN_LANG_DEFAULT;
    });
  } catch {
    return ADMIN_LANG_DEFAULT;
  }
}
