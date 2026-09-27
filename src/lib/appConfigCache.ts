import { supabaseAdmin } from "./db";
import { cacheOr, cacheDelPrefisso } from "./cache";
import type { Ambito } from "./admin/sedeRegole";

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
 *
 * MULTI-SEDE: passando un `ambito` di sede, i valori della sede si
 * sovrappongono a quelli dell'installazione — stessa regola di `leggiConfig`.
 *
 * ⚠️ Qui l'ambito e' OPZIONALE, ed e' l'unico posto dove me lo permetto.
 * Altrove (ordini, prenotazioni, chiusure) un filtro dimenticato rende le
 * righe di un'ALTRA societa': un guasto silenzioso. Qui invece un ambito
 * dimenticato rende il valore dell'INSTALLAZIONE — un ripiego definito, non
 * il dato di qualcun altro. E per i quattro clienti a sede unica e'
 * esattamente il comportamento di sempre.
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

/** Le righe della sede, in cache come quelle dell'installazione.
 *  ⚠️ La chiave di cache porta l'id dentro: senza, la prima richiesta che
 *  arriva riempirebbe la cache e per 30 secondi tutti gli altri punti si
 *  vedrebbero servita la sua configurazione. */
async function dellaSede(id: string): Promise<Riga[]> {
  return cacheOr(
    `${CACHE_APP_CONFIG}:${id}`,
    async () => {
      const { data, error } = await supabaseAdmin
        .from("location_config")
        .select("key, value")
        .eq("location_id", id);
      if (error) throw error;
      return (data ?? []).map((r) => ({ key: String(r.key), value: String(r.value ?? "") }));
    },
    TTL_MS,
  );
}

/** Installazione + sede sovrapposta. */
async function unite(ambito?: Ambito): Promise<Riga[]> {
  const base = await tutte();
  if (!ambito || ambito.modo !== "sede") return base;
  try {
    const sue = await dellaSede(ambito.id);
    if (sue.length === 0) return base;
    const m = new Map(base.map((r) => [r.key, r]));
    for (const r of sue) m.set(r.key, r);
    return [...m.values()];
  } catch {
    return base; // migrazione #73 non lanciata
  }
}

/** Drop-in di `.select("key, value").in("key", chiavi)`. */
export async function appConfigIn(chiavi: string[], ambito?: Ambito): Promise<{ data: Riga[]; error: null }> {
  try {
    const set = new Set(chiavi);
    return { data: (await unite(ambito)).filter((r) => set.has(r.key)), error: null };
  } catch {
    const { data } = await supabaseAdmin.from("app_config").select("key, value").in("key", chiavi);
    return { data: (data ?? []).map((r) => ({ key: String(r.key), value: String(r.value ?? "") })), error: null };
  }
}

/** Drop-in di `.select("value").eq("key", chiave).maybeSingle()`. */
export async function appConfigEq(chiave: string, ambito?: Ambito): Promise<{ data: { value: string } | null; error: null }> {
  try {
    const r = (await unite(ambito)).find((x) => x.key === chiave);
    return { data: r ? { value: r.value } : null, error: null };
  } catch {
    const { data } = await supabaseAdmin.from("app_config").select("value").eq("key", chiave).maybeSingle();
    return { data: data ? { value: String(data.value ?? "") } : null, error: null };
  }
}

/** Da chiamare dopo OGNI scrittura su app_config che tocca chiavi lette dalla cache. */
export function invalidaAppConfig(): void {
  // Prefisso, non chiave esatta: cancella anche le copie per sede.
  cacheDelPrefisso(CACHE_APP_CONFIG);
}
