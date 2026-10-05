import { randomUUID } from "node:crypto";
import { leggi, inserisci, aggiorna, leggiConfig, ambitoDiRiga } from "./admin/sede";
import { CHIAVI_STAMPA, daStampare, stampaAttiva } from "./stampaRegole";
import { mandaStampa, stampaConfigurata } from "./bizprint";
import { indirizzoPubblico } from "./indirizzoPubblico";

/**
 * METTERE UN ORDINE IN CODA DI STAMPA.
 *
 * ⚠️ Non fa mai fallire chi la chiama. La stampa e' un di piu': un ticket che
 * non esce e' un fastidio, un ordine che non si registra perche' la stampante
 * e' spenta e' una perdita. Per questo si chiama con `void`, come le email,
 * e qui dentro ogni errore si scrive e si inghiotte.
 *
 * ⚠️ LA PROTEZIONE DAL DOPPIONE STA NEL DATABASE, non qui. L'indice unico
 * `(order_id, kind) where origin = 'auto'` della #76 rifiuta la seconda riga:
 * un ordine pagato puo' essere visto piu' volte — webhook Stripe ripetuto,
 * ritorno dal pagamento, modifica — e due comande uguali in cucina vogliono
 * dire due pizze. Un controllo «esiste gia'?» fatto qui non basterebbe: due
 * richieste possono arrivare nello stesso istante e passarlo tutte e due.
 */
export async function accodaTicket(o: {
  id: string;
  status?: string | null;
  payment_method?: string | null;
  location_id?: string | null;
}): Promise<void> {
  try {
    // 1. Questo ordine merita un ticket? La regola sta in `stampaRegole`, ed
    //    e' la stessa che la pagina Ordini usa per decidere cosa mostrare.
    if (!daStampare(o.status, o.payment_method)) return;
    if (!stampaConfigurata()) return;

    const ambito = ambitoDiRiga(o.location_id ?? null);
    const cfg = await leggiConfig(ambito, [...CHIAVI_STAMPA]);
    const printerId = Number(cfg.valori.get("print_printer_id") ?? "");
    // ⚠️ Volere non e' potere: l'interruttore dice che il ristoratore la
    // vuole, il numero dice che la stampante esiste. Acceso senza numero vuol
    // dire riempire la coda di righe che nessuno stampera' mai.
    if (!stampaAttiva(cfg.valori.get("print_auto"), cfg.valori.get("print_printer_id"))) return;

    // 2. L'indirizzo da far aprire al servizio di stampa. Senza, non c'e'
    //    niente da mandare: meglio nessuna riga che una riga che punta a un
    //    indirizzo inesistente e fallira' cinque volte.
    const base = indirizzoPubblico();
    if (!base) {
      console.error("[stampa] PUBLIC_SITE_URL non configurata: nessun indirizzo da dare alla stampante");
      return;
    }

    // 3. La riga in coda. ⚠️ Il token NON contiene `~`: quel segno distingue
    //    il biglietto della stampa di prova (vedi printToken.ts).
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const { data: riga, error } = await inserisci("print_tickets", ambito, {
      order_id: o.id,
      kind: "kitchen",
      origin: "auto",
      status: "queued",
      token,
    })
      .select("id")
      .maybeSingle();

    if (error) {
      // 23505 = l'indice unico ha fatto il suo lavoro: questo ordine era gia'
      // in coda. Non e' un guasto, e' la protezione dal doppio ticket.
      if (String((error as { code?: string }).code ?? "") === "23505") return;
      console.error("[stampa] coda:", error.message);
      return;
    }
    const idRiga = String((riga as { id?: string } | null)?.id ?? "");
    if (!idRiga) return;

    // 4. Si spedisce l'INDIRIZZO, non il ticket: il tablet va a leggerlo.
    const r = await mandaStampa(printerId, `${base}/api/print/${token}`, `Ticket ${o.id.slice(-4).toUpperCase()}`);

    // ⚠️ Lo stato NON diventa `sent` qui. `sent` vuol dire «il servizio ha
    // chiesto il ticket», e lo scrive la rotta pubblica quando il tablet la
    // apre davvero. Qui si segna solo il tentativo: se restasse `queued` con
    // un `job_id`, sapremmo che il lavoro e' partito e la carta no — che e'
    // esattamente la differenza che serve vedere.
    await aggiorna("print_tickets", ambito, {
      attempts: 1,
      job_id: r.ok ? (r.jobId ?? null) : null,
      last_error: r.ok ? null : String(r.errore ?? "").slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", idRiga);
  } catch (e) {
    // Mai propagare: vedi l'avvertimento in testa.
    console.error("[stampa] accodaTicket:", String((e as Error)?.message ?? e));
  }
}

/** I ticket di un ordine, per il pannello: quanti ne sono usciti e quando. */
export async function ticketDiOrdine(orderId: string, location_id: string | null) {
  const { data } = await leggi("print_tickets", ambitoDiRiga(location_id), "id, status, attempts, last_error, created_at, printed_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  return data ?? [];
}
