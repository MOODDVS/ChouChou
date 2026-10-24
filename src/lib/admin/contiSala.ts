/**
 * I CONTI APERTI DELLA SALA, riassunti — una lettura sola per due schermi.
 *
 * Era il corpo del GET di `/api/admin/table-tabs` (il tablet di Commandes).
 * Spostato qui il 22/10/2026 perche' la scheda del tavolo del palmare
 * (`/admin/salle/table`) ha bisogno dello STESSO riassunto: totale, pagato,
 * resto, invii, chi ha preso cosa. Due copie di questi conti vorrebbero dire,
 * un giorno, un resto diverso sul tablet e sul telefono dello stesso tavolo.
 *
 * ⚠️ La lettura non scrive niente. Gli invii scaduti li fa partire chi chiama
 * (`rilasciaInviiScaduti`), se vuole: il tablet si', il palmare no.
 *
 * In fondo, VALIDA e RIFIUTA il primo invio di un conto (23/10/2026): erano
 * nel POST del tablet, ora li usa anche il palmare (`/api/admin/salle-tab`).
 */
import { DateTime } from "luxon";
import { leggi, aggiorna, type Ambito } from "./sede";
import { hannoOrdinato, pagamentoVivo, quadroPagamenti } from "../contoRegole";
import { rilasciaInviiScaduti, type RigaPagamento } from "../contoServer";
import { piattiVeri } from "./ordiniConti";
import { fusoDi } from "../fuso";

export interface RigaConto {
  id: string;
  date: string;
  status: string;
  tables: string[] | null;
  first_name: string;
  people: number;
  seated_at: string | null;
  tab_status: string | null;
  tab_code: string | null;
  tab_table_id: string | null;
  tab_people: number | null;
  tab_validated_at: string | null;
  location_id: string | null;
}
export const CAMPI_CONTO = "id, date, status, tables, first_name, people, seated_at, tab_status, tab_code, tab_table_id, tab_people, tab_validated_at, location_id";

export interface RigaOrdineConto {
  id: string;
  customer_name: string | null;
  items: { id?: string; name?: string; base_name?: string; variant_label?: string; qty?: number; price_cents?: number; notes?: string }[] | null;
  total_cents: number | null;
  status: string;
  round_id: string | null;
  reservation_id: string;
  table_label: string | null;
  created_at: string;
}

/**
 * I CONTI ANCORA APERTI (da validare o aperti), fino a 7 giorni.
 *
 * ⚠️ NON SOLO OGGI. Un conto rimasto aperto (il tavolo se n'e' andato senza
 * saldare, o nessuno ha premuto «Encaisser») a mezzanotte spariva dallo
 * schermo con il suo resto: nel database aperto, in nessuna pagina. Resta
 * finche' qualcuno non lo incassa o lo chiude — al massimo 7 giorni, come la
 * lista degli ordini.
 * ⚠️ E non solo `seated`: una prenotazione segnata «Fini» a mano non salda il
 * conto. Fuori solo le annullate (un conto rifiutato).
 * Senza la #87 non c'e' nessun conto: elenco vuoto, mai un errore.
 */
export async function contiApertiDellaSala(ambito: Ambito): Promise<RigaConto[]> {
  const ora = DateTime.now().setZone(await fusoDi(ambito));
  const daData = ora.minus({ days: 7 }).toFormat("yyyy-MM-dd");
  const { data, error } = await leggi("reservations", ambito, CAMPI_CONTO)
    .gte("date", daData)
    .neq("status", "cancelled")
    .in("tab_status", ["pending", "open"]);
  if (error) return [];
  return (data ?? []) as unknown as RigaConto[];
}

/** Il riassunto di un conto, come lo vedono il tablet e il palmare. */
export type RiassuntoConto = Awaited<ReturnType<typeof riassumiConti>>[number];

/**
 * Riassume i conti dati (righe di `reservations` lette con `CAMPI_CONTO`).
 * Prima quelli da validare, poi dal piu' vecchio.
 */
export async function riassumiConti(ambito: Ambito, conti: RigaConto[]) {
  const ids = conti.map((c) => c.id);
  const tavoliIds = [...new Set(conti.flatMap((c) => [c.tab_table_id, ...(c.tables ?? [])]).filter(Boolean) as string[])];

  const [{ data: ordRaw }, { data: invRaw }, { data: tavRaw }, chiamate, pagRaw] = await Promise.all([
    leggi("orders", ambito, "id, customer_name, items, total_cents, status, round_id, reservation_id, table_label, created_at")
      .in("reservation_id", ids)
      .not("round_id", "is", null)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true }),
    leggi("table_rounds", ambito, "id, reservation_id, number, status, release_at, released_at").in("reservation_id", ids),
    leggi("restaurant_tables", ambito, "id, name").in("id", tavoliIds),
    leggi("table_calls", ambito, "table_id, reason, status, created_at")
      .eq("status", "open")
      .eq("reason", "bill")
      .gte("created_at", DateTime.now().minus({ hours: 12 }).toUTC().toISO() as string)
      .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as { table_id: string | null }[]))),
    // I pagamenti (#88). Senza la migrazione: nessuno, e il conto si incassa
    // tutto al cameriere come prima.
    leggi("table_payments", ambito, "reservation_id, kind, method, status, amount_cents, tip_cents, payer_name, hold_until, order_ids")
      .in("reservation_id", ids)
      .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as (RigaPagamento)[]))),
  ]);
  const adesso = new Date();
  const ordini = (ordRaw ?? []) as unknown as RigaOrdineConto[];
  const invii = (invRaw ?? []) as unknown as { id: string; reservation_id: string; number: number; status: string; release_at: string | null }[];
  const nomeTavolo = new Map(((tavRaw ?? []) as unknown as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const conAddizione = new Set(chiamate.map((c) => String(c.table_id ?? "")));

  const out = conti.map((c) => {
    const suoi = ordini.filter((o) => o.reservation_id === c.id);
    const nomi = suoi.map((o) => String(o.customer_name ?? "").trim()).filter(Boolean);
    const { ordinato, su } = hannoOrdinato(nomi, c.tab_people ?? c.people);
    const totale = suoi.reduce((t, o) => t + (Number(o.total_cents) || 0), 0);
    /* ⚠️ Il pagato viene dai PAGAMENTI, non dagli ordini: una parte uguale
       pagata online non e' l'ordine di nessuno. In corso = prenotato da chi
       sta pagando adesso (non ancora arrivato). */
    const suoiPag = pagRaw.filter((p) => p.reservation_id === c.id);
    const q = quadroPagamenti(totale, suoiPag, adesso);
    const suoiInvii = invii.filter((i) => i.reservation_id === c.id).sort((a, b) => a.number - b.number);
    const tavoli = [c.tab_table_id, ...(c.tables ?? [])].filter((x, i, a) => x && a.indexOf(x) === i) as string[];
    return {
      id: c.id,
      /** Il giorno del conto: la scheda lo scrive se non e' oggi. */
      data: c.date,
      stato: c.tab_status,
      tavolo: nomeTavolo.get(String(c.tab_table_id)) ?? "",
      tavoli: tavoli.map((t) => nomeTavolo.get(t) ?? "").filter(Boolean),
      codice: c.tab_code ?? "",
      persone: su,
      ordinato,
      // Il semaforo dell'attesa parte dal PRIMO ordine: e' da li' che il
      // tavolo aspetta il cameriere.
      dal: suoi[0]?.created_at ?? c.seated_at ?? null,
      addizione: tavoli.some((t) => conAddizione.has(t)),
      totale_cents: totale,
      pagato_cents: q.pagato,
      in_corso_cents: q.inCorso,
      resto_cents: q.resto,
      pagamenti: suoiPag
        .filter((p) => pagamentoVivo(p, adesso))
        .map((p) => ({
          chi: String(p.payer_name ?? "").trim(),
          importo_cents: Number(p.amount_cents) || 0,
          mancia_cents: Number(p.tip_cents) || 0,
          in_corso: p.status !== "paid",
        })),
      invii: suoiInvii
        .map((i) => ({
          numero: i.number,
          partito: i.status === "released",
          partenza: i.release_at,
          righe: suoi
            .filter((o) => o.round_id === i.id)
            .map((o) => ({
              nome: String(o.customer_name ?? "").trim(),
              piatti: piattiVeri(o.items ?? []).map((p) => ({
                qty: Math.max(1, Math.floor(Number(p.qty) || 1)),
                nome: String(p.base_name ?? p.name ?? "").trim(),
                variante: String(p.variant_label ?? "").trim() || null,
                nota: String(p.notes ?? "").trim() || null,
              })),
              totale_cents: Number(o.total_cents) || 0,
            })),
        }))
        .filter((i) => i.righe.length > 0),
    };
  });
  // Prima quelli da validare, poi dal piu' vecchio.
  out.sort((a, b) => (a.stato === b.stato ? String(a.dal).localeCompare(String(b.dal)) : a.stato === "pending" ? -1 : 1));
  return out;
}

/**
 * VALIDARE UN CONTO: il primo invio parte adesso, il conto e' aperto.
 * Gia' aperto → "ok" (due camerieri che toccano insieme non sono un errore).
 */
export async function validaConto(ambito: Ambito, conto: RigaConto, adesso = new Date()): Promise<"ok" | "errore"> {
  if (conto.tab_status !== "pending") return "ok";
  const adessoIso = adesso.toISOString();
  const upd = await aggiorna("reservations", ambito, { tab_status: "open", tab_validated_at: adessoIso })
    .eq("id", conto.id)
    .eq("tab_status", "pending");
  if (upd.error) return "errore";
  // Il primo invio parte ADESSO: era l'unico in attesa della validazione.
  await aggiorna("table_rounds", ambito, { release_at: adessoIso })
    .eq("reservation_id", conto.id)
    .eq("status", "waiting")
    .is("release_at", null);
  await rilasciaInviiScaduti(ambito, conto.id);
  return "ok";
}

/**
 * RIFIUTARE UN CONTO: nessun invio parte, conto e ordini annullati.
 * Solo un conto ancora da validare: uno aperto ha gia' mandato piatti in cucina.
 */
export async function rifiutaConto(ambito: Ambito, conto: RigaConto, adesso = new Date()): Promise<"ok" | "non_valido" | "errore"> {
  if (conto.tab_status !== "pending") return "non_valido";
  await aggiorna("orders", ambito, { status: "cancelled" })
    .eq("reservation_id", conto.id)
    .not("round_id", "is", null)
    .eq("status", "pending");
  const upd = await aggiorna("reservations", ambito, { tab_status: "closed", tab_closed_at: adesso.toISOString(), status: "cancelled" })
    .eq("id", conto.id);
  return upd.error ? "errore" : "ok";
}
