import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi } from "../../../lib/admin/sede";
import { accodaTicket } from "../../../lib/stampaCoda";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";

/**
 * RISTAMPARE IL TICKET DI UN ORDINE.
 *
 * POST { id } → { ok: true } | { error }
 *
 * ⚠️ `origin: "manual"`, e non e' un dettaglio contabile. L'indice unico
 * `print_tickets_auto_unico` e' PARZIALE — vale solo `where origin = 'auto'` —
 * ed e' cio' che impedisce a un webhook ripetuto di far uscire due comande.
 * Una ristampa e' per definizione la seconda copia dello stesso ordine:
 * accodata come `auto` verrebbe rifiutata dal database, il bottone non farebbe
 * niente e nessuno saprebbe perche'. Lo schema l'aveva previsto fin dall'inizio.
 *
 * ⚠️ NON si stampa quello che non si deve preparare. `accodaTicket` passa da
 * `daStampare`: un ordine `pending` con un link di pagamento mai pagato e' un
 * carrello abbandonato, e stamparlo vuol dire cibo preparato per nessuno. La
 * pagina mostra il bottone solo dove ha senso, ma la regola vera sta qui:
 * una schermata si puo' aggirare, una rotta no.
 *
 * ⚠️ L'esito TORNA INDIETRO. Quando la stampa parte da sola, un fallimento
 * muto e' un fastidio; quando il ristoratore preme e resta a guardare la
 * stampante, il silenzio e' il guasto.
 */
export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

/** Il motivo tecnico → la frase per chi ha premuto. ⚠️ Ogni ramo ha la SUA:
 *  «non ha funzionato» manda a chiamare noi, «la stampante non e' configurata»
 *  lo risolve il ristoratore da solo. */
const SPIEGA: Record<string, string> = {
  servizio: "err.printNoService",
  stampante: "err.printNoPrinter",
  indirizzo: "err.printNoService",
  stato: "err.printNotPrintable",
  coda: "err.printFailed",
  errore: "err.printFailed",
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }
  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  // ⚠️ L'ordine si rilegge dal DATABASE, con l'ambito di chi chiede: stato e
  // metodo di pagamento decidono se si stampa, e quelli mandati dal browser
  // non sono una fonte.
  const { data: ord, error } = await leggi("orders", ambito, "id, status, payment_method, location_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !ord) return json({ error: await msg("err.orderNotFound") }, 404);

  const esito = await accodaTicket(
    {
      id: String(ord.id),
      status: ord.status as string | null,
      payment_method: ord.payment_method as string | null,
      location_id: (ord.location_id as string | null) ?? null,
    },
    { origine: "manual" },
  );

  if (!esito.accodati) {
    const chiave = SPIEGA[String(esito.motivo ?? "")] ?? "err.printFailed";
    console.error(`[stampa] ristampa rifiutata per ${id}:`, esito.motivo);
    return json({ error: await msg(chiave) }, 409);
  }
  return json({ ok: true, accodati: esito.accodati });
};
