import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { configGiornoEffettiva } from "../../lib/schedule";
import { TIMEZONE } from "../../lib/slots";
import type { ConfigGiorno } from "../../lib/slots";

export const prerender = false;

const hhmm = (t: string | null): string => (t ? String(t).slice(0, 5) : "");
const toMin = (t: string): number => {
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  return h * 60 + m;
};
function rangesOf(c: ConfigGiorno | null): { open: string; close: string }[] {
  const r: { open: string; close: string }[] = [];
  if (c?.lunch_active && c.lunch_open && c.lunch_close) r.push({ open: hhmm(c.lunch_open), close: hhmm(c.lunch_close) });
  if (c?.dinner_active && c.dinner_open && c.dinner_close) r.push({ open: hhmm(c.dinner_open), close: hhmm(c.dinner_close) });
  return r.sort((a, b) => toMin(a.open) - toMin(b.open));
}
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// GET /api/hours — stato di apertura + orari settimanali, dal motore.
//  open:true  -> { open:true, from, to, week }
//  chiuso     -> { open:false, next:{when,date,time}|null, week }
//  week = 7 giorni (lun-dom), ognuno { dow, date, ranges:[{open,close}] }.
// Il front-end formatta testo e nomi dei giorni nella lingua scelta.
export const GET: APIRoute = async () => {
  try {
    const now = DateTime.now().setZone(TIMEZONE);

    // --- Settimana (lun-dom): prossima occorrenza di ogni giorno entro 7 gg ---
    const week: { dow: number; date: string; ranges: { open: string; close: string }[] }[] = [];
    for (let dow = 1; dow <= 7; dow++) {
      let day = now;
      for (let i = 0; i < 7; i++) {
        const d = now.plus({ days: i });
        if (d.weekday === dow) { day = d; break; }
      }
      const c = await configGiornoEffettiva(day);
      week.push({ dow, date: day.toFormat("yyyy-MM-dd"), ranges: rangesOf(c) });
    }

    // --- Stato di oggi ---
    const cfg = await configGiornoEffettiva(now);
    const oggi = rangesOf(cfg);
    const nowMin = now.hour * 60 + now.minute;
    const current = oggi.find((r) => toMin(r.open) <= nowMin && nowMin < toMin(r.close));
    if (current) return json({ open: true, from: current.open, to: current.close, week });

    const later = oggi.filter((r) => toMin(r.open) > nowMin)[0];
    if (later) return json({ open: false, next: { when: "today", date: now.toFormat("yyyy-MM-dd"), time: later.open }, week });

    for (let i = 1; i <= 7; i++) {
      const g = now.plus({ days: i });
      const c = await configGiornoEffettiva(g);
      const r = rangesOf(c);
      if (r.length) {
        return json({ open: false, next: { when: i === 1 ? "tomorrow" : "day", date: g.toFormat("yyyy-MM-dd"), time: r[0].open }, week });
      }
    }
    return json({ open: false, next: null, week });
  } catch {
    return json({ open: null, week: [] });
  }
};
