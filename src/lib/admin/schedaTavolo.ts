/**
 * LA SCHEDA DI UN TAVOLO, per il palmare — cosa c'e' sopra adesso.
 * (22/10/2026, vedi `claude/palmare.md` nel progetto.)
 *
 * Solo LETTURA, e tutto in una volta: il palmare non ha API, la pagina
 * `/admin/salle/table` la chiede nel render.
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
import { fusoDi } from "../fuso";
import { piattiVeri } from "./ordiniConti";
import { contiApertiDellaSala, riassumiConti, type RiassuntoConto } from "./contiSala";
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
  ora: string;
  stato: string;
  totale_cents: number;
  piatti: { qty: number; nome: string; variante: string | null }[];
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

/** `null` = il tavolo non esiste (o non e' di questo punto). */
export async function schedaTavolo(ambito: Ambito, tavoloId: string): Promise<SchedaTavolo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId)) return null;
  const { data: tRaw } = await leggi("restaurant_tables", ambito, "id, zone, name, seats").eq("id", tavoloId).maybeSingle();
  const t = tRaw as unknown as { id: string; zone: string; name: string; seats: number } | null;
  if (!t) return null;

  const fuso = await fusoDi(ambito);
  const ora = DateTime.now().setZone(fuso);
  const oggi = ora.toFormat("yyyy-MM-dd");

  const [conti, { data: resaRaw }, chiamate] = await Promise.all([
    contiApertiDellaSala(ambito),
    // Le prenotazioni di oggi che possono toccare il tavolo: chi e' seduto,
    // e chi deve ancora arrivare.
    leggi("reservations", ambito, "id, heure, people, first_name, last_name, status, tables, seated_at, tab_status")
      .eq("date", oggi)
      .in("status", ["pending", "confirmed", "seated"]),
    leggi("table_calls", ambito, "reason, status, created_at")
      .eq("table_id", tavoloId)
      .eq("status", "open")
      .gte("created_at", ora.minus({ hours: 12 }).toUTC().toISO() as string)
      .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as { reason: string | null }[]))),
  ]);

  // 1. Il conto aperto su questo tavolo (quello di partenza o uno unito).
  const mioConto = conti.find((c) => tavoloDellaRiga(c, tavoloId));
  const conto = mioConto ? ((await riassumiConti(ambito, [mioConto]))[0] ?? null) : null;

  const resa = (resaRaw ?? []) as unknown as {
    id: string; heure: string; people: number; first_name: string; last_name: string;
    status: string; tables: unknown; seated_at: string | null; tab_status: string | null;
  }[];
  const suoi = resa.filter((r) => tavoloDellaRiga(r, tavoloId));

  // 2. Senza conto: la sessione seduta di oggi, la piu' recente.
  let sessione: SchedaTavolo["sessione"] = null;
  let idsGruppo: string[] = mioConto
    ? [mioConto.tab_table_id, ...(mioConto.tables ?? [])].filter((x): x is string => Boolean(x))
    : [];
  if (!conto) {
    const seduta = suoi
      .filter((r) => r.status === "seated")
      .sort((a, b) => String(b.seated_at ?? "").localeCompare(String(a.seated_at ?? "")))[0];
    if (seduta) {
      idsGruppo = tavoliDelleRiga(seduta.tables);
      const { data: oRaw } = await leggi("orders", ambito, "id, customer_name, items, total_cents, status, created_at")
        .eq("reservation_id", seduta.id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: true });
      const ordini = ((oRaw ?? []) as unknown as {
        id: string; customer_name: string | null; status: string; total_cents: number | null; created_at: string;
        items: { id?: string; name?: string; base_name?: string; variant_label?: string; qty?: number }[] | null;
      }[]).map((o) => ({
        id: o.id,
        nome: String(o.customer_name ?? "").trim(),
        ora: DateTime.fromISO(o.created_at).setZone(fuso).toFormat("HH:mm"),
        stato: o.status,
        totale_cents: Number(o.total_cents) || 0,
        piatti: piattiVeri(o.items ?? []).map((p) => ({
          qty: Math.max(1, Math.floor(Number(p.qty) || 1)),
          nome: String(p.base_name ?? p.name ?? "").trim(),
          variante: String(p.variant_label ?? "").trim() || null,
        })),
      }));
      const nome = [seduta.first_name, seduta.last_name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
      sessione = {
        nome,
        walkin: nome === "Walk-in",
        persone: Number(seduta.people) || 0,
        dal: seduta.seated_at,
        ordini,
        totale_cents: ordini.reduce((s, o) => s + o.totale_cents, 0),
      };
    }
  }

  // Il gruppo: i tavoli uniti, nell'ordine in cui sono stati scelti.
  idsGruppo = [...new Set(idsGruppo.map(String))];
  let gruppo: SchedaTavolo["gruppo"] = null;
  if (idsGruppo.length > 1) {
    const { data: gRaw } = await leggi("restaurant_tables", ambito, "id, name, seats").in("id", idsGruppo);
    const perId = new Map(((gRaw ?? []) as unknown as { id: string; name: string; seats: number }[]).map((x) => [String(x.id), x]));
    const presenti = idsGruppo.map((id) => perId.get(id)).filter((x): x is { id: string; name: string; seats: number } => Boolean(x));
    if (presenti.length > 1) {
      gruppo = {
        // In ordine naturale («T1 + T2», mai «T2 + T1»): la catena del piano
        // puo' essere disegnata al contrario, il cameriere legge i numeri.
        nomi: presenti.map((x) => String(x.name ?? "")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        posti: presenti.reduce((n, x) => n + (Math.floor(Number(x.seats)) || 0), 0),
      };
    }
  }

  return {
    tavolo: { id: t.id, name: t.name, zone: t.zone, seats: Number(t.seats) || 0 },
    gruppo,
    conto,
    sessione,
    chiamata: chiamate.some((c) => (c.reason ?? "call") === "call"),
    addizione: chiamate.some((c) => c.reason === "bill") || Boolean(conto?.addizione),
    prossima: prossimaPrenotazione(suoi, ora.toFormat("HH:mm")),
    fuso,
  };
}
