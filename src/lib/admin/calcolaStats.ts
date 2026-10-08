import { DateTime } from "luxon";
import { ripartisciOrdini, conNomi } from "./statsRegole";
import { leggi, elencoSedi, type Ambito } from "./sede";
import { supabaseAdmin } from "../db";
import { fusoDi } from "../fuso";
import { adminLang } from "./adminLang";
import { adminT, ADMIN_LOCALE } from "../../i18n/admin";
import { entrato, rimborsato, piattiVeri } from "./ordiniConti";

// Calcolo delle statistiche: UNA sola implementazione.
//
// La usano il render lato server della pagina /admin/stats (SSR, Fase 2) e
// GET /api/admin/stats, che da qui prende il risultato e lo impacchetta in
// JSON. Fino al 12/09/2026 erano DUE copie identiche di 180 righe, con in
// cima il commento «se cambi il calcolo lì, aggiornalo anche qui»: la stessa
// promessa che, sull'anteprima PDF, non era stata mantenuta e aveva lasciato
// una delle due rotta per settimane. Una funzione sola, nessuna promessa da
// mantenere.

export type Periodo = "day" | "week" | "month" | "ytd" | "all";

interface RigaOrdine {
  pickup_time: string;
  total_cents: number;
  /* ⚠️ I DUE CAMPI DEI SOLDI CHE MANCAVANO. Il fatturato sommava
     `total_cents`: un ordine rimborsato restava nel giro d'affari per sempre
     (e la pagina Commandes, intanto, mostrava «↩ Remboursé» su quella stessa
     card), e una modifica al rialzo non ancora pagata ci entrava come se il
     cliente avesse saldato. Sono facoltativi perche' una base dati che non ha
     ancora le migrazioni #41/#50 non li manda: senza, si torna al conto di
     prima invece di spegnere la pagina. */
  refunded_cents?: number | null;
  supplement_due_cents?: number | null;
  items: { id: string; name: string; qty: number; price_cents: number }[];
}

interface Bucket {
  label: string;
  count: number;
  /* ⚠️ I SOLDI, oltre al numero di ordini. Il grafico delle statistiche
     conta le righe, e va benissimo per «quando si lavora»; la colonna delle
     recettes chiede un'altra domanda — «quando ENTRANO i soldi» — e le due
     non si somigliano: una sera da tre ordini grossi e una da sette piccoli
     fanno due barre opposte a seconda di cosa si conta. Stesso giro di
     lettura, due campi in piu', nessun secondo conto. */
  cents: number;
  refund_cents: number;
}

/** Un intervallo vuoto. ⚠️ Una funzione e non un oggetto condiviso: scritto
 *  una volta e riusato, tutti gli intervalli sarebbero LO STESSO oggetto. */
const vuoto = (): Omit<Bucket, "label"> => ({ count: 0, cents: 0, refund_cents: 0 });

/** Mette un ordine nel suo intervallo: il numero, l'incasso e il reso in un
 *  colpo solo. ⚠️ Il conto dei soldi sta QUI e in nessuno dei cinque rami di
 *  `serieDi`: erano cinque `conta[i]++` identici, e cinque posti in cui
 *  scordarsi i soldi. */
function metti(dentro: Omit<Bucket, "label">[], i: number, o: RigaOrdine): void {
  const b = dentro[i];
  if (!b) return;
  b.count++;
  b.cents += entrato(o);
  b.refund_cents += rimborsato(o);
}

function inizioPeriodo(p: Periodo, fuso: string): string | null {
  const ora = DateTime.now().setZone(fuso);
  switch (p) {
    case "day": return ora.startOf("day").toISO();
    case "week": return ora.startOf("week").toISO(); // lunedì
    case "month": return ora.startOf("month").toISO();
    case "ytd": return ora.startOf("year").toISO();
    case "all": return null;
  }
}

async function ordiniPagati(daISO: string | null, ambito: Ambito, aISO?: string | null): Promise<RigaOrdine[] | null> {
  const PAGINA = 1000;
  const tutti: RigaOrdine[] = [];
  // `location_id` si chiede SOLO nell'aggregato: e' l'unico caso in cui serve,
  // ed e' anche l'unico in cui la colonna esiste di sicuro (l'aggregato si
  // ottiene solo a multi-sede acceso, che presuppone la migrazione #73).
  const SOLDI = "pickup_time, total_cents, refunded_cents, supplement_due_cents, items";
  const BASE = "pickup_time, total_cents, items";
  const sede = ambito.modo === "tutte" ? ", location_id" : "";
  // ⚠️ Se le migrazioni dei rimborsi non sono passate, il `select` fallisce in
  // blocco e la pagina resterebbe bianca: si riprova una volta coi campi di
  // prima. Meglio un fatturato senza rimborsi che nessun fatturato — e la
  // differenza si vede, mentre una pagina vuota si chiude e basta.
  let campi = SOLDI + sede;
  for (let da = 0; ; da += PAGINA) {
    const chiedi = () => {
      let q = leggi("orders", ambito, campi)
        .in("status", ["paid", "done"])
        .order("pickup_time", { ascending: true })
        .range(da, da + PAGINA - 1);
      if (daISO) q = q.gte("pickup_time", daISO);
      // Il limite alto serve solo al periodo PRECEDENTE: questo periodo
      // arriva fino a ora, e un `lt` su «adesso» escluderebbe gli ordini di
      // stasera gia' pagati — che sono incasso di oggi.
      if (aISO) q = q.lt("pickup_time", aISO);
      return q;
    };
    let { data, error } = await chiedi();
    if (error && campi !== BASE + sede) {
      campi = BASE + sede;
      ({ data, error } = await chiedi());
    }
    if (error) return null;
    tutti.push(...((data ?? []) as RigaOrdine[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

/**
 * IL PERIODO PRECEDENTE, per dire se si sta salendo o scendendo.
 *
 * ⚠️ NON il periodo precedente INTERO: la stessa fetta di tempo gia'
 * passata. Alle tre del pomeriggio «oggi» sono quindici ore e «ieri»
 * ventiquattro: confrontarli dice ogni santo giorno che si sta crollando, fino
 * a sera. E' lo stesso difetto della percentuale su una finestra parziale che
 * abbiamo gia' chiuso una volta — qui si taglia il periodo di prima alla
 * stessa durata, dal suo inizio.
 *
 * `all` non ha un «prima»: niente confronto, e chi disegna non scrive niente
 * (una freccia messa per ripiego e' una buona notizia inventata).
 */
const UNITA = { day: "days", week: "weeks", month: "months", ytd: "years" } as const;
function finestraPrecedente(p: Periodo, fuso: string): { da: string; a: string } | null {
  const iso = inizioPeriodo(p, fuso);
  if (p === "all" || !iso) return null;
  const ora = DateTime.now().setZone(fuso);
  const inizio = DateTime.fromISO(iso, { zone: fuso });
  const da = inizio.minus({ [UNITA[p]]: 1 });
  // ⚠️ Mai oltre l'inizio di questo periodo: un mese di 31 giorni confrontato
  // con febbraio sborderebbe nei giorni di questo mese, cioe' si conterebbero
  // due volte.
  const a = DateTime.min(da.plus(ora.diff(inizio)), inizio);
  return { da: da.toISO() as string, a: a.toISO() as string };
}

async function fasciaApertura(): Promise<{ minH: number; maxH: number }> {
  const { data } = await supabaseAdmin
    .from("settings")
    .select("lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close");
  let minH = 24;
  let maxH = 0;
  const oraDi = (t: string) => parseInt(t.slice(0, 2), 10);
  const ceilDi = (t: string) => oraDi(t) + (parseInt(t.slice(3, 5), 10) > 0 ? 1 : 0);
  for (const r of data ?? []) {
    if (r.lunch_active && r.lunch_open && r.lunch_close) {
      minH = Math.min(minH, oraDi(r.lunch_open));
      maxH = Math.max(maxH, ceilDi(r.lunch_close));
    }
    if (r.dinner_active && r.dinner_open && r.dinner_close) {
      minH = Math.min(minH, oraDi(r.dinner_open));
      maxH = Math.max(maxH, ceilDi(r.dinner_close));
    }
  }
  if (minH >= maxH) return { minH: 11, maxH: 24 }; // fallback
  return { minH, maxH };
}

/**
 * Etichette dell'asse nella lingua dell'admin.
 *
 * ⚠️ Prima erano due array FRANCESI scritti a mano (`GIORNI_FR`, `MESI_FR`):
 * un ristoratore italiano vedeva «Jeu, Ven, Sam, Dim» sul grafico della Home
 * e della pagina Statistiche, in mezzo a un'interfaccia tutta in italiano.
 * Ora le da' Intl, dalla lingua globale dell'admin.
 *
 * Intl scrive «lun.» / «gen.»: si toglie il punto e si alza l'iniziale, per
 * restare identici a com'erano disegnate le etichette.
 */
function ripulisci(v: string): string {
  const t = v.replace(/\.$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function nomiGiorni(loc: string): string[] {
  // 1 gennaio 2024 e' un lunedi: sette giorni di fila partendo da li'.
  const f = new Intl.DateTimeFormat(loc, { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => ripulisci(f.format(Date.UTC(2024, 0, 1 + i))));
}
function nomiMesi(loc: string): string[] {
  const f = new Intl.DateTimeFormat(loc, { month: "short", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, m) => ripulisci(f.format(Date.UTC(2024, m, 1))));
}

async function serieDi(
  p: Periodo,
  ordini: RigaOrdine[],
  loc: string,
  trim: string,
  fuso: string
): Promise<{ kind: string; series: Bucket[] }> {
  const ora = DateTime.now().setZone(fuso);
  const dt = (o: RigaOrdine) => DateTime.fromISO(o.pickup_time).setZone(fuso);

  if (p === "day") {
    const { minH, maxH } = await fasciaApertura();
    const conta = Array.from({ length: 24 }, vuoto);
    for (const o of ordini) metti(conta, dt(o).hour, o);
    const series: Bucket[] = [];
    for (let h = minH; h < maxH; h++) series.push({ label: `${h}h`, ...conta[h] });
    return { kind: "hour", series };
  }

  if (p === "week") {
    const conta = Array.from({ length: 7 }, vuoto);
    for (const o of ordini) metti(conta, dt(o).weekday - 1, o); // luxon: 1=lun
    return { kind: "weekday", series: nomiGiorni(loc).map((g, i) => ({ label: g, ...conta[i] })) };
  }

  if (p === "month") {
    const giorni = ora.daysInMonth ?? 31;
    const conta = Array.from({ length: giorni + 1 }, vuoto);
    for (const o of ordini) metti(conta, dt(o).day, o);
    const series: Bucket[] = [];
    for (let d = 1; d <= giorni; d++) series.push({ label: String(d), ...conta[d] });
    return { kind: "day", series };
  }

  if (p === "ytd") {
    const conta = Array.from({ length: 13 }, vuoto);
    for (const o of ordini) metti(conta, dt(o).month, o);
    const series: Bucket[] = [];
    const mesi = nomiMesi(loc);
    for (let m = 1; m <= ora.month; m++) series.push({ label: mesi[m - 1], ...conta[m] });
    return { kind: "month", series };
  }

  // all: trimestri dal primo ordine a oggi
  if (ordini.length === 0) return { kind: "quarter", series: [] };
  const primo = dt(ordini[0]);
  const conta = new Map<string, Omit<Bucket, "label">>();
  for (const o of ordini) {
    const d = dt(o);
    const k = `${d.year}-${d.quarter}`;
    if (!conta.has(k)) conta.set(k, vuoto());
    metti([conta.get(k) as Omit<Bucket, "label">], 0, o);
  }
  const series: Bucket[] = [];
  let cur = primo.startOf("quarter");
  const fine = ora.endOf("quarter");
  while (cur <= fine) {
    series.push({
      label: `${trim}${cur.quarter} ${String(cur.year).slice(2)}`,
      ...(conta.get(`${cur.year}-${cur.quarter}`) ?? vuoto()),
    });
    cur = cur.plus({ quarters: 1 });
  }
  return { kind: "quarter", series };
}

/** Incasso e ordini per punto: la regola sta in `statsRegole.ts`, pura e
 *  provata. Qui resta solo il nome del punto, che va letto. */
async function ripartisciPerSede(ordini: RigaOrdine[]) {
  const nomi = new Map((await elencoSedi()).map((x) => [x.id, x.name]));
  return conNomi(ripartisciOrdini(ordini as { total_cents: number; location_id?: string | null }[]), nomi);
}

export async function calcolaStats(p: Periodo, ambito: Ambito) {
  // ⚠️ Letto UNA volta e passato giu'. Prima ogni funzione qui dentro leggeva
  // la stessa variabile globale: sembrava gratis, e infatti lo era — il
  // prezzo era che nessuna di queste funzioni si poteva provare con un fuso
  // diverso, e che due sedi non potevano averne due.
  const fuso = await fusoDi(ambito);
  const ordini = await ordiniPagati(inizioPeriodo(p, fuso), ambito);
  if (ordini === null) return null;

  let revenue = 0;
  // ⚠️ I RESI, contati e non solo sottratti: `entrato()` li toglie e li
  // dimentica, e mille euro con trecento di rimborsi si leggevano come
  // settecento puliti. Sono due serate diverse.
  let resi = 0;
  let ordiniResi = 0;
  const perOra = new Array(24).fill(0) as number[];
  const piatti = new Map<string, { qty: number; cents: number }>();

  for (const o of ordini) {
    const reso = rimborsato(o);
    resi += reso;
    if (reso > 0) ordiniResi++;
    // ⚠️ `entrato` e non `total_cents`: i soldi usciti per un rimborso non
    // sono fatturato, e un supplemento mai pagato non e' ancora entrato. La
    // regola sta in `ordiniConti.ts`, con quella della colonna e della pagina.
    revenue += entrato(o);
    const h = DateTime.fromISO(o.pickup_time).setZone(fuso).hour;
    if (h >= 0 && h < 24) perOra[h]++;
    for (const it of piattiVeri(o.items)) {
      const cur = piatti.get(it.name) ?? { qty: 0, cents: 0 };
      cur.qty += it.qty;
      cur.cents += it.price_cents * it.qty;
      piatti.set(it.name, cur);
    }
  }

  let peakHour: number | null = null;
  let peakCount = 0;
  perOra.forEach((n, h) => {
    if (n > peakCount) { peakCount = n; peakHour = h; }
  });

  const top = [...piatti.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, cents: v.cents }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const lang = await adminLang();
  const { kind, series } = await serieDi(p, ordini, ADMIN_LOCALE[lang] ?? "fr-BE", adminT(lang)("stats.quarterShort"), fuso);

  // Il periodo di prima: una lettura in piu', solo per sapere se si sale o si
  // scende. `null` quando non c'e' un prima (`all`) o quando la lettura
  // fallisce: meglio nessun confronto che un confronto con zero, che si
  // leggerebbe come «raddoppiato».
  const finestra = finestraPrecedente(p, fuso);
  const prima = finestra ? await ordiniPagati(finestra.da, ambito, finestra.a) : null;

  return {
    ...(ambito.modo === "tutte" ? { perSede: await ripartisciPerSede(ordini) } : {}),
    period: p,
    orders: ordini.length,
    revenue_cents: revenue,
    refunded_cents: resi,
    refunded_orders: ordiniResi,
    prev: prima
      ? {
          orders: prima.length,
          revenue_cents: prima.reduce((t, o) => t + entrato(o), 0),
          refunded_cents: prima.reduce((t, o) => t + rimborsato(o), 0),
        }
      : null,
    avg_cents: ordini.length ? Math.round(revenue / ordini.length) : 0,
    peak_hour: peakHour,
    peak_count: peakCount,
    series_kind: kind,
    series,
    top,
  };
}
