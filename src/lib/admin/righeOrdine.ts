/**
 * LE RIGHE DI UN ORDINE DELLO STAFF — prezzi e formati SEMPRE dal database.
 *
 * Erano dentro `/api/admin/orders` (l'ordine manuale di Commandes). Spostate
 * qui il 23/10/2026 perche' le usa anche il palmare del cameriere
 * (`ordineCameriere.ts`): due copie del calcolo di un prezzo vorrebbero dire,
 * un giorno, lo stesso piatto a due prezzi a seconda di chi l'ha ordinato.
 */
import { leggi, type Ambito } from "./sede";
import { conRipiegoColonne, type RisultatoQuery } from "../db";
import { prezzoEffettivo, haVarianti, trovaVariante, etichettaVariante } from "../pricing";
import { applicaStatoSede } from "../menuStato";

/** Piatti per il calcolo di un ordine dello staff. Prezzi SEMPRE dal DB.
 *  Ripiega senza `variants` sui DB dove la migrazione #71 manca ancora. */
export async function piattiPerOrdine(ids: string[], ambito: Ambito): Promise<RisultatoQuery> {
  const CAMPI = "id, name, price_cents, available, discount_type, discount_value";
  const res = await conRipiegoColonne(
    CAMPI,
    async (campi) =>
      (await leggi("menu_items", ambito, campi).in("id", ids)) as unknown as RisultatoQuery
  );
  // L'esaurito e' del PUNTO, non del piatto: si sovrappone qui, dentro la
  // funzione, cosi' nessuno dei due chiamanti puo' dimenticarselo e vendere
  // una burrata finita stamattina a Stockel.
  if (res.data) {
    res.data = (await applicaStatoSede(
      res.data as unknown as Record<string, unknown>[],
      ambito,
    )) as unknown as typeof res.data;
  }
  return res;
}

/** Riga d'ordine a partire dal piatto e dal formato eventualmente scelto.
 *  `null` = il formato richiesto non esiste più (il chiamante risponde 409). */
export function rigaOrdine(
  piatto: any,
  rich: { qty?: unknown; variant?: unknown },
  lang: string,
  ambito: Ambito,
): { name: string; base_name: string; variant_label?: string; price_cents: number; qty: number; variant?: string } | null {
  const qty = Math.max(1, Math.floor(Number(rich.qty)));
  let variante = null as ReturnType<typeof trovaVariante>;
  if (haVarianti(piatto.variants, ambito)) {
    variante = trovaVariante(piatto.variants, rich.variant, true, ambito);
    if (!variante) return null;
  }
  const pieno = variante ? variante.price_cents : piatto.price_cents;
  const price_cents = prezzoEffettivo(pieno, piatto.discount_type, piatto.discount_value);
  const etichetta = variante ? etichettaVariante(variante, lang) : "";
  return {
    // `name` resta la stringa completa: la leggono email, stampa e Stripe.
    name: etichetta ? `${piatto.name} — ${etichetta}` : piatto.name,
    // I pezzi separati per la card Ordini (pastiglie sotto il nome), come in checkout.ts.
    base_name: piatto.name,
    ...(etichetta ? { variant_label: etichetta } : {}),
    price_cents,
    qty,
    ...(variante ? { variant: variante.key } : {}),
  };
}
