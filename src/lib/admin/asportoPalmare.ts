/**
 * L'ASPORTO DAL PALMARE (Enzo, 28/11/2026) — /admin/salle/asporto.
 *
 * Il cameriere al banco (o al telefono) prende un ordine da portare via:
 *   - nome obbligatorio, telefono facoltativo (per richiamarlo), niente email;
 *   - l'ora di ritiro fra quelle di OGGI (gli stessi orari del sito:
 *     `configRitiro` + `calcolaSlotGiorno`, col tempo di preparazione);
 *   - il pagamento si sceglie: di base «da incassare al ritiro» (`pending` +
 *     `onsite`, come «Payer au comptoir»), oppure incassato subito in
 *     contanti o carta (`paid`).
 * Il ticket esce subito in cucina (o all'apertura, se l'ordine e' preso prima:
 * #101), parte l'email alla cucina come per l'ordine manuale di Commandes, e
 * RestoHub suona da solo (l'ordine entra in `recent_paid`).
 *
 * La pagina mostra TUTTI gli asporti di oggi: quelli del palmare e quelli
 * arrivati dal sito (`asportiDiOggi`).
 *
 * ⚠️ Prezzi, formati e disponibilita' SEMPRE dal database (`righeOrdine.ts`,
 * gli stessi dell'ordine manuale e del palmare in sala).
 */
import { DateTime } from "luxon";
import { leggi, inserisci, type Ambito } from "./sede";
import { fusoDi } from "../fuso";
import { configRitiro } from "../schedule";
import { calcolaSlotGiorno } from "../slots";
import { piattiPerOrdine, rigaOrdine, piattoSenzaCifra } from "./righeOrdine";
import { extraDi } from "./modificaOrdineRegole";
import { accodaTicket } from "../stampaCoda";
import { momentoAnnuncioOrdine, manca101 } from "../annuncioOrdini";
import { inviaNotifiche } from "../notifications";
import { normalizzaNome } from "../normalizzaNome";
import { PAGAMENTI_ASPORTO, statoAsporto, type PagamentoAsporto } from "./asportoRegole";

/** Al massimo cosi' tante righe: un palmare non manda un menu intero. */
const MAX_RIGHE = 60;

/** Gli orari di ritiro ancora possibili OGGI, in ordine. `[]` = per oggi e' finita. */
export async function orariAsportoOggi(ambito: Ambito): Promise<string[]> {
  try {
    const fuso = await fusoDi(ambito);
    const ora = DateTime.now().setZone(fuso);
    const cfg = await configRitiro(ora, ambito);
    if (!cfg) return [];
    const { lunch, dinner } = calcolaSlotGiorno(ora, cfg, fuso);
    return [...new Set([...lunch, ...dinner])].sort();
  } catch {
    return [];
  }
}

export type EsitoAsporto =
  | { ok: true; id: string }
  | { ok: false; errore: "vuoto" | "nome" | "orario" | "piatto" | "formato" | "menu" | "salvataggio" };

export async function creaAsporto(opz: {
  ambito: Ambito;
  righe: unknown;
  nome: unknown;
  telefono: unknown;
  orario: unknown;
  pagamento: unknown;
  /** Chi l'ha preso: il dipendente del Team, o il nome dell'utente (#90). */
  cameriere: string;
  cameriereId?: string | null;
}): Promise<EsitoAsporto> {
  const { ambito } = opz;
  const righe = (Array.isArray(opz.righe) ? opz.righe : []).slice(0, MAX_RIGHE) as {
    id?: unknown; qty?: unknown; variant?: unknown; note?: unknown; extra?: unknown;
  }[];
  if (!righe.length) return { ok: false, errore: "vuoto" };
  const nome = normalizzaNome(opz.nome).slice(0, 60);
  if (nome.length < 1) return { ok: false, errore: "nome" };
  const telefono = String(opz.telefono ?? "").replace(/[^\d+ ]/g, "").trim().slice(0, 30);
  const pagamento: PagamentoAsporto = (PAGAMENTI_ASPORTO as readonly string[]).includes(String(opz.pagamento))
    ? (String(opz.pagamento) as PagamentoAsporto)
    : "onsite";

  // ---- L'ora: una di quelle che il sito offrirebbe adesso, per oggi ----
  const orario = String(opz.orario ?? "");
  const fuso = await fusoDi(ambito);
  const ora = DateTime.now().setZone(fuso);
  const ids = [...new Set(righe.map((r) => String(r.id ?? "")))].filter(Boolean);
  const [orari, { data: piatti, error }] = await Promise.all([orariAsportoOggi(ambito), piattiPerOrdine(ids, ambito)]);
  if (!/^\d{2}:\d{2}$/.test(orario) || !orari.includes(orario)) return { ok: false, errore: "orario" };

  // ---- Le righe, coi prezzi del database ----
  if (error || !piatti) return { ok: false, errore: "menu" };
  const items: Record<string, unknown>[] = [];
  for (const r of righe) {
    const piatto = piatti.find((x) => x.id === String(r.id ?? ""));
    if (!piatto || !piatto.available || piatto.sold_out === true) return { ok: false, errore: "piatto" };
    if (piattoSenzaCifra(piatto, ambito)) return { ok: false, errore: "piatto" };
    const riga = rigaOrdine(piatto, { qty: r.qty, variant: r.variant }, "fr", ambito);
    if (!riga) return { ok: false, errore: "formato" };
    const extra = extraDi(r.extra);
    items.push({
      id: piatto.id,
      ...riga,
      price_cents: riga.price_cents + extra,
      ...(extra ? { extra_cents: extra } : {}),
      notes: String(r.note ?? "").trim().slice(0, 200),
    });
  }
  const totale = items.reduce((t, i) => t + Number(i.price_cents) * Number(i.qty), 0);

  const [h, m] = orario.split(":").map((n) => parseInt(n, 10));
  const ritiro = ora.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  // Preso prima dell'apertura di oggi: ticket e suono all'apertura (#101).
  const annuncio = await momentoAnnuncioOrdine(ambito, ritiro, "pickup");
  const daIncassare = pagamento === "onsite";

  const riga: Record<string, unknown> = {
    status: daIncassare ? "pending" : "paid",
    source: "manual",
    service: "pickup",
    payment_method: pagamento,
    pickup_time: ritiro.toISO(),
    customer_name: nome,
    customer_email: "",
    customer_phone: telefono || null,
    items,
    total_cents: totale,
    lang: "fr",
    taken_by_id: opz.cameriereId ?? null,
    taken_by_name: opz.cameriere || null,
    ...(annuncio ? { announce_at: annuncio } : {}),
  };
  /* Ogni colonna «giovane» si toglie se la sua migrazione manca: un asporto
     perso per una faccina o un'attesa sarebbe il guasto peggiore. */
  let ins = await inserisci("orders", ambito, riga).select("id, location_id").single();
  for (let giro = 0; ins.error && giro < 4; giro++) {
    const msg = String(ins.error.message ?? "");
    if (msg.includes("taken_by")) { delete riga.taken_by_id; delete riga.taken_by_name; }
    else if (annuncio && manca101(ins.error)) delete riga.announce_at;
    else if (msg.includes("service")) delete riga.service;
    else if (msg.includes("payment_method")) delete riga.payment_method;
    else break;
    ins = await inserisci("orders", ambito, riga).select("id, location_id").single();
  }
  if (ins.error || !ins.data) {
    console.error("[palmare] asporto fallito:", ins.error);
    return { ok: false, errore: "salvataggio" };
  }
  const ordine = ins.data as unknown as { id: string; location_id?: string | null };

  /* Il ticket in cucina: lo decide `accodaTicket` (con l'attesa #101 non
     stampa, lo fara' l'apertura). Poi l'email alla cucina, come l'ordine
     manuale di Commandes; al cliente niente: non ha lasciato l'email. */
  void accodaTicket({
    id: ordine.id,
    status: String(riga.status),
    payment_method: pagamento,
    location_id: ordine.location_id ?? null,
  });
  void inviaNotifiche({
    location_id: ordine.location_id ?? null,
    numero: ordine.id.slice(0, 8),
    customer_name: nome,
    customer_email: "",
    customer_phone: telefono || null,
    pickup_time: ritiro.toISO() ?? new Date().toISOString(),
    items: items as unknown as { name: string; qty: number; price_cents: number; notes?: string }[],
    total_cents: totale,
    lang: "fr",
    da_incassare: daIncassare,
  }).catch(() => { /* l'ordine c'e': l'email e' un di piu' */ });
  return { ok: true, id: ordine.id };
}

/** Un asporto di oggi, come lo mostra la pagina del palmare. */
export interface AsportoDiOggi {
  id: string;
  numero: string;
  ora: string;
  nome: string;
  telefono: string;
  totale_cents: number;
  articoli: number;
  righe: { qty: number; nome: string; nota: string }[];
  nota: string;
  stato: ReturnType<typeof statoAsporto>;
  /** Preso dal personale (palmare o Commandes) o dal sito. */
  daSito: boolean;
  cameriere: string;
}

/**
 * TUTTI GLI ASPORTI DI OGGI: del palmare e del sito, per ora di ritiro.
 * Contano gli ordini veri: pagati, chiusi, o da incassare al ritiro. Un
 * `pending` online e' qualcuno fermo su Stripe: non e' (ancora) un ordine.
 * ⚠️ Senza la #82 (`service`) si rilegge senza: lo distingue `table_label`
 * vuota, e se manca anche quella tutti gli ordini di oggi sono asporto.
 */
export async function asportiDiOggi(ambito: Ambito): Promise<AsportoDiOggi[]> {
  try {
    const fuso = await fusoDi(ambito);
    const ora = DateTime.now().setZone(fuso);
    const da = ora.startOf("day").toUTC().toISO() as string;
    const a = ora.endOf("day").toUTC().toISO() as string;
    const BASE = "id, customer_name, customer_phone, pickup_time, status, payment_method, total_cents, items, source";
    const leggiCon = (campi: string) => leggi("orders", ambito, campi)
      .gte("pickup_time", da).lte("pickup_time", a)
      .in("status", ["paid", "done", "pending"])
      .order("pickup_time", { ascending: true })
      .limit(300);
    let r = await leggiCon(`${BASE}, service, ready_at, taken_by_name`);
    if (r.error) r = await leggiCon(`${BASE}, service`);
    if (r.error) r = await leggiCon(BASE);
    if (r.error) return [];
    const righe = (r.data ?? []) as unknown as {
      id: string; customer_name: string | null; customer_phone: string | null; pickup_time: string;
      status: string; payment_method: string | null; total_cents: number | null;
      items: { name?: string; qty?: number; notes?: string }[] | null; source: string | null;
      service?: string | null; ready_at?: string | null; taken_by_name?: string | null;
    }[];
    return righe
      .filter((o) => (o.service ?? "pickup") === "pickup")
      .filter((o) => o.status !== "pending" || o.payment_method === "onsite")
      .map((o) => {
        const voci = (o.items ?? []).filter((i) => Number(i.qty) > 0);
        const nota = (o.items ?? []).find((i) => Number(i.qty) === 0 && i.notes)?.notes ?? "";
        return {
          id: o.id,
          numero: o.id.slice(0, 4).toUpperCase(),
          ora: DateTime.fromISO(o.pickup_time).setZone(fuso).toFormat("HH:mm"),
          nome: String(o.customer_name ?? "").trim(),
          telefono: String(o.customer_phone ?? "").trim(),
          totale_cents: Number(o.total_cents) || 0,
          articoli: voci.reduce((n, i) => n + (Number(i.qty) || 0), 0),
          righe: voci.map((i) => ({ qty: Number(i.qty) || 0, nome: String(i.name ?? ""), nota: String(i.notes ?? "").trim() })),
          nota: String(nota).trim(),
          stato: statoAsporto(o),
          daSito: o.source !== "manual",
          cameriere: String(o.taken_by_name ?? "").trim(),
        };
      });
  } catch (e) {
    console.error("[palmare] asporti di oggi:", e);
    return [];
  }
}
