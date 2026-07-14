/**
 * Micro-cache in memoria con scadenza (TTL), condivisa dal processo server.
 * Serve a NON rifare a ogni pagina le stesse query su dati che cambiano
 * raramente (orari, social, pop-up, token verificati): il sito diventa
 * molto più reattivo, e una modifica nell'admin appare sul sito
 * pubblico entro al massimo TTL_STANDARD secondi.
 */

const TTL_STANDARD = 60_000; // 60 secondi

interface Voce {
  scade: number;
  valore: unknown;
}

const memoria = new Map<string, Voce>();

export function cacheGet<T>(chiave: string): T | undefined {
  const v = memoria.get(chiave);
  if (!v) return undefined;
  if (Date.now() > v.scade) {
    memoria.delete(chiave);
    return undefined;
  }
  return v.valore as T;
}

export function cacheSet(chiave: string, valore: unknown, ttlMs = TTL_STANDARD): void {
  // Tetto di sicurezza: mai far crescere la mappa all'infinito
  if (memoria.size > 500) {
    const adesso = Date.now();
    for (const [k, v] of memoria) {
      if (adesso > v.scade) memoria.delete(k);
    }
    if (memoria.size > 500) memoria.clear();
  }
  memoria.set(chiave, { scade: Date.now() + ttlMs, valore });
}

/**
 * Esegue `carica()` solo se il valore non è già in cache (o è scaduto).
 * Gli errori NON vengono messi in cache: al prossimo giro si riprova.
 */
export async function cacheOr<T>(
  chiave: string,
  carica: () => Promise<T>,
  ttlMs = TTL_STANDARD
): Promise<T> {
  const inCache = cacheGet<T>(chiave);
  if (inCache !== undefined) return inCache;
  const valore = await carica();
  cacheSet(chiave, valore, ttlMs);
  return valore;
}
