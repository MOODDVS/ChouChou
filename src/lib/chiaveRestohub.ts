/**
 * LA CHIAVE DI admin.restohub.cloud (`RESTOHUB_STATO_KEY`), per le rotte
 * `/api/restohub/*`. Una sola, uguale su tutti i clienti e nell'admin; sempre
 * nell'header `x-restohub-key`, mai nell'indirizzo (finirebbe nei log).
 */
import { segretoUguale } from "./cronAuth";
import { json } from "./rispostaJson";
import { HEADER_CHIAVE } from "./statoRestohubRegole";

function chiaveAttesa(): string {
  const v = process.env.RESTOHUB_STATO_KEY ?? (import.meta.env as Record<string, unknown>).RESTOHUB_STATO_KEY;
  return String(v ?? "").trim();
}

/** `null` = chiave giusta, si continua; altrimenti la risposta da dare
 *  (503 senza variabile, 401 con una chiave diversa). */
export function rifiutaSenzaChiave(request: Request): Response | null {
  const attesa = chiaveAttesa();
  if (!attesa) return json({ errore: "non configurato" }, 503);
  if (!segretoUguale(request.headers.get(HEADER_CHIAVE) ?? "", attesa)) return json({ errore: "non autorizzato" }, 401);
  return null;
}
