import { supabaseAdmin } from "./db";
import { cacheOr } from "./cache";
import { separaSiteImages, type Misure } from "./siteImagesRegole";

export type { Misure };

/**
 * Immagini del sito pubblico gestite dall'admin (tab Assets > Site).
 * Salvate in app_config con chiavi che iniziano per "site_" (una riga
 * per immagine: key -> URL). Se una chiave manca o e' vuota, il componente
 * usa il suo fallback (l'immagine attuale in /public): finche' il cliente
 * non carica nulla, il sito NON cambia. Cache 60s: una modifica in Assets
 * appare sul sito entro un minuto.
 *
 * MISURE (27/10/2026): accanto a ogni immagine l'admin salva base e altezza
 * (`site_hero_1__wh` = "1200x800", `lib/siteImagesRegole`). `siteImages()`
 * NON le restituisce — restano solo indirizzi, come prima —: si leggono con
 * `siteImageMisure()` o, per una chiave, con `siteFoto()`. Una lettura sola
 * del database per tutte e due.
 */
function leggiTutto() {
  return cacheOr("site:images:v2", async () => {
    const { data, error } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .like("key", "site_%");
    if (error) throw error;
    return separaSiteImages((data ?? []) as { key: string; value?: unknown }[]);
  });
}

export async function siteImages(): Promise<Record<string, string>> {
  try {
    return (await leggiTutto()).urls;
  } catch {
    return {};
  }
}

/** Le misure (dopo l'EXIF) delle immagini scelte nell'admin, per chiave.
 *  Una chiave senza misure (immagine scelta prima del 27/10/2026 e non
 *  ancora rimisurata) semplicemente manca. */
export async function siteImageMisure(): Promise<Record<string, Misure>> {
  try {
    return (await leggiTutto()).misure;
  } catch {
    return {};
  }
}

/** L'immagine dell'admin per la chiave con le sue misure, o null se l'admin
 *  non ne ha scelta una. `w`/`h` mancano se non sono ancora note. */
export async function siteFoto(key: string): Promise<{ src: string; w?: number; h?: number } | null> {
  try {
    const { urls, misure } = await leggiTutto();
    const src = urls[key];
    if (!src) return null;
    return { src, ...(misure[key] ?? {}) };
  } catch {
    return null;
  }
}

/** URL dell'immagine per la chiave, o il fallback se non impostata dall'admin. */
export function siteImg(imgs: Record<string, string>, key: string, fallback: string): string {
  return imgs[key] || fallback;
}
