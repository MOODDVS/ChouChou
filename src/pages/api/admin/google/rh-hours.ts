import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { supabaseAdmin } from "../../../../lib/db";

export const prerender = false;

// GET /api/admin/google/rh-hours
// Orari di RestoHub nel formato dell'editor Google:
//  - hours:   [{ d:0..6 lun..dom, chiuso, ranges:[{a,b}] }]  (pranzo -> 1ª fascia, cena -> 2ª)
//  - special: [{ date:"YYYY-MM-DD", closed, ranges:[{a,b}] }] (chiusure/aperture speciali;
//             gli intervalli di RestoHub sono espansi in singole date perché Google non
//             gestisce intervalli multi-giorno).

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const hhmm = (v: unknown): string => String(v ?? "").slice(0, 5);
// d editor (0=lun..6=dom) -> settings.day_of_week (0=dom..6=sab)
const dowDaEditor = (d: number): number => (d === 6 ? 0 : d + 1);

// Itera le date "YYYY-MM-DD" da 'from' a 'to' inclusi (limite di sicurezza).
function* intervalloDate(from: string, to: string, max = 366): Generator<string> {
  const start = new Date(from + "T00:00:00Z");
  const end = new Date((to || from) + "T00:00:00Z");
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
  let n = 0;
  for (const d = new Date(start); d <= end && n < max; d.setUTCDate(d.getUTCDate() + 1), n++) {
    yield d.toISOString().slice(0, 10);
  }
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const [set, spc] = await Promise.all([
    supabaseAdmin
      .from("settings")
      .select("day_of_week, lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close"),
    supabaseAdmin
      .from("special_days")
      .select("date_from, date_to, type, lunch_open, lunch_close, dinner_open, dinner_close"),
  ]);
  if (set.error || !set.data) return json({ error: "Orari RestoHub illeggibili" }, 502);

  // --- Orari settimanali ---
  const byDow = new Map<number, {
    lunch_active?: boolean; lunch_open?: string | null; lunch_close?: string | null;
    dinner_active?: boolean; dinner_open?: string | null; dinner_close?: string | null;
  }>();
  for (const r of set.data as { day_of_week: number }[]) byDow.set(r.day_of_week, r as never);

  const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const s = byDow.get(dowDaEditor(d));
    const ranges: { a: string; b: string }[] = [];
    if (s?.lunch_active && s.lunch_open && s.lunch_close) ranges.push({ a: hhmm(s.lunch_open), b: hhmm(s.lunch_close) });
    if (s?.dinner_active && s.dinner_open && s.dinner_close) ranges.push({ a: hhmm(s.dinner_open), b: hhmm(s.dinner_close) });
    return { d, chiuso: ranges.length === 0, ranges };
  });

  // --- Giorni speciali: intervalli -> singole date (solo da oggi in poi) ---
  const oggi = new Date().toISOString().slice(0, 10);
  const CAP = 250;
  const special: { date: string; closed: boolean; ranges: { a: string; b: string }[] }[] = [];
  for (const row of (spc.data ?? []) as {
    date_from: string; date_to: string; type: string;
    lunch_open?: string | null; lunch_close?: string | null;
    dinner_open?: string | null; dinner_close?: string | null;
  }[]) {
    for (const date of intervalloDate(row.date_from, row.date_to)) {
      if (special.length >= CAP) break;
      if (date < oggi) continue;
      if (row.type === "closed") {
        special.push({ date, closed: true, ranges: [] });
      } else {
        const ranges: { a: string; b: string }[] = [];
        if (row.lunch_open && row.lunch_close) ranges.push({ a: hhmm(row.lunch_open), b: hhmm(row.lunch_close) });
        if (row.dinner_open && row.dinner_close) ranges.push({ a: hhmm(row.dinner_open), b: hhmm(row.dinner_close) });
        special.push({ date, closed: false, ranges });
      }
    }
  }
  special.sort((a, b) => a.date.localeCompare(b.date));

  return json({ hours, special });
};
