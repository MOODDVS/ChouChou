import { TEMA_DEFAULT } from "./admin/superAdmin";

/**
 * IL BRAND DI UNA PAGINA PUBBLICA — le regole pure.
 *
 * ⚠️ QUESTO FILE NON ARRIVA A `db.ts`, ed e' la ragione per cui esiste
 * separato da `brandPubblico.ts`. `db.ts` crea il client Supabase ALL'IMPORT e
 * lancia senza le variabili d'ambiente: una prova che importasse l'elenco
 * delle chiavi da li' non partirebbe nemmeno, e vitest la conterebbe come
 * zero. E' la stessa divisione di `ordiniRegole` / `ordiniOpzioni` e di
 * `stampaRegole` / `stampaCoda`.
 *
 * `superAdmin.ts` non importa niente: si puo' portare qui dentro.
 */

/** Le chiavi di `app_config` che vestono una pagina pubblica.
 *  ⚠️ Dichiarate in `tests/config.test.mjs` (ELENCHI_CHIAVI): una chiave letta
 *  e non classificata in `CLASSIFICA_CONFIG` farebbe morire il salvataggio di
 *  Reglages, non solo questa pagina. */
export const CHIAVI_BRAND = [
  "admin_theme",
  "restaurant_name",
  "brand_logo",
  "brand_logo_negative",
  "brand_favicon",
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Un colore del tema, col ripiego RestoHub quando manca o non e' un hex.
 *  ⚠️ Il controllo del formato non e' pedanteria: un valore storto finirebbe
 *  dentro un attributo `style`, e una pagina senza colori e' una pagina che
 *  nessuno riesce a leggere — bianco su bianco. */
export function coloreTema(tema: Record<string, string>, chiave: string): string {
  const v = tema[chiave] ?? "";
  return HEX.test(v) ? v : TEMA_DEFAULT[chiave];
}
