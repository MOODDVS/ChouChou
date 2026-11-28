/**
 * L'ASPORTO DEL PALMARE — le regole pure (28/11/2026). Il lavoro col database
 * sta in `asportoPalmare.ts`.
 */

/** I tre modi di pagare un asporto preso dal palmare. Il primo e' quello di
 *  base: si incassa al ritiro («da incassare», come «Payer au comptoir»). */
export const PAGAMENTI_ASPORTO = ["onsite", "cash", "card"] as const;
export type PagamentoAsporto = (typeof PAGAMENTI_ASPORTO)[number];

/**
 * A che punto e' un asporto, per le etichette della card:
 *   fase      «attesa» (in cucina), «pronto» (la cucina l'ha segnato, #89),
 *             «ritirato» (chiuso: `done`);
 *   incassare i soldi non sono ancora entrati (`pending` + `onsite`).
 */
export function statoAsporto(o: { status?: unknown; payment_method?: unknown; ready_at?: unknown }): {
  fase: "attesa" | "pronto" | "ritirato";
  incassare: boolean;
} {
  const s = String(o.status ?? "");
  const incassare = s === "pending" && String(o.payment_method ?? "") === "onsite";
  if (s === "done") return { fase: "ritirato", incassare };
  if (o.ready_at) return { fase: "pronto", incassare };
  return { fase: "attesa", incassare };
}
