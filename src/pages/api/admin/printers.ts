import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { elencoStampanti, mandaStampa, stampaConfigurata } from "../../../lib/bizprint";
import { firmaProva } from "../../../lib/printToken";

/**
 * LE STAMPANTI — riservato al SUPER ADMIN MOODD.
 *
 * GET  → { configurata, stampanti: [{ id, nome, stato, station }] }
 * POST → { printerId, location_id? }  manda una STAMPA DI PROVA
 *
 * ⚠️ L'elenco lo chiede il SERVER. Le chiavi dell'applicazione stanno
 * nell'ambiente del cliente e non devono mai arrivare al browser: di qui
 * escono nomi e numeri, mai una chiave.
 *
 * ⚠️ Perche' solo il super: la stampante la collega MOODD quando installa, e
 * un numero sbagliato scelto dal ristoratore e' un ticket che non esce senza
 * che nessuno sappia perche'. L'interruttore, quello si', un giorno potra'
 * stare nel pannello del cliente — e' la cosa che serve il venerdi' sera
 * quando la stampante si rompe.
 */
export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * L'indirizzo PUBBLICO di questo server.
 *
 * ⚠️ `new URL(request.url).origin` NON basta dietro un proxy: il server Node
 * dietro Hostinger vede arrivare la richiesta da `127.0.0.1`, e manderebbe al
 * servizio di stampa un indirizzo che il tablet non potra' mai aprire — il
 * lavoro risulterebbe «inviato» e non uscirebbe mai carta, che e' il modo
 * peggiore di rompersi. Gli header del proxy dicono il nome vero.
 *
 * Fidarsi di `x-forwarded-host` sarebbe pericoloso su una rotta pubblica (chi
 * chiama puo' scriverci quello che vuole); qui chiama il SUPER ADMIN appena
 * autenticato, e il valore serve solo a costruire l'indirizzo che gli
 * rimandiamo sotto gli occhi.
 */
function originePubblica(request: Request): string {
  const h = request.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!host) return new URL(request.url).origin;
  // ⚠️ `https` di ripiego, non `http`. IL GUASTO (05/10/2026): dietro
  // Hostinger il TLS finisce sul proxy e il server Node vede arrivare una
  // richiesta `http`, quindi spediva `http://restohub.moodd.online/...`.
  // Android lo rifiuta — «CLEARTEXT communication not permitted» — e il
  // lavoro restava «inviato» senza che uscisse mai carta. In sviluppo invece
  // `http` e' la verita', e dire `https` su localhost sarebbe un indirizzo
  // che non risponde.
  const locale = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const proto = (h.get("x-forwarded-proto") ?? (locale ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}

function segretoProva(): string {
  return String(import.meta.env.CRON_SECRET || import.meta.env.SUPABASE_SERVICE_KEY || "");
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();
  if (!stampaConfigurata()) return json({ configurata: false, stampanti: [] });
  const r = await elencoStampanti();
  // ⚠️ L'errore si dice. Un elenco vuoto perche' il servizio non risponde e un
  // elenco vuoto perche' non ci sono stampanti sono due cose diverse, e dal
  // pannello sembrerebbero la stessa.
  return json({ configurata: true, stampanti: r.stampanti, errore: r.ok ? undefined : r.errore });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff || !isSuperUser(staff)) return nonAutorizzato();

  const body = (await request.json().catch(() => ({}))) as { printerId?: unknown; location_id?: unknown };
  const printerId = Number(body.printerId);
  if (!Number.isFinite(printerId) || printerId <= 0) return json({ error: "printerId" }, 400);
  const sede = typeof body.location_id === "string" && RE_UUID.test(body.location_id) ? body.location_id : "";

  const segreto = segretoProva();
  if (!segreto) return json({ error: "segreto mancante" }, 500);

  const origine = originePubblica(request);
  const url = `${origine}/api/print/${firmaProva(sede, segreto)}`;

  const r = await mandaStampa(printerId, url, "RestoHub — test");
  // ⚠️ L'INDIRIZZO TORNA INDIETRO, e il pannello lo mostra. Il 05/10 il
  // lavoro risultava «inviato» e non usciva niente: senza vedere cosa era
  // stato spedito si poteva solo tirare a indovinare. Un indirizzo che
  // comincia per 127.0.0.1 o localhost dice in un colpo d'occhio che il
  // tablet non potra' mai leggerlo. Non e' un segreto: il token che contiene
  // vive dieci minuti e lo sta guardando chi l'ha appena creato.
  if (!r.ok) return json({ ok: false, errore: r.errore, url }, 502);
  return json({ ok: true, jobId: r.jobId, url });
};
