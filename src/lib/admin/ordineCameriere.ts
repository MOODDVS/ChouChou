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
import { accodaTicket } from "../stampaCoda";
import { contiApertiDellaSala } from "./contiSala";
import { tavoloDellaRiga, tavoliDelleRiga } from "./schedaTavoloRegole";
import { piattiPerOrdine, rigaOrdine } from "./righeOrdine";

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

export async function ordinaDalPalmare(opz: {
  ambito: Ambito;
  tavoloId: string;
  righe: unknown;
  /** Chi ha preso l'ordine: va sul ticket come «chi ha preso cosa». */
  cameriere: string;
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
  };

  // ---- Sul conto aperto: nel suo invio, che parte adesso ----
  if (rigaConto) {
    const conto = await contoPerId(ambito, rigaConto.id, oggi);
    if (!conto) return { ok: false, errore: "libero" };
    await rilasciaInviiScaduti(ambito, conto.id);
    const invioId = await invioPerOrdine(ambito, conto, ora.toJSDate());
    if (!invioId) return { ok: false, errore: "salvataggio" };
    const ins = await inserisci("orders", ambito, {
      ...base,
      payment_method: "tab",
      round_id: invioId,
      reservation_id: conto.id,
      // «Chi ha preso cosa» sul ticket dell'invio: qui, il cameriere.
      customer_name: opz.cameriere || "Serveur",
    }).select("id").single();
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
  const ins = await inserisci("orders", ambito, {
    ...base,
    payment_method: "onsite",
    reservation_id: sessione!.id,
    customer_name: sessione!.nome || opz.cameriere || "Walk-in",
  }).select("id, location_id").single();
  if (ins.error || !ins.data) {
    console.error("[palmare] ordine fallito:", ins.error);
    return { ok: false, errore: "salvataggio" };
  }
  const ordine = ins.data as unknown as { id: string; location_id?: string | null };
  void accodaTicket({ id: ordine.id, status: "pending", payment_method: "onsite", location_id: ordine.location_id ?? null });
  return { ok: true, id: ordine.id, conto: false };
}
