/**
 * LA RISPOSTA JSON DELLE API — una sola (audit 3/11/2026).
 *
 * Era copiata, identica, in sessantasette file. `no-store`: le risposte delle
 * API parlano di ordini, prenotazioni e soldi, e un proxy che le tenesse in
 * cache mostrerebbe a qualcuno i dati di qualcun altro, o di ieri.
 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
