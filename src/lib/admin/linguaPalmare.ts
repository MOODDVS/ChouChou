import { adminLang } from "./adminLang";
import { isAdminLang, type AdminLang } from "../../i18n/admin";
import { linguaDalCookie } from "./linguaPalmareRegole";

/**
 * La lingua delle pagine e delle API del palmare: quella scelta dal cameriere
 * sul suo telefono (cookie, vedi `linguaPalmareRegole.ts`), altrimenti quella
 * dell'admin.
 */
export async function linguaPalmare(request: Request): Promise<AdminLang> {
  const scelta = linguaDalCookie(request.headers.get("cookie"));
  return isAdminLang(scelta) ? scelta : adminLang();
}
