/**
 * Rate limiting IN MEMORIA (finestra fissa) — protezione anti-abuso / DoS.
 *
 * L'app gira come SINGOLA istanza Node (adapter standalone), quindi un
 * contatore in memoria di processo è sufficiente e non richiede servizi
 * esterni (Redis ecc.). Se in futuro si passa a più istanze, questo va
 * sostituito con uno store condiviso.
 *
 * Uso: `const r = colpisci(chiave, max, finestraMs);` → se `r.ok` è false
 * la richiesta va rifiutata con 429 e header `Retry-After: r.retryAfter`.
 */

interface Finestra {
  conteggio: number;
  reset: number; // epoch ms in cui la finestra si azzera
}

const bucket = new Map<string, Finestra>();
let ultimaPulizia = 0;

/** Rimuove le finestre scadute (chiamata pigra, non a ogni richiesta). */
function pulisci(adesso: number): void {
  if (adesso - ultimaPulizia < 30_000 && bucket.size < 5000) return;
  ultimaPulizia = adesso;
  for (const [k, f] of bucket) {
    if (adesso > f.reset) bucket.delete(k);
  }
  // Tetto di sicurezza duro: se qualcuno prova a far esplodere la mappa
  // (tante chiavi/IP diversi), svuota tutto — le finestre sono brevi.
  if (bucket.size > 50_000) bucket.clear();
}

/**
 * Registra un colpo per `chiave` e dice se è entro i limiti.
 * @param chiave    identificatore (es. "feedback:1.2.3.4")
 * @param max       colpi massimi nella finestra
 * @param finestraMs durata della finestra in ms
 */
export function colpisci(
  chiave: string,
  max: number,
  finestraMs: number,
): { ok: boolean; retryAfter: number; remaining: number } {
  const adesso = Date.now();
  pulisci(adesso);

  const f = bucket.get(chiave);
  if (!f || adesso > f.reset) {
    bucket.set(chiave, { conteggio: 1, reset: adesso + finestraMs });
    return { ok: true, retryAfter: 0, remaining: max - 1 };
  }

  f.conteggio++;
  if (f.conteggio > max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((f.reset - adesso) / 1000)), remaining: 0 };
  }
  return { ok: true, retryAfter: 0, remaining: max - f.conteggio };
}

/**
 * Estrae l'IP client "reale" dietro il proxy di Hostinger.
 * X-Forwarded-For è una lista "client, proxy1, proxy2…": il primo è il client.
 * Fallback: clientAddress (IP del socket) o "sconosciuto".
 */
export function ipClient(request: Request, clientAddress?: string): string {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const primo = xff.split(",")[0]?.trim();
  if (primo) return primo;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return (clientAddress || "sconosciuto").trim();
}
