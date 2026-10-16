/**
 * LA VETRINA DEI PIATTI — quali foto girano in cima alla pagina del tavolo.
 *
 * ⚠️ Regola pura, senza import: la legge un'isola React (che non deve mai
 * arrivare a `db.ts`) e la provano i test senza database.
 *
 * ⚠️ SOLO PIATTI CHE SI POSSONO ORDINARE ADESSO. Una vetrina che mostra la
 * tagliata esaurita e' una promessa che il menu, due righe sotto, ritira:
 * chi la vede la cerca, la trova barrata, e ci resta male. Esaurito, o con
 * tutti i formati esauriti, non entra.
 *
 * ⚠️ PRIMA I CONSIGLIATI, poi i best-seller, poi il resto nell'ordine della
 * carta: e' lo stesso ordine di importanza che il ristoratore ha gia' dato
 * nell'admin, non un'altra classifica inventata qui.
 *
 * ⚠️ AL MASSIMO `max`: ogni foto e' un download sul telefono di chi e'
 * seduto, magari in 4G. Otto bastano a dare l'idea; il resto e' nel menu.
 */

/** Il minimo che serve di un piatto: la forma di `OrderApp`, senza importarla. */
export interface PiattoPerVetrina {
  id: string;
  name: string;
  image_url: string | null;
  is_sold_out: boolean;
  is_suggestion?: boolean;
  is_bestseller?: boolean;
  variants?: { sold_out?: boolean }[];
}

export const VETRINA_MAX = 8;

export function piattiInVetrina<T extends PiattoPerVetrina>(
  categorie: { items: T[] }[],
  max = VETRINA_MAX,
): T[] {
  const tutti = categorie.flatMap((c) => c.items ?? []);
  const visti = new Set<string>();
  const buoni = tutti.filter((p) => {
    if (!p || visti.has(p.id)) return false;
    visti.add(p.id);
    if (!String(p.image_url ?? "").trim()) return false;
    if (p.is_sold_out) return false;
    const formati = p.variants ?? [];
    if (formati.length > 0 && formati.every((v) => v.sold_out)) return false;
    return true;
  });
  const peso = (p: T) => (p.is_suggestion ? 0 : p.is_bestseller ? 1 : 2);
  // ⚠️ Ordinamento STABILE sull'indice: a parita' di peso resta l'ordine
  // della carta, cosi' la vetrina non cambia da un caricamento all'altro.
  return buoni
    .map((p, i) => ({ p, i }))
    .sort((a, b) => peso(a.p) - peso(b.p) || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map((x) => x.p);
}
