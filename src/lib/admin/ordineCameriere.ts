/**
 * L'ORDINE DEL CAMERIERE DAL PALMARE (23/10/2026, vedi `claude/palmare.md`).
 *
 * Il cameriere sceglie i piatti per un tavolo OCCUPATO e tocca «Envoyer en
 * cuisine». Due casi, gli stessi del QR:
 *
 *  - il tavolo ha un CONTO APERTO → l'ordine va sul conto (`payment_method:
 *    tab`, nel suo invio) e l'invio PARTE SUBITO: il cameriere ha deciso
 *    adesso, e la finestra di raggruppamento serve ai telefoni dei clienti,
 *    non a lui. Se nell'invio c'erano gia' piatti di un cliente, partono
 *    insieme: e' lo stesso tavolo, la stessa uscita.
 *    ⚠️ Un conto DA VALIDARE no: prima si valida (`valida_prima`). Ordinare
 *    sopra un conto che il personale non ha ancora accettato vorrebbe dire
 *    accettarlo senza averlo guardato.
 *  - il tavolo e' SEDUTO senza conto (installato dal palmare, o una sessione
 *    del QR che paga a ogni giro) → un ordine da incassare (`pending` +
 *    `onsite`), e il ticket esce SUBITO in cucina (`accodaTicket`), come
 *    l'ordine «da pagare al banco».
 *
 * Il tavolo libero no: prima si installano i clienti (`libero`).
 *
 * ⚠️ Prezzi e formati SEMPRE dal database (`righeOrdine.ts`, gli stessi
 * dell'ordine manuale di Commandes): dal palmare arrivano solo id, quantita',
 * formato e nota.
 */
import { DateTime } from "luxon";
import { leggi, inserisci, aggiorna, type Ambito } from "./sede";
import { fusoDi } from "../fuso";
import { contoPerId, invioPerOrdine, rilasciaInviiScaduti } from "../contoServer";
import { accodaTicket, stampaAnnullo } from "../stampaCoda";
import { contiApertiDellaSala } from "./contiSala";
import { tavoloDellaRiga, tavoliDelleRiga } from "./schedaTavoloRegole";
import { piattiPerOrdine, rigaOrdine } from "./righeOrdine";
import { applicaTogli, dividiModifica, ordineModificabile, righeModificabili, type VoceItems } from "./modificaOrdineRegole";
import { letturaSala } from "./letturaSala";

export interface RigaRichiesta {
  id?: unknown;
  qty?: unknown;
  variant?: unknown;
  note?: unknown;
}

export type EsitoOrdine =
  | { ok: true; id: string; conto: boolean }
  | { ok: false; errore: "vuoto" | "libero" | "valida_prima" | "piatto" | "formato" | "menu" | "salvataggio" };

/** Al massimo cosi' tante righe per invio: un palmare non manda un menu intero. */
const MAX_RIGHE = 60;

/**
 * Scrive l'ordine con CHI L'HA PRESO (#90: `taken_by_id`, `taken_by_name`).
 * ⚠️ Senza la #90 le due colonne non esistono: si riscrive senza, e l'ordine
 * parte lo stesso. Un ordine perso perche' manca il nome del cameriere
 * sarebbe il guasto peggiore possibile per una cosa che e' solo una faccina.
 */
async function inserisciOrdine(ambito: Ambito, riga: Record<string, unknown>, campi: string) {
  let ins = await inserisci("orders", ambito, riga).select(campi).single();
  if (ins.error && String(ins.error.message ?? "").includes("taken_by")) {
    const { taken_by_id: _a, taken_by_name: _b, ...senza } = riga;
    ins = await inserisci("orders", ambito, senza).select(campi).single();
  }
  return ins;
}

export async function ordinaDalPalmare(opz: {
  ambito: Ambito;
  tavoloId: string;
  righe: unknown;
  /** Chi ha preso l'ordine: va sul ticket come «chi ha preso cosa». */
  cameriere: string;
  /** La persona del Team (per la sua faccina sulla scheda), se c'e'. */
  cameriereId?: string | null;
}): Promise<EsitoOrdine> {
  const { ambito, tavoloId } = opz;
  const righe = (Array.isArray(opz.righe) ? opz.righe : []).slice(0, MAX_RIGHE) as RigaRichiesta[];
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId) || righe.length === 0) return { ok: false, errore: "vuoto" };

  const fuso = await fusoDi(ambito);
  const ora = DateTime.now().setZone(fuso);
  const oggi = ora.toFormat("yyyy-MM-dd");

  /* ⚠️ VELOCITA' (23/10/2026): conti, sessione, piatti e nomi dei tavoli si
     leggono INSIEME — erano quattro letture in fila prima di scrivere. */
  const ids = [...new Set(righe.map((r) => String(r.id ?? "")))].filter(Boolean);
  const [conti, { data: sedutiRaw }, { data: piatti, error }, { data: tuttiRaw }] = await Promise.all([
    contiApertiDellaSala(ambito),
    leggi("reservations", ambito, "id, first_name, last_name, tables, seated_at")
      .eq("date", oggi)
      .eq("status", "seated"),
    piattiPerOrdine(ids, ambito),
    leggi("restaurant_tables", ambito, "id, name"),
  ]);

  // ---- Chi c'e' seduto: il conto aperto, o la sessione di oggi ----
  const rigaConto = conti.find((c) => c.date === oggi && c.status === "seated" && tavoloDellaRiga(c, tavoloId)) ?? null;
  if (rigaConto && rigaConto.tab_status === "pending") return { ok: false, errore: "valida_prima" };

  let sessione: { id: string; nome: string; tavoli: string[] } | null = null;
  if (!rigaConto) {
    const seduta = ((sedutiRaw ?? []) as unknown as { id: string; first_name: string; last_name: string; tables: unknown; seated_at: string | null }[])
      .filter((r) => tavoloDellaRiga(r, tavoloId))
      .sort((a, b) => String(b.seated_at ?? "").localeCompare(String(a.seated_at ?? "")))[0];
    if (!seduta) return { ok: false, errore: "libero" };
    sessione = {
      id: seduta.id,
      nome: [seduta.first_name, seduta.last_name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" "),
      tavoli: tavoliDelleRiga(seduta.tables),
    };
  }

  // ---- Le righe, coi prezzi del database ----
  if (error || !piatti) return { ok: false, errore: "menu" };
  const items: Record<string, unknown>[] = [];
  for (const r of righe) {
    const piatto = piatti.find((x) => x.id === String(r.id ?? ""));
    if (!piatto || !piatto.available || piatto.sold_out === true) return { ok: false, errore: "piatto" };
    const riga = rigaOrdine(piatto, { qty: r.qty, variant: r.variant }, "fr", ambito);
    if (!riga) return { ok: false, errore: "formato" };
    items.push({
      id: piatto.id,
      ...riga,
      // La nota del cameriere va in cucina con il piatto («sans oignon»).
      notes: String(r.note ?? "").trim().slice(0, 200),
    });
  }
  const totale = items.reduce((t, i) => t + Number(i.price_cents) * Number(i.qty), 0);

  // Il cartellino del ticket: tutti i tavoli della tavolata («T1 + T2»).
  const idsTavoli = rigaConto
    ? [rigaConto.tab_table_id, ...(rigaConto.tables ?? [])].filter((x): x is string => Boolean(x))
    : (sessione?.tavoli ?? []);
  const voluti = new Set([tavoloId, ...idsTavoli]);
  const nomi = ((tuttiRaw ?? []) as unknown as { id: string; name: string }[])
    .filter((t) => voluti.has(String(t.id)))
    .map((t) => String(t.name ?? ""))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const etichetta = nomi.join(" + ");

  const base: Record<string, unknown> = {
    status: "pending",
    pickup_time: ora.toISO(),
    service: "table",
    table_id: tavoloId,
    table_label: etichetta,
    customer_email: "",
    customer_phone: "",
    items,
    total_cents: totale,
    lang: "fr",
    // Chi l'ha preso (#90): la faccina sulla scheda del tavolo.
    taken_by_id: opz.cameriereId ?? null,
    taken_by_name: opz.cameriere || null,
  };

  // ---- Sul conto aperto: nel suo invio, che parte adesso ----
  if (rigaConto) {
    const conto = await contoPerId(ambito, rigaConto.id, oggi);
    if (!conto) return { ok: false, errore: "libero" };
    await rilasciaInviiScaduti(ambito, conto.id);
    const invioId = await invioPerOrdine(ambito, conto, ora.toJSDate());
    if (!invioId) return { ok: false, errore: "salvataggio" };
    const ins = await inserisciOrdine(ambito, {
      ...base,
      payment_method: "tab",
      round_id: invioId,
      reservation_id: conto.id,
      // «Chi ha preso cosa» sul ticket dell'invio: qui, il cameriere.
      customer_name: opz.cameriere || "Serveur",
    }, "id");
    if (ins.error || !ins.data) {
      console.error("[palmare] ordine sul conto fallito:", ins.error);
      return { ok: false, errore: "salvataggio" };
    }
    await aggiorna("table_rounds", ambito, { release_at: ora.toUTC().toISO() })
      .eq("id", invioId)
      .eq("status", "waiting");
    await rilasciaInviiScaduti(ambito, conto.id);
    return { ok: true, id: String((ins.data as { id?: unknown }).id ?? ""), conto: true };
  }

  // ---- Seduti senza conto: da incassare, e il ticket esce subito ----
  const ins = await inserisciOrdine(ambito, {
    ...base,
    payment_method: "onsite",
    reservation_id: sessione!.id,
    customer_name: sessione!.nome || opz.cameriere || "Walk-in",
  }, "id, location_id");
  if (ins.error || !ins.data) {
    console.error("[palmare] ordine fallito:", ins.error);
    return { ok: false, errore: "salvataggio" };
  }
  const ordine = ins.data as unknown as { id: string; location_id?: string | null };
  void accodaTicket({ id: ordine.id, status: "pending", payment_method: "onsite", location_id: ordine.location_id ?? null });
  return { ok: true, id: ordine.id, conto: false };
}

export type EsitoTogli =
  | { ok: true; annullato: boolean }
  | { ok: false; errore: "nessuno" | "bloccato" | "righe" | "salvataggio" };

/**
 * TOGLIERE DA UN ORDINE GIA' FATTO (23/10/2026) — le regole in
 * `modificaOrdineRegole.ts`: solo meno, solo un ordine da incassare, tutto a
 * zero = annullato. Aggiungere e' un ordine nuovo («Commander»).
 *
 * ⚠️ Si ricontrolla tutto qui: l'ordine deve essere della sessione seduta a
 * QUESTO tavolo oggi, e ancora da incassare — fra la pagina e il tocco
 * qualcuno puo' averlo incassato in Commandes. L'aggiornamento stesso
 * richiede `status = pending`: un incasso arrivato nello stesso istante vince.
 */
export async function togliDaOrdine(
  ambito: Ambito,
  tavoloId: string,
  ordineId: string,
  nuove: unknown,
  /** Chi toglie: va sul ticket d'annullo della cucina. */
  chi = "",
): Promise<EsitoTogli> {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId) || !/^[0-9a-f-]{36}$/i.test(ordineId)) return { ok: false, errore: "nessuno" };
  const ora = DateTime.now().setZone(await fusoDi(ambito));
  const { data: oRaw } = await leggi("orders", ambito, "id, status, payment_method, items, reservation_id, table_label")
    .eq("id", ordineId).maybeSingle();
  const o = oRaw as unknown as { id: string; status: string; payment_method: string | null; items: VoceItems[] | null; reservation_id: string | null; table_label: string | null } | null;
  if (!o || !o.reservation_id) return { ok: false, errore: "nessuno" };
  if (!ordineModificabile(o)) return { ok: false, errore: "bloccato" };
  const { data: rRaw } = await leggi("reservations", ambito, "id, date, status, tables, tab_table_id")
    .eq("id", o.reservation_id).maybeSingle();
  const r = rRaw as unknown as { id: string; date: string; status: string; tables: unknown; tab_table_id: string | null } | null;
  if (!r || r.status !== "seated" || r.date !== ora.toFormat("yyyy-MM-dd") || !tavoloDellaRiga(r, tavoloId)) {
    return { ok: false, errore: "nessuno" };
  }
  const esito = applicaTogli(o.items, nuove);
  if (!esito) return { ok: false, errore: "righe" };
  if (!esito.cambiato) return { ok: true, annullato: false };
  const campi: Record<string, unknown> = esito.vuoto
    ? { status: "cancelled" }
    : { items: esito.items, total_cents: esito.totale };
  const upd = await aggiorna("orders", ambito, campi).eq("id", o.id).eq("status", "pending").select("id");
  if (upd.error) {
    console.error("[palmare] modifica ordine fallita:", upd.error);
    return { ok: false, errore: "salvataggio" };
  }
  if (!(upd.data ?? []).length) return { ok: false, errore: "bloccato" };
  /* Il TICKET D'ANNULLO (25/10/2026): se la comanda e' gia' uscita, la
     cucina riceve i piatti tolti su carta (`stampaAnnullo` decide se serve). */
  void stampaAnnullo(ambito, o.id, esito.tolte, { tavolo: String(o.table_label ?? ""), chi });
  return { ok: true, annullato: esito.vuoto };
}

/**
 * ANNULLARE UN ORDINE dal palmare (il cestino della card, 25/10/2026): tutte
 * le righe a zero, cioe' `togliDaOrdine` — stesse regole (solo da incassare,
 * solo sul tavolo seduto di oggi) e stesso ticket d'annullo.
 */
export async function annullaOrdine(ambito: Ambito, tavoloId: string, ordineId: string, chi = ""): Promise<EsitoTogli> {
  if (!/^[0-9a-f-]{36}$/i.test(ordineId)) return { ok: false, errore: "nessuno" };
  const { data: oRaw } = await leggi("orders", ambito, "items").eq("id", ordineId).maybeSingle();
  const o = oRaw as unknown as { items: VoceItems[] | null } | null;
  if (!o) return { ok: false, errore: "nessuno" };
  const zero = Object.fromEntries(righeModificabili(o.items).map((r) => [r.i, 0]));
  return togliDaOrdine(ambito, tavoloId, ordineId, zero, chi);
}

export type EsitoLibera =
  | { ok: true; annullati: number }
  | { ok: false; errore: "nessuno" | "conto" | "salvataggio" };

/**
 * «LIBÉRER LA TABLE» dal modale dell'isola (25/10/2026): se ne vanno (o
 * cambiano tutto). Ogni ordine ancora da incassare si annulla — con il suo
 * ticket d'annullo se la comanda e' uscita — e la seduta si chiude:
 *  - nessun ordine rimasto → `cancelled`, come «Annuler» senza ordini;
 *  - restano ordini gia' pagati (QR online, gia' incassati) → `done`: hanno
 *    mangiato e pagato, il tavolo si libera e la storia resta.
 * ⚠️ Non per il conto aperto del QR: li' gli ordini sono dei clienti, divisi
 * per invio, a volte pagati in parte. Si chiude da Commandes.
 */
export async function liberaTavolo(ambito: Ambito, tavoloId: string, chi = ""): Promise<EsitoLibera> {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId)) return { ok: false, errore: "nessuno" };
  const l = await letturaSala(ambito);
  const seduta = l.righe
    .filter((r) => r.status === "seated" && tavoloDellaRiga(r, tavoloId))
    .sort((a, b) => String(b.seated_at ?? "").localeCompare(String(a.seated_at ?? "")))[0];
  if (!seduta) return { ok: false, errore: "nessuno" };
  if (seduta.tab_status === "pending" || seduta.tab_status === "open") return { ok: false, errore: "conto" };
  const { data: oRaw } = await leggi("orders", ambito, "id, status, payment_method")
    .eq("reservation_id", seduta.id)
    .neq("status", "cancelled");
  const ordini = (oRaw ?? []) as unknown as { id: string; status: string; payment_method: string | null }[];
  let annullati = 0;
  for (const o of ordini.filter(ordineModificabile)) {
    const a = await annullaOrdine(ambito, tavoloId, o.id, chi);
    if (!a.ok) return { ok: false, errore: "salvataggio" };
    annullati++;
  }
  const restano = ordini.length - annullati;
  const upd = await aggiorna("reservations", ambito, { status: restano > 0 ? "done" : "cancelled" })
    .eq("id", seduta.id)
    .eq("status", "seated");
  return upd.error ? { ok: false, errore: "salvataggio" } : { ok: true, annullati };
}

/**
 * MODIFICARE UN ORDINE dalla matita (23/10/2026): le quantita' nuove di ogni
 * riga. Cio' che scende si toglie dall'ordine (`togliDaOrdine`); cio' che
 * sale oltre la partenza parte come ORDINE NUOVO (`ordinaDalPalmare`), cosi'
 * la cucina riceve il ticket solo dei piatti in piu'.
 *
 * ⚠️ Prima le aggiunte: se non partono (piatto esaurito nel frattempo), non
 * si tocca niente e il cameriere lo vede. Poi le riduzioni.
 */
export async function modificaOrdine(opz: {
  ambito: Ambito;
  tavoloId: string;
  ordineId: string;
  nuove: unknown;
  cameriere: string;
  cameriereId?: string | null;
}): Promise<EsitoTogli | { ok: false; errore: "aggiunta"; dettaglio: EsitoOrdine }> {
  const { ambito, tavoloId, ordineId } = opz;
  if (!/^[0-9a-f-]{36}$/i.test(ordineId)) return { ok: false, errore: "nessuno" };
  const { data: oRaw } = await leggi("orders", ambito, "id, status, payment_method, items").eq("id", ordineId).maybeSingle();
  const o = oRaw as unknown as { status: string; payment_method: string | null; items: VoceItems[] | null } | null;
  if (!o) return { ok: false, errore: "nessuno" };
  if (!ordineModificabile(o)) return { ok: false, errore: "bloccato" };
  const d = dividiModifica(o.items, opz.nuove);
  if (!d) return { ok: false, errore: "righe" };
  if (d.aggiungi.length) {
    const nuovo = await ordinaDalPalmare({ ambito, tavoloId, righe: d.aggiungi, cameriere: opz.cameriere, cameriereId: opz.cameriereId });
    if (!nuovo.ok) return { ok: false, errore: "aggiunta", dettaglio: nuovo };
  }
  return togliDaOrdine(ambito, tavoloId, ordineId, d.togli, opz.cameriere);
}
