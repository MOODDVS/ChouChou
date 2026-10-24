/**
 * LA SCHEDA DI UN TAVOLO, per il palmare — cosa c'e' sopra adesso.
 * (22/10/2026, vedi `claude/palmare.md` nel progetto.)
 *
 * Solo LETTURA, e tutto in una volta: il palmare non ha API, la pagina
 * `/admin/salle/table` la chiede nel render.
 *
 * ⚠️ VELOCITA' (23/10/2026): i dati del giorno arrivano da `letturaSala`
 * (una lettura parallela, la pagina la passa e la riusa per il modale);
 * qui resta UN solo viaggio in piu', il riassunto del conto OPPURE gli ordini
 * della sessione. Prima erano cinque o sei letture in fila.
 *
 * Un tavolo, in quest'ordine di domande:
 *  1. ha un CONTO APERTO (da validare o aperto)? → il riassunto e' quello del
 *     tablet di Commandes (`riassumiConti`), cosi' resto e invii non possono
 *     dire due cose diverse sul tablet e sul telefono;
 *  2. altrimenti, c'e' una SESSIONE seduta oggi (prenotazione `seated`, dal QR
 *     o fatta sedere dal personale)? → chi, da quando, e gli ordini a ogni giro;
 *  3. altrimenti e' LIBERO.
 * E in ogni caso: le chiamate aperte (cameriere / addizione) e la prossima
 * prenotazione di oggi su quel tavolo.
 *
 * ⚠️ Niente `rilasciaInviiScaduti` qui: e' una scrittura, e la fa gia' il
 * tablet di Commandes a ogni giro. Guardare un tavolo dal telefono non deve
 * mandare niente in cucina.
 */
import { DateTime } from "luxon";
import { leggi, type Ambito } from "./sede";
import { piattiVeri } from "./ordiniConti";
import { riassumiConti, type RiassuntoConto } from "./contiSala";
import { letturaSala, type LetturaSala } from "./letturaSala";
import { righeModificabili, ordineModificabile, type RigaModificabile } from "./modificaOrdineRegole";
import { tavoloDellaRiga, tavoliDelleRiga, prossimaPrenotazione, type PrenotazioneDelGiorno } from "./schedaTavoloRegole";

export interface TavoloScheda {
  id: string;
  name: string;
  zone: string;
  seats: number;
}

export interface OrdineSessione {
  id: string;
  nome: string;
  /** Chi l'ha preso col palmare (#90), con la foto del Team se c'e'. */
  cameriere: { nome: string; foto: string } | null;
  /** Si puo' togliere qualcosa dal palmare (da incassare)? E le righe con il loro indice. */
  modificabile: boolean;
  righe: RigaModificabile[];
  ora: string;
  stato: string;
  totale_cents: number;
  piatti: { qty: number; nome: string; variante: string | null; nota: string | null }[];
}

export interface SchedaTavolo {
  tavolo: TavoloScheda;
  /**
   * I tavoli UNITI di chi e' seduto qui (23/10/2026): un gruppo di 6 a T1+T4
   * occupa tutti e due, e la scheda di T1 deve dirlo — titolo «T1 + T4» e i
   * posti sommati. `null` se il tavolo e' libero o il conto/la sessione ne
   * ha uno solo.
   */
  gruppo: { nomi: string[]; posti: number } | null;
  conto: RiassuntoConto | null;
  sessione: {
    nome: string;
    /** Seduti dal personale senza prenotazione («Walk-in»): un'icona, non un nome. */
    walkin: boolean;
    persone: number;
    dal: string | null;
    ordini: OrdineSessione[];
    totale_cents: number;
  } | null;
  chiamata: boolean;
  addizione: boolean;
  prossima: PrenotazioneDelGiorno | null;
  fuso: string;
}

/** Gli ordini di una sessione, con chi li ha presi (#90). Senza la #90 le
 *  colonne non ci sono: si rilegge senza, la scheda resta come prima. */
async function ordiniDellaSessione(ambito: Ambito, prenotazioneId: string): Promise<Record<string, unknown>[]> {
  const leggiCon = (campi: string) => leggi("orders", ambito, campi)
    .eq("reservation_id", prenotazioneId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });
  const r = await leggiCon("id, customer_name, items, total_cents, status, payment_method, created_at, taken_by_id, taken_by_name");
  if (!r.error) return (r.data ?? []) as unknown as Record<string, unknown>[];
  const s = await leggiCon("id, customer_name, items, total_cents, status, payment_method, created_at");
  return (s.data ?? []) as unknown as Record<string, unknown>[];
}

/** `null` = il tavolo non esiste (o non e' di questo punto).
 *  `lettura`: quella della pagina, se l'ha gia' fatta (deve avere i conti e
 *  le chiamate). */
export async function schedaTavolo(ambito: Ambito, tavoloId: string, lettura?: LetturaSala): Promise<SchedaTavolo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId)) return null;
  const l = lettura ?? await letturaSala(ambito, { conti: true, chiamate: true });
  const t = l.tavoli.find((x) => x.id === tavoloId);
  if (!t) return null;
  const { fuso, ora } = l;

  // 1. Il conto aperto su questo tavolo (quello di partenza o uno unito).
  const mioConto = l.conti.find((c) => tavoloDellaRiga(c, tavoloId));
  // Le prenotazioni di oggi che toccano il tavolo: chi e' seduto, chi arriva.
  const suoi = l.righe.filter((r) => tavoloDellaRiga(r, tavoloId));
  // 2. Senza conto: la sessione seduta di oggi, la piu' recente.
  const seduta = mioConto ? undefined : suoi
    .filter((r) => r.status === "seated")
    .sort((a, b) => String(b.seated_at ?? "").localeCompare(String(a.seated_at ?? "")))[0];

  // L'unico viaggio in piu': il riassunto del conto, o gli ordini della sessione.
  const [conto, oRaw] = await Promise.all([
    mioConto ? riassumiConti(ambito, [mioConto]).then((x) => x[0] ?? null) : Promise.resolve(null),
    seduta ? ordiniDellaSessione(ambito, seduta.id) : Promise.resolve([]),
  ]);
  // Le faccine dei camerieri: una lettura del Team, solo se serve.
  const idsCamerieri = [...new Set((oRaw as { taken_by_id?: string | null }[]).map((o) => o.taken_by_id).filter((x): x is string => Boolean(x)))];
  const foto = new Map<string, string>();
  if (idsCamerieri.length) {
    const { data: tRaw } = await leggi("team", ambito, "id, photo_url").in("id", idsCamerieri);
    for (const p of (tRaw ?? []) as unknown as { id: string; photo_url: string | null }[]) {
      if (p.photo_url) foto.set(String(p.id), String(p.photo_url));
    }
  }

  let sessione: SchedaTavolo["sessione"] = null;
  let idsGruppo: string[] = mioConto
    ? [mioConto.tab_table_id, ...(mioConto.tables ?? [])].filter((x): x is string => Boolean(x))
    : [];
  if (seduta) {
    idsGruppo = tavoliDelleRiga(seduta.tables);
    const ordini = ((oRaw ?? []) as unknown as {
      id: string; customer_name: string | null; status: string; total_cents: number | null; created_at: string;
      taken_by_id?: string | null; taken_by_name?: string | null; payment_method?: string | null;
      items: { id?: string; name?: string; base_name?: string; variant_label?: string; qty?: number; price_cents?: number; notes?: string }[] | null;
    }[]).map((o) => ({
      modificabile: ordineModificabile(o),
      righe: righeModificabili(o.items),
      id: o.id,
      nome: String(o.customer_name ?? "").trim(),
      cameriere: o.taken_by_name
        ? { nome: String(o.taken_by_name).trim(), foto: foto.get(String(o.taken_by_id ?? "")) ?? "" }
        : null,
      ora: DateTime.fromISO(o.created_at).setZone(fuso).toFormat("HH:mm"),
      stato: o.status,
      totale_cents: Number(o.total_cents) || 0,
      piatti: piattiVeri(o.items ?? []).map((p) => ({
        qty: Math.max(1, Math.floor(Number(p.qty) || 1)),
        nome: String(p.base_name ?? p.name ?? "").trim(),
        variante: String(p.variant_label ?? "").trim() || null,
        // Il commento del cameriere per la cucina («sans oignon»).
        nota: String(p.notes ?? "").trim() || null,
      })),
    }));
    const nome = [seduta.first_name, seduta.last_name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
    sessione = {
      nome,
      walkin: nome === "Walk-in",
      persone: Number(seduta.people) || 0,
      dal: seduta.seated_at,
      ordini,
      totale_cents: ordini.reduce((n, o) => n + o.totale_cents, 0),
    };
  }

  // Il gruppo: i tavoli uniti, dai tavoli gia' letti (nessun viaggio).
  const perId = new Map(l.tavoli.map((x) => [x.id, x]));
  const presenti = [...new Set(idsGruppo.map(String))]
    .map((id) => perId.get(id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  const gruppo: SchedaTavolo["gruppo"] = presenti.length > 1
    ? {
        // In ordine naturale («T1 + T2», mai «T2 + T1»): la catena del piano
        // puo' essere disegnata al contrario, il cameriere legge i numeri.
        nomi: presenti.map((x) => x.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        posti: presenti.reduce((n, x) => n + x.seats, 0),
      }
    : null;

  const chiamate = l.chiamate.filter((c) => String(c.table_id ?? "") === tavoloId);
  return {
    tavolo: { id: t.id, name: t.name, zone: t.zone, seats: t.seats },
    gruppo,
    conto,
    sessione,
    chiamata: chiamate.some((c) => (c.reason ?? "call") === "call"),
    addizione: chiamate.some((c) => c.reason === "bill") || Boolean(conto?.addizione),
    prossima: prossimaPrenotazione(suoi, ora.toFormat("HH:mm")),
    fuso,
  };
}
