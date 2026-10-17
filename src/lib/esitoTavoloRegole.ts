/**
 * L'ESITO DI UN ORDINE DAL TAVOLO — regola pura (nessun database).
 *
 * Dopo aver pagato (o confermato «in cassa») il cliente torna sulla pagina del
 * tavolo, non sulla conferma del ritiro: «votre commande est prête à 19:30,
 * venez la chercher» a chi e' seduto al tavolo 7 e' semplicemente falso.
 * Qui si decide COSA dirgli, e i casi sono questi:
 *
 *   nonTrovato   il token non corrisponde a nessun ordine
 *   annullato    l'ordine c'era, ed e' stato annullato
 *   inVerifica   pagamento online non ancora confermato (Stripe e' piu' lento
 *                del cliente): la pagina si ricarica da sola
 *   ricevuto     l'ordine e' in cucina, e allora:
 *     consegna   "tavolo" — lo porta un cameriere
 *                "banco"  — si ritira al banco, e lo si dice per email
 *     pagamento  "pagato"  — pagato online
 *                "inCassa" — da pagare sul posto
 *
 * ⚠️ «BANCO» LO DICE IL LOCALE, NON L'ORDINE. E' l'interruttore `avvisa` della
 * sala (Réglages → l'email «c'est prêt» in sala, col ripiego «niente tavoli =
 * si avvisa»): la stessa regola che decide se l'email parte davvero
 * (`avvisaChePronto`). Se la pagina dicesse «on vous prévient par email» a un
 * locale che non la manda, il cliente aspetterebbe un'email che non arriva.
 */

export type Consegna = "tavolo" | "banco";
export type Pagamento = "pagato" | "inCassa";

export type EsitoTavolo =
  | { tipo: "nonTrovato" }
  | { tipo: "annullato" }
  | { tipo: "inVerifica" }
  | { tipo: "ricevuto"; consegna: Consegna; pagamento: Pagamento; servito: boolean };

/** I campi della riga che servono a decidere. */
export interface RigaEsito {
  status?: unknown;
  payment_method?: unknown;
}

export function esitoTavolo(riga: RigaEsito | null | undefined, avvisa: boolean): EsitoTavolo {
  if (!riga) return { tipo: "nonTrovato" };
  const stato = String(riga.status ?? "");
  if (stato === "cancelled") return { tipo: "annullato" };
  const inCassa = String(riga.payment_method ?? "") === "onsite";
  // ⚠️ `pending` + `onsite` E' un ordine vero: e' in cucina, si paga dopo.
  // `pending` online invece aspetta Stripe, e dirlo «reçue» sarebbe una
  // promessa che un pagamento rifiutato smentirebbe.
  if (stato === "pending" && !inCassa) return { tipo: "inVerifica" };
  if (stato !== "pending" && stato !== "paid" && stato !== "done") return { tipo: "nonTrovato" };
  return {
    tipo: "ricevuto",
    consegna: avvisa ? "banco" : "tavolo",
    pagamento: inCassa && stato === "pending" ? "inCassa" : "pagato",
    servito: stato === "done",
  };
}

/** L'id di una sessione Stripe da quello che c'e' scritto nella riga: alla
 *  creazione e' l'URL di pagamento, dopo la conferma l'id vero (`cs_…`). */
export function idSessioneStripe(valore: unknown): string {
  const v = String(valore ?? "").trim();
  if (!v) return "";
  if (v.startsWith("cs_")) return v;
  const m = v.match(/\/(cs_[A-Za-z0-9_]+)/);
  return m ? m[1] : "";
}

/** Il parametro della pagina del tavolo che porta il token dell'ordine. */
export const PARAM_ORDINE = "order";

/** Quante volte la pagina si ricarica da sola aspettando Stripe (ogni 3s),
 *  prima di dire «controllate la vostra email». */
export const TENTATIVI_VERIFICA = 10;
