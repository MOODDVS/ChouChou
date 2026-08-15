import { caricaBootAdmin, CACHE_ADMIN_BOOT, CHIAVE_ADMIN_LANG } from "./adminBoot";
import type { AdminLang } from "../../i18n/admin";

/** Chiave app_config della lingua admin (ri-esportata: la fonte e' adminBoot). */
export { CHIAVE_ADMIN_LANG };
/** Voce di cache: e' la STESSA di adminBoot, cosi' un cacheDel invalida tutto. */
export const CACHE_ADMIN_LANG = CACHE_ADMIN_BOOT;

/**
 * Lingua GLOBALE dell'admin (app_config "admin_lang"), default francese.
 * Ora e' una vista su caricaBootAdmin(): lingua, tema e favicon arrivano da
 * UNA sola query in cache 60s, invece di una query per ciascuno.
 */
export async function adminLang(): Promise<AdminLang> {
  return (await caricaBootAdmin()).lang;
}
