/**
 * MENU — LO STATO DEL PUNTO, separato dalla DEFINIZIONE.
 *
 * Il menu e' del gruppo: stesso piatto, stesso prezzo, stessi formati nelle
 * tre pizzerie. Ma «oggi la burrata e' finita» e' vero a Stockel e falso a
 * Jourdan, e non e' una proprieta' del piatto: e' uno stato del punto. Per
 * questo non sta in `menu_items` ma in una tabella sua, `menu_sold_out`,
 * con una riga per (sede, piatto).
 *
 * ⚠️ Riga assente = vale quello scritto nel piatto (il valore del gruppo).
 * Riga presente = comanda lei, anche quando dice `false`. Se fosse solo
 * additiva — «puo' esaurire, non puo' ripristinare» — un punto non potrebbe
 * mai rimettere in vendita un piatto che il gruppo aveva segnato finito, e
 * se ne accorgerebbe la sera, con il cliente davanti.
 *
 * ⚠️ Questo passaggio serve anche al CHECKOUT, non solo alla vetrina.
 * Nascondere un piatto nel menu e poi accettarne il pagamento vuol dire
 * incassare per qualcosa che quella cucina non ha. Chi manda l'id e' il
 * browser, e il browser puo' mandare qualunque cosa.
 */
import { supabaseAdmin } from "./db";
import type { Ambito } from "./admin/sedeRegole";
// La parte PURA sta in `pricing.ts`: li' non c'e' IO e i test la provano.
import { applicaStato, type StatoPunto } from "./pricing";
export { applicaStato, type StatoPunto };

/**
 * Lo stato di questo punto, piatto per piatto. Mappa vuota se non siamo su
 * una sede (installazione a sede unica, o aggregato in sola lettura): li'
 * la verita' e' gia' quella scritta nel piatto.
 *
 * `itemIds` restringe la lettura quando si sta guardando un ordine di tre
 * righe invece del menu intero.
 */
export async function statiDelPunto(
  ambito: Ambito,
  itemIds?: string[],
): Promise<Map<string, StatoPunto>> {
  const per = new Map<string, StatoPunto>();
  if (ambito.modo !== "sede") return per;
  if (itemIds && itemIds.length === 0) return per;
  try {
    let q = supabaseAdmin
      .from("menu_sold_out")
      .select("item_id, sold_out, variants_off")
      .eq("location_id", ambito.id);
    if (itemIds) q = q.in("item_id", itemIds);
    const { data } = await q;
    for (const r of data ?? []) {
      per.set(String(r.item_id), {
        sold_out: r.sold_out === true,
        variants_off: Array.isArray(r.variants_off) ? (r.variants_off as string[]) : [],
      });
    }
  } catch {
    // Migrazione #73 non ancora lanciata: nessuno stato per punto, e il
    // menu del gruppo vale per tutti. Meglio di un menu che non si apre.
  }
  return per;
}

/** Comodita': legge lo stato del punto e lo sovrappone a un elenco di piatti. */
export async function applicaStatoSede<T extends Record<string, unknown>>(
  righe: T[],
  ambito: Ambito,
): Promise<T[]> {
  if (ambito.modo !== "sede" || righe.length === 0) return righe;
  const per = await statiDelPunto(
    ambito,
    righe.map((r) => String(r.id)),
  );
  if (per.size === 0) return righe;
  return righe.map((r) => applicaStato(r, per.get(String(r.id))));
}
