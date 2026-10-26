/**
 * LE MISURE DELLE IMMAGINI DEL SITO — regole pure (27/10/2026).
 *
 * Accanto a ogni immagine scelta in Assets → Site (`site_hero_1` = url) il
 * motore salva base e altezza: `site_hero_1__wh` = "1200x800". Le legge il
 * browser dell'admin al momento della SCELTA (le dimensioni vere, gia'
 * raddrizzate secondo l'EXIF), cosi' il sito pubblico non deve scaricare
 * ogni foto per sapere che forma ha (mosaico delle gallerie, posto
 * riservato contro il salto della pagina).
 *
 * ⚠️ LE MISURE NON SONO IMMAGINI. Anche loro iniziano per `site_`, e
 * `siteImages()` le restituirebbe come indirizzi: una galleria che scorre le
 * chiavi `site_gallery_…` si ritroverebbe «1200x800» in un `src`. Le separa
 * `separaSiteImages`, e `siteImages()` resta com'era: solo indirizzi.
 */

export const SUFFISSO_MISURE = "__wh";

export interface Misure {
  w: number;
  h: number;
}

export function chiaveMisure(key: string): string {
  return `${key}${SUFFISSO_MISURE}`;
}

export function eChiaveMisure(key: string): boolean {
  return key.endsWith(SUFFISSO_MISURE);
}

const LATO_MAX = 20000;

/** «1200x800» → { w: 1200, h: 800 }; tutto il resto → null. */
export function leggiMisure(v: unknown): Misure | null {
  const m = /^(\d{1,5})x(\d{1,5})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 && w <= LATO_MAX && h <= LATO_MAX ? { w, h } : null;
}

/** { w, h } → «1200x800», o null se non sono misure vere. */
export function scriviMisure(w: unknown, h: unknown): string | null {
  const W = Math.round(Number(w));
  const H = Math.round(Number(h));
  return leggiMisure(`${W}x${H}`) ? `${W}x${H}` : null;
}

/**
 * Le righe `site_%` di app_config divise in indirizzi e misure.
 * ⚠️ Una misura vale solo se c'e' la sua immagine: misure orfane (immagine
 * tolta a mano dal database) non escono.
 */
export function separaSiteImages(righe: { key: string; value?: unknown }[]): {
  urls: Record<string, string>;
  misure: Record<string, Misure>;
} {
  const urls: Record<string, string> = {};
  const grezze: Record<string, Misure> = {};
  for (const r of righe) {
    const v = String(r.value ?? "").trim();
    if (!v) continue;
    if (eChiaveMisure(r.key)) {
      const m = leggiMisure(v);
      if (m) grezze[r.key.slice(0, -SUFFISSO_MISURE.length)] = m;
    } else {
      urls[r.key] = v;
    }
  }
  const misure: Record<string, Misure> = {};
  for (const [k, m] of Object.entries(grezze)) if (urls[k]) misure[k] = m;
  return { urls, misure };
}
