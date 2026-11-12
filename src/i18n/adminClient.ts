/**
 * L'i18n dell'admin NEL BROWSER (audit 12/11/2026).
 *
 * Stessa forma di `admin.ts` — `adminT(lang)(chiave)` — ma senza il
 * dizionario dentro: le stringhe della lingua della pagina le mette in
 * `window.__MDD_I18N` lo script `/api/i18n/admin-<lingua>.<impronta>.js`,
 * caricato nella testa da `AdminHead` (e da login / reset-password) PRIMA
 * degli script della pagina. Il file ha l'impronta nel nome e resta in cache
 * finche' il dizionario non cambia.
 *
 * ⚠️ Gli script delle pagine importano DA QUI, non da `admin.ts`: un solo
 * import di `admin.ts` lato browser rimette nel pacchetto tutte le 5 lingue
 * (c'e' un test che lo controlla). Il server continua a usare `admin.ts`.
 *
 * `lang` resta nella firma per non toccare i chiamanti: la lingua e' quella
 * della pagina, l'unica che il browser ha.
 */
import type { AdminLang } from "./adminLingue";

export * from "./adminLingue";

declare global {
  // eslint-disable-next-line no-var
  var __MDD_I18N: Record<string, string> | undefined;
}

export function adminT(_lang?: AdminLang | string) {
  return function t(key: string): string {
    const d = globalThis.__MDD_I18N;
    return (d && d[key]) || key;
  };
}
