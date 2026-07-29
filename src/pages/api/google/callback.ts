import type { APIRoute } from "astro";
import { verificaState, salvaTokenDaCode } from "../../../lib/googleBusiness";

export const prerender = false;

// Ritorno dalla schermata di consenso Google.
// Non è una chiamata dell'admin ma una NAVIGAZIONE del browser: non c'è
// il Bearer token. L'autenticità è garantita dallo `state` firmato (HMAC,
// valido 10 minuti) creato da /api/google/connect, che solo il super admin
// può ottenere. Alla fine si torna sempre su /admin/super con un esito.

function vaiA(msg: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/super?google=${encodeURIComponent(msg)}`, "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const errore = url.searchParams.get("error");
  if (errore) return vaiA(errore === "access_denied" ? "refus" : "erreur");

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !verificaState(state)) return vaiA("etat");

  const esito = await salvaTokenDaCode(code);
  return vaiA(esito.ok ? "ok" : "echec");
};
