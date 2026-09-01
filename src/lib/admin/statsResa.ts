import { supabaseAdmin } from "../db";

// ============================================================
// Statistiche PRENOTAZIONI aggregate del ristorante (tab "Prenotazioni"
// nella pagina Statistiche). Tutto calcolato lato server con la service key.
// Periodo = ultimi N giorni (per data della prenotazione).
// ============================================================

export interface ResaStats {
  totale: number;              // prenotazioni onorate/attive (confirmed/seated/done/noshow)
  coperti: number;             // somma coperti (people) del set attivo
  copertiMediPren: number;     // coperti medi per prenotazione
  giornoTopIdx: number;        // 0=Lun … 6=Dom (giorno con più prenotazioni), -1 se vuoto
  giornoTopMedia: number;      // media prenotazioni in quel giorno della settimana
  fasciaTopOra: string;        // "HH:00" con più prenotazioni ("" se vuoto)
  fasciaTopPct: number;        // % delle prenotazioni in quella fascia
  mediaTavoliGiorno: number;   // media tavoli prenotati per giorno di apertura
  tempoMedioMin: number;       // media table_minutes (solo tavoli completati)
  spesaMediaCents: number;     // media spent_cents (dove > 0)
  spesaCopertoCents: number;   // spesa media per coperto
  anticipoOre: number;         // media anticipo prenotazione, in ore
  cancellazioni: number; cancellazioniPct: number;
  noshow: number; noshowPct: number;
  presenzaPct: number;         // (seated+done) / set attivo
  eventiSpeciali: number;      // compleanni + eventi speciali
  serie: { date: string; pren: number; canc: number; ns: number }[];
  perGiorno: number[];         // [Lun..Dom] conteggi
  perOra: { ora: string; n: number }[];
  perFonte: { fonte: string; n: number }[];       // fonte = chiave (web/phone/walkin/google/…)
  copertiServizio: { servizio: string; coperti: number }[]; // servizio = service_key
}

const ATTIVI = new Set(["confirmed", "seated", "done", "noshow"]);

interface Riga {
  date: string;
  heure: string | null;
  service_key: string | null;
  people: number | null;
  status: string | null;
  source: string | null;
  created_at: string | null;
  seated_at: string | null;
  table_minutes: number | null;
  spent_cents: number | null;
  tables: unknown;
  birthday: boolean | null;
  special_event: boolean | null;
}

/** Indice giorno settimana 0=Lun … 6=Dom da una data ISO (YYYY-MM-DD). */
function dowLun(dateISO: string): number {
  const d = new Date(dateISO + "T00:00:00");
  const js = d.getDay(); // 0=Dom … 6=Sab
  return (js + 6) % 7;   // 0=Lun … 6=Dom
}

function nTavoli(tables: unknown): number {
  if (Array.isArray(tables)) return tables.length || 1;
  if (typeof tables === "string" && tables.trim()) {
    try { const a = JSON.parse(tables); if (Array.isArray(a)) return a.length || 1; } catch { /* */ }
    return 1;
  }
  return 1; // ogni prenotazione occupa almeno un tavolo
}

export async function calcolaStatsResa(giorni: number): Promise<ResaStats> {
  const oggi = new Date();
  const to = oggi.toISOString().slice(0, 10);
  const fromD = new Date(oggi);
  fromD.setDate(fromD.getDate() - (giorni - 1));
  const from = fromD.toISOString().slice(0, 10);

  const { data } = await supabaseAdmin
    .from("reservations")
    .select("date, heure, service_key, people, status, source, created_at, seated_at, table_minutes, spent_cents, tables, birthday, special_event")
    .gte("date", from)
    .lte("date", to);

  const righe = (data ?? []) as Riga[];

  const vuoto: ResaStats = {
    totale: 0, coperti: 0, copertiMediPren: 0, giornoTopIdx: -1, giornoTopMedia: 0,
    fasciaTopOra: "", fasciaTopPct: 0, mediaTavoliGiorno: 0, tempoMedioMin: 0,
    spesaMediaCents: 0, spesaCopertoCents: 0, anticipoOre: 0,
    cancellazioni: 0, cancellazioniPct: 0, noshow: 0, noshowPct: 0, presenzaPct: 0,
    eventiSpeciali: 0, serie: [], perGiorno: [0, 0, 0, 0, 0, 0, 0], perOra: [], perFonte: [], copertiServizio: [],
  };

  // serie giornaliera (tutti i giorni del periodo)
  const perDay = new Map<string, { pren: number; canc: number; ns: number }>();
  for (let i = 0; i < giorni; i++) {
    const d = new Date(fromD); d.setDate(d.getDate() + i);
    perDay.set(d.toISOString().slice(0, 10), { pren: 0, canc: 0, ns: 0 });
  }

  const attivi: Riga[] = [];
  let cancellazioni = 0, noshow = 0, seatedDone = 0;
  const perGiorno = [0, 0, 0, 0, 0, 0, 0];
  const perOra = new Map<string, number>();
  const perFonte = new Map<string, number>();
  const copServizio = new Map<string, number>();
  const tavoliPerData = new Map<string, number>();
  let tempoTot = 0, tempoN = 0;
  let spesaTot = 0, spesaN = 0, spesaCoperti = 0;
  let anticipoTot = 0, anticipoN = 0;
  let eventi = 0;

  for (const r of righe) {
    const st = String(r.status ?? "");
    const bucket = perDay.get(r.date);
    if (st === "cancelled") { cancellazioni++; if (bucket) bucket.canc++; continue; }
    if (!ATTIVI.has(st)) continue;

    // set attivo (prenotazioni reali)
    attivi.push(r);
    if (bucket) bucket.pren++;
    if (st === "noshow") { noshow++; if (bucket) bucket.ns++; }
    if (st === "seated" || st === "done") seatedDone++;

    perGiorno[dowLun(r.date)]++;

    const ora = String(r.heure ?? "").slice(0, 2);
    if (/^\d\d$/.test(ora)) perOra.set(ora + ":00", (perOra.get(ora + ":00") ?? 0) + 1);

    const fonte = String(r.source ?? "").trim() || "altro";
    perFonte.set(fonte, (perFonte.get(fonte) ?? 0) + 1);

    const sv = String(r.service_key ?? "").trim() || "altro";
    copServizio.set(sv, (copServizio.get(sv) ?? 0) + (Number(r.people) || 0));

    tavoliPerData.set(r.date, (tavoliPerData.get(r.date) ?? 0) + nTavoli(r.tables));

    if (st === "done" && Number(r.table_minutes) > 0) { tempoTot += Number(r.table_minutes); tempoN++; }
    if (Number(r.spent_cents) > 0) { spesaTot += Number(r.spent_cents); spesaN++; spesaCoperti += Number(r.people) || 0; }

    if (r.created_at) {
      const dt = new Date(r.date + "T" + (String(r.heure ?? "12:00")) + ":00").getTime();
      const cr = new Date(r.created_at).getTime();
      if (Number.isFinite(dt) && Number.isFinite(cr) && dt >= cr) { anticipoTot += (dt - cr) / 3_600_000; anticipoN++; }
    }
    if (r.birthday || r.special_event) eventi++;
  }

  const totale = attivi.length;
  if (!totale && !cancellazioni) return vuoto;

  const coperti = attivi.reduce((s, r) => s + (Number(r.people) || 0), 0);

  // giorno top + media per quel giorno
  let giornoTopIdx = -1, giornoTopMax = -1;
  for (let i = 0; i < 7; i++) if (perGiorno[i] > giornoTopMax) { giornoTopMax = perGiorno[i]; giornoTopIdx = i; }
  // quante occorrenze di quel giorno-settimana nel periodo (per la media)
  let occTop = 0;
  if (giornoTopIdx >= 0) for (const dstr of perDay.keys()) if (dowLun(dstr) === giornoTopIdx) occTop++;
  const giornoTopMedia = occTop ? giornoTopMax / occTop : 0;

  // fascia top
  let fasciaTopOra = "", fasciaTopN = 0;
  for (const [ora, n] of perOra) if (n > fasciaTopN) { fasciaTopN = n; fasciaTopOra = ora; }

  const giorniAttivi = tavoliPerData.size || 1;
  const tavoliTot = [...tavoliPerData.values()].reduce((s, v) => s + v, 0);

  const serie = [...perDay.entries()].map(([date, v]) => ({ date, pren: v.pren, canc: v.canc, ns: v.ns }));
  const baseCanc = totale + cancellazioni;

  return {
    totale,
    coperti,
    copertiMediPren: totale ? coperti / totale : 0,
    giornoTopIdx,
    giornoTopMedia,
    fasciaTopOra,
    fasciaTopPct: totale ? (fasciaTopN / totale) * 100 : 0,
    mediaTavoliGiorno: tavoliTot / giorniAttivi,
    tempoMedioMin: tempoN ? tempoTot / tempoN : 0,
    spesaMediaCents: spesaN ? spesaTot / spesaN : 0,
    spesaCopertoCents: spesaCoperti ? spesaTot / spesaCoperti : 0,
    anticipoOre: anticipoN ? anticipoTot / anticipoN : 0,
    cancellazioni,
    cancellazioniPct: baseCanc ? (cancellazioni / baseCanc) * 100 : 0,
    noshow,
    noshowPct: totale ? (noshow / totale) * 100 : 0,
    presenzaPct: totale ? (seatedDone / totale) * 100 : 0,
    eventiSpeciali: eventi,
    serie,
    perGiorno,
    perOra: [...perOra.entries()].map(([ora, n]) => ({ ora, n })).sort((a, b) => a.ora.localeCompare(b.ora)),
    perFonte: [...perFonte.entries()].map(([fonte, n]) => ({ fonte, n })).sort((a, b) => b.n - a.n),
    copertiServizio: [...copServizio.entries()].map(([servizio, coperti]) => ({ servizio, coperti })).sort((a, b) => b.coperti - a.coperti),
  };
}
