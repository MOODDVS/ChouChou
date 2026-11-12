/**
 * Rate limiting IN MEMORIA (finestra fissa) — protezione anti-abuso / DoS.
 *
 * Il contatore vive nella memoria del processo: niente servizi esterni
 * (Redis ecc.), e per quello che deve fare basta.
 *
 * ⚠️ MA IL PROCESSO NON È UNO SOLO, e fino all'11/10/2026 qui c'era scritto
 * il contrario («l'app gira come SINGOLA istanza Node»). Su Hostinger è
 * falso, ed è stato misurato: LiteSpeed avvia due o tre processi `lsnode`
 * per applicazione — il secondo nasce alla prima richiesta HTTP — e non li
 * ritira più. Ogni processo ha la sua memoria, quindi il suo contatore: il
 * limite VERO è quello scritto moltiplicato per il numero di processi, e
 * quel numero non lo decidiamo noi.
 *
 * Non è un guasto da rincorrere: i limiti qui sotto sono tarati largo
 * apposta, e il doppio di «5 al minuto» resta un numero piccolo. È una cosa
 * da sapere quando si legge un limite e lo si crede esatto — e il giorno
 * che un limite dovesse essere davvero esatto (una soglia a pagamento, un
 * blocco per abuso), questo non è il posto dove metterlo: ci vuole un
 * contatore condiviso, nel database.
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
 * L'IP del cliente, come lo ha visto il NOSTRO proxy.
 *
 * ⚠️ AUDIT 3/11/2026, misurato con /api/ip mandando `X-Forwarded-For: 1.2.3.4`:
 *   - VPS (Caddy): l'header del cliente si butta, resta l'IP vero, uno solo.
 *   - Hostinger (LiteSpeed): l'header del cliente RESTA IN TESTA e il proxy
 *     aggiunge in coda → «1.2.3.4, <vero>, 1.2.3.4, <vero>, <vero>».
 * Prima si prendeva il PRIMO valore: su Hostinger lo sceglieva il cliente, e
 * il limite di richieste si aggirava cambiando l'header a ogni richiesta.
 *
 * L'ULTIMO valore invece lo scrive sempre l'ultimo proxy, e il cliente non lo
 * puo' toccare: vale su tutti e due. `X-Real-IP` solo se l'XFF manca (Caddy
 * lo lascia passare com'e', quindi su Caddy non e' affidabile).
 */
export function ipClient(request: Request, clientAddress?: string): string {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const ultimo = xff.split(",").map((v) => v.trim()).filter(Boolean).pop();
  if (ultimo) return ultimo;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return (clientAddress || "sconosciuto").trim();
}

/**
 * IL CORPO DELLE API PUBBLICHE HA UN TETTO (audit 12/11/2026). Ordini,
 * prenotazioni, contatti, conto al tavolo: richieste di pochi KB. Senza un
 * tetto chiunque poteva mandare centinaia di MB a `/api/track` o
 * `/api/contact`, che li leggono interi in memoria prima di guardarli.
 * L'admin e' escluso (carica foto e documenti) e passa comunque dal login;
 * il webhook di Stripe e' escluso: e' firmato, e un evento grande non va perso.
 */
export const CORPO_PUBBLICO_MAX = 256 * 1024;
export function corpoTroppoGrande(path: string, metodo: string, lunghezza: string | null): boolean {
  if (!path.startsWith("/api/") || path.startsWith("/api/admin/") || path === "/api/stripe-webhook") return false;
  if (metodo === "GET" || metodo === "HEAD" || metodo === "OPTIONS") return false;
  const n = Number(lunghezza);
  return Number.isFinite(n) && n > CORPO_PUBBLICO_MAX;
}
