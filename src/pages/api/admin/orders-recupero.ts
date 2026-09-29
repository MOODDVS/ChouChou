/**
 * IL RECUPERO — chiedere a Stripe se ci siamo persi un ordine.
 *
 * ⚠️ IL GUASTO CHE QUESTA ROTTA CHIUDE (29/09/2026)
 *
 * 450 Gradi e' andato in linea, due clienti hanno ordinato e pagato, e il
 * ristorante non ha visto niente: nessun ordine nel pannello, nessuna email,
 * nessuna notifica. I webhook di Stripe puntavano ancora al dominio di prova.
 * I pagamenti riuscivano, il cliente vedeva la sua pagina di conferma, e
 * l'ordine restava «in attesa» — che nel pannello vuol dire INVISIBILE, perche'
 * la lista mostra solo `paid`, `done` e `cancelled`.
 *
 * Nessun errore, da nessuna parte. L'unico posto al mondo dove era scritto era
 * il pannello di Stripe, e ci si guarda quando si sospetta qualcosa.
 *
 * ⚠️ NON BASTAVA UNA SPIA. La prima idea era un avviso «ci sono N ordini in
 * attesa da piu' di un quarto d'ora». Ma un ordine in attesa e' quasi sempre
 * un carrello abbandonato — uno che apre la pagina di pagamento e cambia
 * idea — quindi quella spia sarebbe accesa quasi sempre, e una spia sempre
 * accesa non la guarda piu' nessuno. L'unico che sa se un ordine e' stato
 * pagato davvero e' Stripe. Quindi non si avvisa: si CHIEDE, e si rimedia.
 *
 * Quando il ristoratore apre la pagina Ordini, questa rotta prende gli ordini
 * rimasti in attesa negli ultimi giorni e chiede a Stripe, uno per uno, se
 * quella sessione risulta pagata. Per quelli che lo sono chiama
 * `confermaOrdinePagato`: la stessa identica funzione del webhook, quindi
 * stato, email al cliente, email alla cucina, notifica e rubrica — non una
 * scorciatoia che ne fa meta'.
 *
 * ⚠️ Il carrello abbandonato non produce nulla: Stripe dice «unpaid», la
 * rotta non lo tocca e non lo nomina. Si vede solo quello che e' stato
 * recuperato davvero, cioe' quasi sempre niente.
 *
 * ⚠️ LA CHIAVE STRIPE E' DELLA SEDE, e la sede la dice la RIGA. Su tre
 * societa' sono tre conti: chiedere di una sessione di Stockel con la chiave
 * di Schaerbeek non da' un ordine sbagliato, da' un «non trovata» — e
 * l'ordine resterebbe perso in silenzio, che e' esattamente il guasto da cui
 * veniamo.
 *
 * ⚠️ E' una GUARIGIONE, non la strada normale. La strada normale resta il
 * webhook, che e' immediato; questa e' la rete sotto. Se recupera qualcosa
 * con regolarita', il webhook e' rotto e va sistemato: il messaggio nel
 * pannello lo dice.
 *
 * Precedente in casa: `GET /api/admin/credits` fa la stessa cosa per i
 * crediti newsletter quando il browser viene chiuso prima del ritorno.
 */
import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import {
  ambitoDiRichiesta,
  ambitoDiRiga,
  leggi,
  pagamentoOnlineAttivo,
} from "../../../lib/admin/sede";
import { stripeDi } from "../../../lib/stripe";
import { confermaOrdinePagato } from "../../../lib/confermaOrdine";

export const prerender = false;

/** Quanto indietro si guarda. Oltre, un ordine in attesa e' archeologia. */
const GIORNI = 3;

/**
 * Quanti ordini al massimo per chiamata.
 *
 * ⚠️ IL LIMITE VERO, DETTO CHIARO: un carrello abbandonato resta «in attesa»
 * per sempre, e viene richiesto a Stripe a ogni giro senza che diventi mai
 * pagato. Si guardano i piu' RECENTI, perche' e' li' che sta un pagamento
 * appena perso; se in tre giorni ci fossero piu' di quaranta ordini in
 * attesa, i piu' vecchi non verrebbero raggiunti.
 *
 * La cura pulita sarebbe segnare sulla riga «verificato il», per non
 * richiedere due volte lo stesso abbandono — ma vuole una colonna nuova,
 * cioe' una migrazione su ogni cliente. Quaranta ordini in attesa in tre
 * giorni vuol dire un ristorante con molti piu' carrelli abbandonati che
 * ordini: quel giorno si fa la colonna.
 */
const MAX = 40;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * L'id di sessione, da quello che c'e' scritto nella riga.
 *
 * ⚠️ Alla creazione dell'ordine in `stripe_session_id` finisce l'URL DI
 * PAGAMENTO, non l'id: e' la conferma a sostituirlo con l'id vero. Quindi qui
 * dentro puo' esserci l'uno o l'altro, e l'id si pesca dall'URL.
 */
function idSessione(valore: string | null): string {
  const v = (valore ?? "").trim();
  if (!v) return "";
  if (v.startsWith("cs_")) return v;
  const m = v.match(/\/(cs_[A-Za-z0-9_]+)/);
  return m ? m[1] : "";
}

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const ambito = await ambitoDiRichiesta(request, staff);

  const dalle = new Date(Date.now() - GIORNI * 24 * 3600 * 1000).toISOString();
  const { data: pendenti, error } = await leggi(
    "orders",
    ambito,
    "id, stripe_session_id, location_id",
  )
    .eq("status", "pending")
    .gte("created_at", dalle)
    .order("created_at", { ascending: false })
    .limit(MAX);

  if (error) {
    console.error("[recupero] lettura ordini in attesa fallita:", error);
    return json({ error: "db" }, 500);
  }

  let recuperati = 0;
  for (const o of pendenti ?? []) {
    const sid = idSessione(o.stripe_session_id as string | null);
    if (!sid) continue; // ordine senza sessione: non e' mai passato da Stripe

    // La sede della RIGA: e' la sua chiave che sa di questa sessione.
    const suo = ambitoDiRiga((o as { location_id: string | null }).location_id);
    try {
      if (!(await pagamentoOnlineAttivo(suo))) continue;
      const stripe = await stripeDi(suo);
      const sess = await stripe.checkout.sessions.retrieve(sid);
      if (sess.payment_status !== "paid") continue; // carrello abbandonato
      if (await confermaOrdinePagato({ orderId: o.id as string, ambito: suo, sessionId: sid })) {
        recuperati++;
      }
    } catch (e) {
      // ⚠️ Un ordine che non si riesce a verificare non ferma gli altri: e'
      // proprio quando qualcosa non va che gli altri vanno recuperati.
      console.error(`[recupero] ordine ${o.id} non verificabile:`, e);
    }
  }

  return json({ ok: true, recuperati });
};
