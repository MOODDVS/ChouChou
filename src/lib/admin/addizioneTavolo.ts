/**
 * «ADDITION» DAL PALMARE (Enzo, 24/10/2026): il conto di tutto quello che il
 * tavolo ha ordinato, sulla stampante principale (`print_printer_id`).
 *
 * Riusa `accodaAddizione` (la stessa di Commandes › conto aperto): una riga
 * `customer` / `manual` attaccata al PRIMO ordine; la rotta del ticket
 * (`/api/print/[token]`) disegna poi l'addizione intera.
 *  - conto aperto (QR): il capo e' il primo ordine CON `round_id`;
 *  - sessione del cameriere: il primo ordine della seduta, SENZA `round_id`
 *    — la rotta, vedendo un capo senza invio, prende tutti gli ordini della
 *    seduta senza invio.
 * ⚠️ `manual`: si puo' ristampare quante volte serve (l'indice unico della
 * #77 vale solo per gli automatici).
 */
import { leggi, type Ambito } from "./sede";
import { letturaSala } from "./letturaSala";
import { tavoloDellaRiga } from "./schedaTavoloRegole";
import { accodaAddizione } from "../stampaCoda";

export type EsitoAddizione =
  | { ok: true }
  | { ok: false; errore: "nessuno" | "vuoto" | "stampa"; motivo?: string };

export async function stampaAddizioneTavolo(ambito: Ambito, tavoloId: string): Promise<EsitoAddizione> {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId)) return { ok: false, errore: "nessuno" };
  const l = await letturaSala(ambito, { conti: true });
  const conto = l.conti.find((c) => tavoloDellaRiga(c, tavoloId));
  const seduta = conto ? undefined : l.righe
    .filter((r) => r.status === "seated" && tavoloDellaRiga(r, tavoloId))
    .sort((a, b) => String(b.seated_at ?? "").localeCompare(String(a.seated_at ?? "")))[0];
  const prenId = conto?.id ?? seduta?.id;
  if (!prenId) return { ok: false, errore: "nessuno" };
  let q = leggi("orders", ambito, "id, location_id")
    .eq("reservation_id", prenId)
    .neq("status", "cancelled");
  q = conto ? q.not("round_id", "is", null) : q.is("round_id", null);
  const { data } = await q.order("created_at", { ascending: true }).limit(1);
  const capo = ((data ?? []) as unknown as { id: string; location_id: string | null }[])[0];
  if (!capo) return { ok: false, errore: "vuoto" };
  const esito = await accodaAddizione(capo);
  if (!esito.accodati) return { ok: false, errore: "stampa", motivo: esito.motivo };
  return { ok: true };
}
