/**
 * GLI ORDINI DELLA LISTA «Commandes» — una query sola per due strade
 * (20/11/2026).
 *
 * La usano `GET /api/admin/orders` (il poll, il cambio di giorno) e il
 * PRIMO disegno della pagina `admin/orders.astro`, che arriva gia' coi dati
 * dal server.
 *
 * ⚠️ Perche' sta qui. Il primo disegno aveva una query sua, piu' corta:
 * senza `service`, `table_label`, `reservation_id`, `source`, `ready_at`...
 * Ogni ordine del tavolo arrivava come «ONLINE · DA ASPORTO», le card non si
 * raggruppavano per tavolo, i pagamenti a pezzi non c'erano; poi il poll
 * (25 s dopo) ridisegnava tutto giusto. Educazione Napoletana, 19/11/2026.
 * Due query che devono dire la stessa cosa prima o poi non la dicono.
 */
import { leggi, type Ambito } from "./sede";

/** `da` (ISO) e, per un giorno solo, `a` (ISO). */
export interface FinestraOrdini { da: string; a?: string | null }

/** Gli ordini della lista, ordinati per ora, senza doppioni. `null` = lettura fallita. */
export async function elencoOrdiniAdmin(ambito: Ambito, finestra: FinestraOrdini): Promise<Record<string, unknown>[] | null> {
  const CAMPI_BASE =
    "id, status, pickup_time, customer_name, customer_email, customer_phone, items, total_cents, lang, created_at, refunded_cents, stripe_session_id";
  // Colonne #50 (differenza dopo modifica). Se la migrazione non e' ancora
  // stata lanciata, il primo select fallisce e si ripiega sui campi base:
  // la lista continua a funzionare, la feature differenza resta dormiente.
  // `source` (#29, piu' vecchia della #50): «en ligne» o creato a mano, per il
  // nastro in testa alla card. Assente → il nastro dice solo «à emporter».
  const EXTRA_50 = ", supplement_due_cents, refund_due_cents, supplement_paid_at, payment_method, source";
  /* Colonne #82 (ordinare dal tavolo). ⚠️ Un tentativo A PARTE, non
     attaccato a EXTRA_50: uniti, un cliente che ha la #50 ma non la #82
     ricadrebbe sui soli campi base e perderebbe `payment_method` — cioe’ gli
     ordini da incassare tornerebbero a sembrare carrelli abbandonati. */
  const EXTRA_82 = ", service, table_label, reservation_id";
  // ⚠️ Nome esplicito: `leggi` e' il passaggio obbligato importato da
  // `sede.ts`, e una funzione locale con lo stesso nome lo ombreggerebbe in
  // TUTTO il corpo dell'handler — comprese le righe SOPRA di lei, che
  // finirebbero nella sua zona morta. Non un errore di compilazione: un
  // ReferenceError a pagina aperta.
  const leggiOrdini = (campi: string) => {
    const q1 = leggi("orders", ambito, campi).in("status", ["paid", "done", "cancelled"]);
    // Pending MANUALI (link di pagamento inviato): i pending del sito
    // (checkout abbandonati) restano fuori. Migrazione #29 assente → nessuno.
    const q2 = leggi("orders", ambito, campi).eq("status", "pending").eq("source", "manual");
    // ⚠️ Gli ordini DA INCASSARE: `pending` perche' nessuno li ha pagati — e
    // dire il contrario sarebbe scrivere un incasso che non e' entrato — ma
    // sono ordini veri, che la cucina sta preparando. Si distinguono da un
    // carrello abbandonato per `payment_method`, non per la configurazione del
    // locale: cosi' restano giusti anche dove la carta e la cassa convivono.
    //
    // ⚠️ Una query a SE', non un `or` dentro q2: se la colonna `source` manca
    // (migrazione #29 non lanciata) quella query fallisce tutta, e gli ordini
    // da incassare sparirebbero per una colonna che non li riguarda.
    const q3 = leggi("orders", ambito, campi).eq("status", "pending").eq("payment_method", "onsite");
    if (finestra.a) {
      q1.gte("pickup_time", finestra.da).lte("pickup_time", finestra.a);
      q2.gte("pickup_time", finestra.da).lte("pickup_time", finestra.a);
      q3.gte("pickup_time", finestra.da).lte("pickup_time", finestra.a);
    } else {
      q1.gte("pickup_time", finestra.da);
      q2.gte("pickup_time", finestra.da);
      q3.gte("pickup_time", finestra.da);
    }
    return Promise.all([
      q1.order("pickup_time", { ascending: true }),
      q2.order("pickup_time", { ascending: true }),
      q3.order("pickup_time", { ascending: true }),
    ]);
  };
  /* #84 (la consegna): un tentativo in piu', davanti. Senza la colonna si
     ripiega sulla #82 e la lista resta quella di ieri — che senza la #84 e'
     anche la verita': nessuna consegna puo' essere stata salvata. */
  const EXTRA_84 = ", delivery_address";
  // #85 (il costo della consegna): ancora un passo davanti, stesso ripiego.
  const EXTRA_85 = ", delivery_fee_cents";
  // #86 (la mancia): un passo in piu', stesso ripiego.
  const EXTRA_86 = ", tip_cents";
  // #89 (ordine «pronto» prima dell'incasso): il passo piu' avanti.
  const EXTRA_89 = ", ready_at";
  // #101 (l'annuncio rimandato all'apertura): ancora un passo davanti.
  const EXTRA_101 = ", announce_at";
  let [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82 + EXTRA_84 + EXTRA_85 + EXTRA_86 + EXTRA_89 + EXTRA_101);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82 + EXTRA_84 + EXTRA_85 + EXTRA_86 + EXTRA_89);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82 + EXTRA_84 + EXTRA_85 + EXTRA_86);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82 + EXTRA_84 + EXTRA_85);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82 + EXTRA_84);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50 + EXTRA_82);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE + EXTRA_50);
  if (princ.error) [princ, pend, cassa] = await leggiOrdini(CAMPI_BASE);

  if (princ.error) return null;

  // Nota: `select` con stringa variabile (fallback #50) fa perdere a TS il tipo
  // delle righe, quindi le tratto come oggetti generici per l'ordinamento.
  const righe = [
    ...(princ.data ?? []),
    ...(pend.error ? [] : (pend.data ?? [])),
    ...(cassa.error ? [] : (cassa.data ?? [])),
  ] as unknown as Array<Record<string, unknown>>;
  // ⚠️ Tre query, tre elenchi: una riga che ricadesse in due di essi
  // comparirebbe due volte nella lista. Si tiene la prima, sono la stessa.
  const perId = new Map<string, Record<string, unknown>>();
  for (const r of righe) if (!perId.has(String(r.id))) perId.set(String(r.id), r);
  const tutti = [...perId.values()].sort((a, b) =>
    String(a.pickup_time).localeCompare(String(b.pickup_time))
  );
  /* IL PAGATO IN PARTE (26/10/2026): il palmare incassa un tavolo anche a
     pezzi («Dividi», «Scegli»), e ogni parte e' una riga di `table_payments`.
     Gli ordini restano «da incassare» finche' il tavolo non e' saldato: qui
     ognuno porta quanto la sua seduta ha gia' pagato (`parziale_cents`),
     cosi' la card lo dice e incassa solo il resto. Senza la #88: niente. */
  const sedute = [...new Set(tutti
    .filter((o) => o.status === "pending" && o.payment_method === "onsite" && o.reservation_id)
    .map((o) => String(o.reservation_id)))];
  if (sedute.length) {
    const { data: pagRaw, error: ePag } = await leggi("table_payments", ambito, "reservation_id, amount_cents")
      .in("reservation_id", sedute)
      .eq("status", "paid");
    if (!ePag) {
      const perSeduta = new Map<string, number>();
      for (const p of (pagRaw ?? []) as unknown as { reservation_id: string; amount_cents: number }[]) {
        perSeduta.set(String(p.reservation_id), (perSeduta.get(String(p.reservation_id)) ?? 0) + (Number(p.amount_cents) || 0));
      }
      for (const o of tutti) {
        const v = perSeduta.get(String(o.reservation_id ?? ""));
        if (v && o.status === "pending" && o.payment_method === "onsite") o.parziale_cents = v;
      }
    }
  }
  return tutti;
}
