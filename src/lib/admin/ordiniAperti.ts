/**
 * GLI ORDINI APERTI DI TUTTA LA SALA — la pagina «Commandes» del palmare
 * (/admin/salle/orders, deciso con Enzo il 25/10/2026).
 *
 * Una card per TAVOLATA (la seduta): i suoi ordini aperti insieme (Enzo,
 * 25/10/2026; prima era una card per ordine). Quali ordini sono «aperti»:
 *  - sui tavoli seduti dal cameriere: gli ordini DA INCASSARE (`pending` +
 *    `onsite`) e quelli del QR pagati subito online (metodo vuoto e non piu'
 *    `pending`: un `pending` senza metodo e' un carrello abbandonato) — la
 *    cucina li sta preparando finche' il tavolo e' seduto;
 *  - sul conto aperto del QR: gli ordini dei suoi invii (`round_id`), con i
 *    nomi di chi ha ordinato.
 * ⚠️ Gli ordini gia' incassati (cash / card) sono chiusi: non ci sono.
 *
 * Tre letture in fila, e tutte piccole: la sala (`letturaSala`, in
 * parallelo), gli ordini delle sedute, le foto dei camerieri.
 */
import { DateTime } from "luxon";
import { leggi, type Ambito } from "./sede";
import { letturaSala } from "./letturaSala";
import { tavoliDelleRiga } from "./schedaTavoloRegole";
import { piattiVeri } from "./ordiniConti";
import { statiTavoli } from "../statoTavoliRegole";

export type TagOrdine = "valider" | "compte" | "paye";

export interface OrdineAperto {
  id: string;
  /** «T1 + T2». */
  tavoli: string;
  /** Il tavolo da aprire toccando la card. */
  tavoloId: string;
  /** L'ora in cui si sono seduti, «10:02». */
  seduti: string | null;
  /** Da quando aspetta (ISO): il timer della card. */
  dal: string;
  /** Chi ha preso gli ordini (uno o piu' camerieri). */
  camerieri: { nome: string; foto: string }[];
  /** Il QR: i nomi di chi ha ordinato. */
  nomi: string[];
  tag: TagOrdine[];
  articoli: number;
  totale_cents: number;
  /** Preso da chi guarda (il dipendente del palmare). */
  mio: boolean;
  /** Il tavolo va liberato: rosso (tempo finito, prenotazione entro 15
   *  minuti) o bianco (prenotazione entro l'ora) — le regole della mappa. */
  liberare: { tipo: "rosso" | "bianco"; resa: string; fine: string | null } | null;
}

interface RigaOrdineAperto {
  id: string;
  reservation_id: string;
  round_id: string | null;
  status: string;
  payment_method: string | null;
  items: { id?: unknown; qty?: unknown }[] | null;
  total_cents: number | null;
  created_at: string;
  customer_name: string | null;
  taken_by_id?: string | null;
  taken_by_name?: string | null;
}

export async function ordiniAperti(ambito: Ambito, mioId: string | null): Promise<OrdineAperto[]> {
  const l = await letturaSala(ambito, { conti: true });
  const { fuso } = l;
  const hhmm = (iso: string | null | undefined) => (iso ? DateTime.fromISO(iso).setZone(fuso).toFormat("HH:mm") : null);
  const nomeDi = new Map(l.tavoli.map((t) => [t.id, t.name]));

  // Le sedute: oggi, sedute; e i conti aperti (anche di ieri).
  type Seduta = { id: string; tavoli: string[]; conto: "pending" | "open" | null; seduti: string | null };
  const sedute = new Map<string, Seduta>();
  for (const r of l.righe) {
    if (r.status !== "seated") continue;
    const tavoli = [...new Set([...(r.tab_table_id ? [r.tab_table_id] : []), ...tavoliDelleRiga(r.tables)])];
    const conto = r.tab_status === "pending" || r.tab_status === "open" ? r.tab_status : null;
    sedute.set(r.id, { id: r.id, tavoli, conto, seduti: hhmm(r.seated_at) });
  }
  for (const c of l.conti) {
    if (sedute.has(c.id)) continue;
    const tavoli = [...new Set([...(c.tab_table_id ? [c.tab_table_id] : []), ...tavoliDelleRiga(c.tables)])];
    sedute.set(c.id, { id: c.id, tavoli, conto: c.tab_status === "pending" ? "pending" : "open", seduti: hhmm(c.seated_at) });
  }
  if (!sedute.size) return [];

  // Gli ordini (con il cameriere della #90, o senza se manca).
  const ids = [...sedute.keys()];
  const leggiCon = (campi: string) => leggi("orders", ambito, campi)
    .in("reservation_id", ids)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });
  const BASE = "id, reservation_id, round_id, status, payment_method, items, total_cents, created_at, customer_name";
  let r = await leggiCon(`${BASE}, taken_by_id, taken_by_name`);
  if (r.error) r = await leggiCon(BASE);
  const righe = (r.data ?? []) as unknown as RigaOrdineAperto[];

  const idsCam = [...new Set(righe.map((o) => o.taken_by_id).filter((x): x is string => Boolean(x)))];
  const foto = new Map<string, string>();
  if (idsCam.length) {
    const { data } = await leggi("team", ambito, "id, photo_url").in("id", idsCam);
    for (const p of (data ?? []) as unknown as { id: string; photo_url: string | null }[]) {
      if (p.photo_url) foto.set(String(p.id), String(p.photo_url));
    }
  }

  // Le regole della mappa per «da liberare».
  const stati = statiTavoli({
    tavoli: l.tavoli.map((t) => t.id),
    righe: l.righe,
    conti: l.conti,
    chiamate: [],
    qrDiretti: new Set(),
    adessoHHmm: l.ora.toFormat("HH:mm"),
    durate: l.durate,
    conOrdini: l.conOrdini,
  });
  const liberareDi = (tavoli: string[]): OrdineAperto["liberare"] => {
    const st = tavoli.map((t) => stati.get(t)).filter((x): x is NonNullable<typeof x> => Boolean(x));
    const rosso = st.find((x) => x.sforo);
    if (rosso?.sforo) return { tipo: "rosso", resa: rosso.sforo.prossima, fine: rosso.sforo.fine };
    const bianco = st.filter((x) => x.arrivo).sort((a, b) => String(a.arrivo).localeCompare(String(b.arrivo)))[0];
    return bianco?.arrivo ? { tipo: "bianco", resa: bianco.arrivo, fine: null } : null;
  };
  const articoliDi = (items: RigaOrdineAperto["items"]) =>
    piattiVeri((items ?? []) as { id?: unknown; qty?: unknown }[]).reduce((n, i) => n + Math.max(1, Math.floor(Number(i.qty) || 1)), 0);

  /* UNA CARD PER TAVOLATA (Enzo, 25/10/2026: «deve raggruppare»): tutti gli
     ordini aperti della stessa seduta insieme — i camerieri che li hanno
     presi, i nomi del QR, le etichette, gli articoli e il totale sommati. */
  const perSeduta = new Map<string, RigaOrdineAperto[]>();
  for (const o of righe) {
    const s = sedute.get(o.reservation_id);
    if (!s) continue;
    // Il conto aperto: gli ordini dei suoi invii.
    if (s.conto) {
      if (!o.round_id) continue;
    } else {
      const daIncassare = o.status === "pending" && o.payment_method === "onsite";
      const pagatoOnline = !o.payment_method && o.status !== "pending";
      if (!daIncassare && !pagatoOnline) continue;
    }
    perSeduta.set(s.id, [...(perSeduta.get(s.id) ?? []), o]);
  }
  const out: OrdineAperto[] = [];
  for (const [id, ordini] of perSeduta) {
    const s = sedute.get(id)!;
    const camerieri = new Map<string, { nome: string; foto: string }>();
    const nomi: string[] = [];
    for (const o of ordini) {
      const nomeCam = String(o.taken_by_name ?? "").trim();
      if (nomeCam) {
        const k = o.taken_by_id || nomeCam;
        if (!camerieri.has(k)) camerieri.set(k, { nome: nomeCam, foto: o.taken_by_id ? (foto.get(o.taken_by_id) ?? "") : "" });
        continue;
      }
      // Dal QR (o dal sito): il nome di chi ha ordinato.
      const nome = String(o.customer_name ?? "").trim();
      if (nome && nome !== "Walk-in" && !nomi.includes(nome)) nomi.push(nome);
    }
    const tag: TagOrdine[] = [];
    if (s.conto) tag.push(s.conto === "pending" ? "valider" : "compte");
    else if (ordini.some((o) => !o.payment_method && o.status !== "pending")) tag.push("paye");
    out.push({
      id,
      tavoli: s.tavoli.map((t) => nomeDi.get(t) ?? "").filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(" + "),
      tavoloId: s.tavoli[0] ?? "",
      seduti: s.seduti,
      // Da quando aspetta: il primo ordine ancora aperto.
      dal: ordini[0].created_at,
      camerieri: [...camerieri.values()],
      nomi,
      tag,
      articoli: ordini.reduce((n, o) => n + articoliDi(o.items), 0),
      totale_cents: ordini.reduce((n, o) => n + (Number(o.total_cents) || 0), 0),
      mio: Boolean(mioId && ordini.some((o) => o.taken_by_id === mioId)),
      liberare: liberareDi(s.tavoli),
    });
  }
  // Prima chi aspetta la convalida, poi chi aspetta da piu' tempo.
  return out.sort((a, b) =>
    Number(b.tag.includes("valider")) - Number(a.tag.includes("valider")) || a.dal.localeCompare(b.dal));
}
