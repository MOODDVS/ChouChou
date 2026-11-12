/**
 * IL DIZIONARIO DELL'ADMIN PER IL BROWSER — un file per lingua, con
 * l'impronta nel nome (audit 12/11/2026). Vedi `i18n/adminClient.ts`.
 *
 * Il corpo si calcola una volta per processo e lingua: il dizionario e'
 * nel codice, cambia solo con un deploy (che riavvia il processo).
 */
import { createHash } from "node:crypto";
import { dizionarioDi, isAdminLang, ADMIN_LANG_DEFAULT, type AdminLang } from "../../i18n/admin";

const pronti = new Map<AdminLang, { impronta: string; corpo: string }>();

export function fileDizionario(lang: AdminLang): { impronta: string; corpo: string } {
  const gia = pronti.get(lang);
  if (gia) return gia;
  // `<` scritto <: il testo non puo' chiudere niente, ovunque finisca.
  const json = JSON.stringify(dizionarioDi(lang)).replace(/</g, "\\u003c");
  const corpo = `self.__MDD_I18N=${json};\n`;
  const impronta = createHash("sha256").update(corpo).digest("hex").slice(0, 12);
  const f = { impronta, corpo };
  pronti.set(lang, f);
  return f;
}

/** L'indirizzo dello script per la lingua della pagina. */
export function urlDizionario(lang: string): string {
  const l: AdminLang = isAdminLang(lang) ? lang : ADMIN_LANG_DEFAULT;
  return `/api/i18n/admin-${l}.${fileDizionario(l).impronta}.js`;
}
