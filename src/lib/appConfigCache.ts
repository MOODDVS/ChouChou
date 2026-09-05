import { supabaseAdmin } from "./db";
import { cacheOr, cacheDel } from "./cache";

/**
 * app_config in CACHE (30s). La tabella è piccola (poche decine di righe
 * chiave/valore) ma viene riletta da quasi ogni richiesta: il widget pubblico
 * delle prenotazioni, le API admin, il piano sala… ogni lettura = un
 * round-trip HTTP verso Supabase. Qui la si legge UNA volta ogni 30s e si
 * serve dalla memoria.
 *
 * Uso: `appConfigIn(chiavi)` / `appConfigEq(chiave)` sono DROP-IN delle query
 *   supabaseAdmin.from("app_config").select("key, value").in("key", chiavi)
 *   supabaseAdmin.from("app_config").select("value").eq("key", chiave).maybeSingle()
 * (stessa forma { data, error }), così i chiamanti non cambiano.
 *
 * Coerenza: chi SCRIVE app_config (Réglages, tavoli, chiusure…) chiama
 * `invalidaAppConfig()` dopo il salvataggio → la modifica è visibile subito.
 * Le chiavi i cui scrittori non invalidano NON vanno lette da qui (restano
 * sulle query dirette): oggi la cache è consumata solo dai percorsi delle
 * prenotazioni, i cui scrittori invalidano tutti.
 *
 * Se la cache fallisce si ripiega sulla query diretta: comportamento
 * identico a prima, mai peggiore.
 */
export const CACHE_APP_CONFIG = "cfg:all";
const TTL_MS = 30_000;

type Riga = { key: string; value: string };

async function tutte(): Promise<Riga[]> {
  return cacheOr(
    CACHE_APP_CONFIG,
    async () => {
      const { data, error } = await supabaseAdmin.from("app_config").select("key, value");
      if (error) throw error;
      return (data ?? []).map((r) => ({ key: String(r.key), value: String(r.value ?? "") }));
    },
    TTL_MS,
  );
}

/** Drop-in di `.select("key, value").in("key", chiavi)`. */
export async function appConfigIn(chiavi: string[]): Promise<{ data: Riga[]; error: null }> {
  try {
    const set = new Set(chiavi);
    return { data: (await tutte()).filter((r) => set.has(r.key)), error: null };
  } catch {
    const { data } = await supabaseAdmin.from("app_config").select("key, value").in("key", chiavi);
    return { data: (data ?? []).map((r) => ({ key: String(r.key), value: String(r.value ?? "") })), error: null };
  }
}

/** Drop-in di `.select("value").eq("key", chiave).maybeSingle()`. */
export async function appConfigEq(chiave: string): Promise<{ data: { value: string } | null; error: null }> {
  try {
    const r = (await tutte()).find((x) => x.key === chiave);
    return { data: r ? { value: r.value } : null, error: null };
  } catch {
    const { data } = await supabaseAdmin.from("app_config").select("value").eq("key", chiave).maybeSingle();
    return { data: data ? { value: String(data.value ?? "") } : null, error: null };
  }
}

/** Da chiamare dopo OGNI scrittura su app_config che tocca chiavi lette dalla cache. */
export function invalidaAppConfig(): void {
  cacheDel(CACHE_APP_CONFIG);
}
