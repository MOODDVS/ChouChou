/**
 * LA CONSEGNA E LA MANCIA DI UN ORDINE, lette per le email.
 *
 * ⚠️ UN FILE A PARTE, e non dentro `confermaOrdine.ts`: le leggono anche
 * l'annullo, il ritardo e la modifica — rotte che non devono tirarsi dietro
 * Stripe, le push e la rubrica solo per sapere se l'ordine va portato a casa.
 * Senza, quelle email dicevano «retrait» a chi aspettava il fattorino.
 */
import { leggi, ambitoDiRiga } from "./admin/sede";
import { aConsegna } from "./ordiniRegole";
import { indirizzoDaRiga, rigaIndirizzo, linkMappa } from "./consegnaRegole";

/**
 * L'ordine e' DA CONSEGNARE? E allora dove. `null` = ritiro (o tavolo).
 *
 * ⚠️ UNA LETTURA A PARTE, come `salaDellOrdine` e per la stessa ragione:
 * `delivery_address` arriva con la #84, e su un cliente che non l'ha ancora
 * lanciata una `select` piu' larga farebbe fallire la conferma di un ordine
 * pagato. Qui un errore vuol dire soltanto «non e' una consegna» — e senza la
 * #84 una consegna non puo' neanche essere stata salvata.
 */
export async function consegnaDellOrdine(
  id: string,
  location_id: string | null,
): Promise<{ indirizzo: string; mappa: string; note: string; costo_cents: number } | null> {
  try {
    const ambito = ambitoDiRiga(location_id);
    // ⚠️ Il costo (#85) in un tentativo a parte: senza la colonna l'ordine
    // resta una consegna, solo senza la riga del costo nelle email.
    let { data, error } = await leggi("orders", ambito, "service, delivery_address, delivery_fee_cents")
      .eq("id", id)
      .maybeSingle();
    if (error) ({ data, error } = await leggi("orders", ambito, "service, delivery_address").eq("id", id).maybeSingle());
    if (error || !data) return null;
    const riga = data as { service?: unknown; delivery_address?: unknown; delivery_fee_cents?: unknown };
    if (!aConsegna(riga.service)) return null;
    const ind = indirizzoDaRiga(riga.delivery_address);
    if (!ind) return null;
    return {
      indirizzo: rigaIndirizzo(ind),
      mappa: linkMappa(ind),
      note: ind.note,
      costo_cents: Math.max(0, Math.round(Number(riga.delivery_fee_cents ?? 0)) || 0),
    };
  } catch {
    return null;
  }
}

/** La mancia dell'ordine (#86), 0 se non c'e' — o se manca la colonna, che
 *  senza la #86 e' anche la verita'. Lettura a parte, come la sala. */
export async function manciaDellOrdine(id: string, location_id: string | null): Promise<number> {
  try {
    const { data, error } = await leggi("orders", ambitoDiRiga(location_id), "tip_cents").eq("id", id).maybeSingle();
    if (error || !data) return 0;
    return Math.max(0, Math.round(Number((data as { tip_cents?: unknown }).tip_cents ?? 0)) || 0);
  } catch {
    return 0;
  }
}
