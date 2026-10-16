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
  /* Le immagini del sito (le stesse dello sfondo del login): la foto del
     locale sulla pagina del QR, quando la sede non ne ha una sua. */
  "site_hero_1",
  "site_hero_2",
  "site_hero_3",
];

/** Un indirizzo d'immagine che si puo' mettere in un `src`: assoluto in
 *  http(s) o relativo al sito. ⚠️ Tutto il resto (`javascript:`, testo
 *  libero, spazi) e' un campo scritto male, e diventa «nessuna immagine» —
 *  meglio un posto vuoto che un'icona rotta in cima alla pagina. */
function urlImmagine(v: unknown): string {
  const u = String(v ?? "").trim();
  return /^(https?:\/\/|\/)[^\s"'<>]+$/.test(u) ? u : "";
}

/**
 * LA FOTO DEL LOCALE, per la pagina del QR.
 *
 * ⚠️ PRIMA QUELLA DELLA SEDE, poi quelle del sito. In un gruppo ogni sede
 * ha il suo locale: chi e' seduto a Stockel e vede la sala di Jourdan pensa
 * di aver inquadrato il QR sbagliato. Le immagini del sito valgono per tutti
 * e arrivano solo se la sede non ne ha una sua.
 *
 * Vuoto = nessuna immagine: la pagina non lascia un riquadro vuoto.
 */
export function immagineDelLocale(fotoSede: unknown, hero: unknown[]): string {
  return urlImmagine(fotoSede) || hero.map(urlImmagine).find(Boolean) || "";
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Un colore del tema, col ripiego RestoHub quando manca o non e' un hex.
 *  ⚠️ Il controllo del formato non e' pedanteria: un valore storto finirebbe
 *  dentro un attributo `style`, e una pagina senza colori e' una pagina che
 *  nessuno riesce a leggere — bianco su bianco. */
export function coloreTema(tema: Record<string, string>, chiave: string): string {
  const v = tema[chiave] ?? "";
  return HEX.test(v) ? v : TEMA_DEFAULT[chiave];
}
