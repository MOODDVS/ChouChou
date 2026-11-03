import type { APIRoute } from "astro";
import { json } from "../../lib/rispostaJson";
import { ipClient } from "../../lib/rateLimit";

export const prerender = false;

/**
 * DA DOVE ARRIVA L'IP DEL CLIENTE — una prova, non una funzione (audit
 * 3/11/2026, punto 7).
 *
 * Il limite di richieste conta per IP, e l'IP lo dice l'header
 * `X-Forwarded-For` che scrive il proxy davanti all'app: Caddy sul VPS,
 * LiteSpeed su Hostinger. Se il proxy AGGIUNGE in coda invece di riscrivere,
 * il primo valore lo sceglie il cliente, e il limite si aggira cambiando
 * l'header a ogni richiesta.
 *
 * Questa API mostra a chi la chiama solo quello che riguarda LUI: l'header
 * com'e' arrivato, l'IP del socket e quello che il limite usa. Niente di
 * nessun altro. Si toglie quando la regola e' decisa.
 */
export const GET: APIRoute = ({ request, clientAddress }) => {
  let socket = "";
  try { socket = clientAddress ?? ""; } catch { /* l'adapter non lo da' */ }
  return json({
    xff: request.headers.get("x-forwarded-for") ?? null,
    xRealIp: request.headers.get("x-real-ip") ?? null,
    socket,
    usato: ipClient(request, socket),
  });
};
