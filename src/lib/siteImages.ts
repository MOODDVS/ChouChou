import { supabaseAdmin } from "./db";
import { cacheOr } from "./cache";

/**
 * Immagini del sito pubblico gestite dall'admin (tab Assets > Site).
 * Salvate in app_config con chiavi che iniziano per "site_" (una riga
 * per immagine: key -> URL). Se una chiave manca o e' vuota, il componente
 * usa il suo fallback (l'immagine attuale in /public): finche' il cliente
 * non carica nulla, il sito NON cambia. Cache 60s: una modifica in Assets
 * appare sul sito entro un minuto.
 */
export async function siteImages(): Promise<Record<string, string>> {
  try {
    return await cacheOr("site:images", async () => {
      const { data, error } = await supabaseAdmin
        .from("app_config")
        .select("key, value")
        .like("key", "site_%");
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const r of data ?? []) {
        const v = String((r as { value?: unknown }).value ?? "").trim();
        if (v) out[(r as { key: string }).key] = v;
      }
      return out;
    });
  } catch {
    return {};
  }
}

/** URL dell'immagine per la chiave, o il fallback se non impostata dall'admin. */
export function siteImg(imgs: Record<string, string>, key: string, fallback: string): string {
  return imgs[key] || fallback;
}
