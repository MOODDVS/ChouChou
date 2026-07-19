import { DateTime } from "luxon";
import { supabaseAdmin } from "../db";
import { TIMEZONE } from "../slots";

// Calcolo delle statistiche per il render lato server (SSR, Fase 2) della
// pagina /admin/stats.
//
// ⚠️ Copia FEDELE della logica di GET /api/admin/stats. Se cambi il calcolo
//    lì, aggiornalo anche qui (e viceversa). L'endpoint resta la fonte usata
//    dal cambio-periodo lato client.

export type Periodo = "day" | "week" | "month" | "ytd" | "all";

interface RigaOrdine {
  pickup_time: string;
  total_cents: number;
  items: { id: string; name: string; qty: number; price_cents: number }[];
}

interface Bucket {
  label: string;
  count: number;
}

function inizioPeriodo(p: Periodo): string | null {
  const ora = DateTime.now().setZone(TIMEZONE);
  switch (p) {
    case "day": return ora.startOf("day").toISO();
    case "week": return ora.startOf("week").toISO(); // lunedì
    case "month": return ora.startOf("month").toISO();
    case "ytd": return ora.startOf("year").toISO();
    case "all": return null;
  }
}

async function ordiniPagati(daISO: string | null): Promise<RigaOrdine[] | null> {
  const PAGINA = 1000;
  const tutti: RigaOrdine[] = [];
  for (let da = 0; ; da += PAGINA) {
    let q = supabaseAdmin
      .from("orders")
      .select("pickup_time, total_cents, items")
      .in("status", ["paid", "done"])
      .order("pickup_time", { ascending: true })
      .range(da, da + PAGINA - 1);
    if (daISO) q = q.gte("pickup_time", daISO);
    const { data, error } = await q;
    if (error) return null;
    tutti.push(...((data ?? []) as RigaOrdine[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
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

const MESI_FR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const GIORNI_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

async function serieDi(p: Periodo, ordini: RigaOrdine[]): Promise<{ kind: string; series: Bucket[] }> {
  const ora = DateTime.now().setZone(TIMEZONE);
  const dt = (o: RigaOrdine) => DateTime.fromISO(o.pickup_time).setZone(TIMEZONE);

  if (p === "day") {
    const { minH, maxH } = await fasciaApertura();
    const conta = new Array(24).fill(0) as number[];
    for (const o of ordini) conta[dt(o).hour]++;
    const series: Bucket[] = [];
    for (let h = minH; h < maxH; h++) series.push({ label: `${h}h`, count: conta[h] });
    return { kind: "hour", series };
  }

  if (p === "week") {
    const conta = new Array(7).fill(0) as number[];
    for (const o of ordini) conta[dt(o).weekday - 1]++; // luxon: 1=lun
    return { kind: "weekday", series: GIORNI_FR.map((g, i) => ({ label: g, count: conta[i] })) };
  }

  if (p === "month") {
    const giorni = ora.daysInMonth ?? 31;
    const conta = new Array(giorni + 1).fill(0) as number[];
    for (const o of ordini) conta[dt(o).day]++;
    const series: Bucket[] = [];
    for (let d = 1; d <= giorni; d++) series.push({ label: String(d), count: conta[d] });
    return { kind: "day", series };
  }

  if (p === "ytd") {
    const conta = new Array(13).fill(0) as number[];
    for (const o of ordini) conta[dt(o).month]++;
    const series: Bucket[] = [];
    for (let m = 1; m <= ora.month; m++) series.push({ label: MESI_FR[m - 1], count: conta[m] });
    return { kind: "month", series };
  }

  // all: trimestri dal primo ordine a oggi
  if (ordini.length === 0) return { kind: "quarter", series: [] };
  const primo = dt(ordini[0]);
  const conta = new Map<string, number>();
  for (const o of ordini) {
    const d = dt(o);
    conta.set(`${d.year}-${d.quarter}`, (conta.get(`${d.year}-${d.quarter}`) ?? 0) + 1);
  }
  const series: Bucket[] = [];
  let cur = primo.startOf("quarter");
  const fine = ora.endOf("quarter");
  while (cur <= fine) {
    series.push({
      label: `T${cur.quarter} ${String(cur.year).slice(2)}`,
      count: conta.get(`${cur.year}-${cur.quarter}`) ?? 0,
    });
    cur = cur.plus({ quarters: 1 });
  }
  return { kind: "quarter", series };
}

export async function calcolaStats(p: Periodo) {
  const ordini = await ordiniPagati(inizioPeriodo(p));
  if (ordini === null) return null;

  let revenue = 0;
  const perOra = new Array(24).fill(0) as number[];
  const piatti = new Map<string, { qty: number; cents: number }>();

  for (const o of ordini) {
    revenue += o.total_cents;
    const h = DateTime.fromISO(o.pickup_time).setZone(TIMEZONE).hour;
    if (h >= 0 && h < 24) perOra[h]++;
    for (const it of o.items ?? []) {
      if (!it || it.qty <= 0 || it.id === "note") continue;
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

  const { kind, series } = await serieDi(p, ordini);

  return {
    period: p,
    orders: ordini.length,
    revenue_cents: revenue,
    avg_cents: ordini.length ? Math.round(revenue / ordini.length) : 0,
    peak_hour: peakHour,
    peak_count: peakCount,
    series_kind: kind,
    series,
    top,
  };
}
