import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi, aggiorna } from "../../../lib/admin/sede";
import { aperteNellaFinestra, FINESTRA_CHIAMATE_MIN, type ChiamataAperta } from "../../../lib/chiamateRegole";

/**
 * «APPELER LE SERVEUR» — il lato del tablet.
 *
 * GET  → { calls: [{ id, table_id, table_label, caller_name, created_at }] }
 *        (`caller_name` dove la sala non ha tavoli)
 *        le chiamate ancora aperte degli ultimi minuti, dalla piu' vecchia.
 * POST { ids: string[] } → { ok: true }
 *        qualcuno ha toccato il toast: «ci vado». Le chiamate si chiudono.
 *
 * ⚠️ La lettura FALLITA risponde una lista vuota, non un errore: la chiede
 * AdminNav ogni pochi secondi su OGNI pagina, e su un'installazione che non
 * ha ancora lanciato la #83 un 500 a ripetizione riempirebbe i log senza
 * dire niente di nuovo. Il motivo vero lo scrive la rotta pubblica, una
 * volta, quando qualcuno chiama davvero.
 */
export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  const adesso = DateTime.now();
  const da = adesso.minus({ minutes: FINESTRA_CHIAMATE_MIN }).toUTC().toISO() as string;
  const { data, error } = await leggi("table_calls", ambito, "id, table_id, table_label, caller_name, created_at")
    .eq("status", "open")
    .gte("created_at", da)
    .limit(100);
  if (error) return json({ calls: [] });
  return json({ calls: aperteNellaFinestra((data ?? []) as unknown as ChiamataAperta[], adesso.toMillis()) });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "requete invalide" }, 400);
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.map((x) => String(x)).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100)
    : [];
  if (!ids.length) return json({ ok: true });
  /* ⚠️ `aggiorna` filtra per sede: un id di un altro punto, anche se
     arrivasse qui, non verrebbe toccato. */
  const { error } = await aggiorna("table_calls", ambito, { status: "done", done_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "open");
  if (error) return json({ error: "impossible" }, 500);
  return json({ ok: true });
};
