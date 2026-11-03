import { adminLang } from "./adminLang";
import { adminT } from "../../i18n/admin";

/**
 * IL MESSAGGIO D'ERRORE DI UN'API, NELLA LINGUA DELL'ADMIN — uno solo
 * (audit 3/11/2026: era copiato in cinquantasette file).
 *
 * `adminLang()` legge un valore globale gia' in cache (adminBoot): zero
 * query in piu'. Vedi ENGINE.md, «Messaggi d'errore delle API admin — nella
 * lingua dell'admin».
 */
export async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}
