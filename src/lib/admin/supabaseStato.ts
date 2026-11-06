/**
 * LA CASELLA SUPABASE — controlli e riparazioni (5/11/2026).
 *
 * Le regole stanno in `supabaseRegole.ts`; qui la rete:
 *   - la service key (gia' nel `.env`) per gli spazi di archivio e per sapere
 *     se il database e' vuoto;
 *   - la Management API di Supabase, con il token dell'organizzazione MOODD
 *     (`SUPABASE_ACCESS_TOKEN`, uguale per tutti i clienti), per tutto cio'
 *     che e' SQL: migrazioni, estensioni, job `pg_cron`.
 *
 * ⚠️ MAI un valore segreto in una risposta o in un log: l'SQL dei job contiene
 * `CRON_SECRET`, e degli errori della Management API si scrive solo lo stato.
 */
import { supabaseAdmin } from "../db";
import { leggi, tutteLeSedi } from "./sede";
import {
  BUCKET_ATTESI,
  ESTENSIONI_ATTESE,
  JOB_ATTESI,
  SQL_REGISTRO,
  bucketDaSistemare,
  jobGiusti,
  livelloCasella,
  migrazioniMancanti,
  ordinaMigrazioni,
  refDaUrl,
  refMascherato,
  sitoRaggiungibile,
  sqlJob,
  sqlLetterale,
  type Livello,
  type Migrazione,
  type Passo,
} from "./supabaseRegole";

/* Le migrazioni viaggiano DENTRO il server: `TUTTO.sql` resta fuori dal
   modello (`NNN_nome.sql`), cosi' non si applica due volte. */
const FILE_SQL = import.meta.glob("../../../supabase/[0-9][0-9][0-9]_*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const MIGRAZIONI: Migrazione[] = ordinaMigrazioni(Object.keys(FILE_SQL));
const SQL_DI = new Map<number, string>(
  MIGRAZIONI.map((m) => [m.numero, FILE_SQL[Object.keys(FILE_SQL).find((k) => k.endsWith("/" + m.file)) ?? ""] ?? ""]),
);

/** Una variabile d'ambiente letta al momento (build o processo). */
function env(nome: string): string {
  const da = (import.meta.env as Record<string, unknown>)[nome] ?? process.env[nome];
  return String(da ?? "").trim();
}

type EsitoSql = { ok: true; righe: Record<string, unknown>[] } | { ok: false; stato: number; messaggio: string };

/** Un SQL sul progetto, via Management API. Il testo non finisce mai nei log. */
async function sql(ref: string, query: string): Promise<EsitoSql> {
  const token = env("SUPABASE_ACCESS_TOKEN");
  if (!token || !ref) return { ok: false, stato: 0, messaggio: "token" };
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60_000),
    });
    const corpo = await res.json().catch(() => null);
    if (!res.ok) {
      const messaggio = String((corpo as { message?: unknown } | null)?.message ?? res.statusText ?? "").slice(0, 300);
      console.error(`[supabase] Management API ${res.status}`);
      return { ok: false, stato: res.status, messaggio };
    }
    return { ok: true, righe: Array.isArray(corpo) ? (corpo as Record<string, unknown>[]) : [] };
  } catch (e) {
    console.error("[supabase] Management API irraggiungibile:", (e as Error)?.name ?? "errore");
    return { ok: false, stato: 0, messaggio: "rete" };
  }
}

export interface StatoSupabase {
  progetto: { ref: string; mascherato: string; dashboard: string };
  chiavi: { url: "uguali" | "diverse" | "mancante"; anon: "uguali" | "diverse" | "mancante"; service: "ok" | "rifiutata" };
  token: boolean;
  sito: { raggiungibile: boolean };
  migrazioni: { livello: Livello; applicate: number; totale: number; mancanti: { numero: number; nome: string }[]; registro: boolean; baseVuota: boolean };
  bucket: { livello: Livello; presenti: number; totale: number; mancanti: string[]; daCorreggere: string[] };
  cron: { livello: Livello; giusti: number; totale: number; daRifare: string[]; domini: string[]; motivo: "" | "token" | "localhost" | "pgcron" };
  estensioni: { livello: Livello; presenti: string[]; mancanti: string[]; motivo: "" | "token" };
  casella: { livello: Livello; daFare: number };
}

function coppia(a: string, b: string): "uguali" | "diverse" | "mancante" {
  if (!a || !b) return "mancante";
  return a === b ? "uguali" : "diverse";
}

/** Il database ha le tabelle del motore? `orders` c'e' dalla #1. */
async function baseVuota(): Promise<boolean> {
  // L'aggregato per nome: e' una domanda sul database, non su un punto.
  const { error } = await leggi("orders", tutteLeSedi(), "id", { count: "exact", head: true }).limit(1);
  if (!error) return false;
  const c = String((error as { code?: string }).code ?? "");
  return c === "42P01" || c === "PGRST205" || /does not exist|schema cache/i.test(String(error.message ?? ""));
}

/** Le migrazioni registrate: via Management API se c'e' il token, se no via la service key. */
async function registrate(ref: string): Promise<number[] | null> {
  if (env("SUPABASE_ACCESS_TOKEN")) {
    const r = await sql(ref, "select numero from public.restohub_migrazioni order by numero");
    if (r.ok) return r.righe.map((x) => Number(x.numero)).filter(Number.isFinite);
    return null;
  }
  const { data, error } = await supabaseAdmin.from("restohub_migrazioni").select("numero");
  if (error) return null;
  return ((data ?? []) as { numero: number }[]).map((x) => Number(x.numero));
}

export async function statoSupabase(): Promise<StatoSupabase> {
  const ref = refDaUrl(env("SUPABASE_URL"));
  const token = !!env("SUPABASE_ACCESS_TOKEN");
  const sito = env("PUBLIC_SITE_URL");
  const raggiungibile = sitoRaggiungibile(sito);

  // ---- Le chiavi: si confrontano, mai si mostrano ----
  const { data: lista, error: eBucket } = await supabaseAdmin.storage.listBuckets();
  const chiavi: StatoSupabase["chiavi"] = {
    url: coppia(env("SUPABASE_URL"), env("PUBLIC_SUPABASE_URL")),
    anon: coppia(env("SUPABASE_ANON_KEY"), env("PUBLIC_SUPABASE_ANON_KEY")),
    service: eBucket ? "rifiutata" : "ok",
  };

  // ---- Spazi di archivio ----
  const esistenti = ((lista ?? []) as { id: string; public: boolean }[]).map((b) => ({ id: b.id, public: !!b.public }));
  const { mancanti: bMancanti, daCorreggere } = bucketDaSistemare(esistenti);
  const bucket: StatoSupabase["bucket"] = {
    livello: eBucket ? "ignoto" : bMancanti.length === BUCKET_ATTESI.length ? "no" : bMancanti.length || daCorreggere.length ? "parz" : "ok",
    presenti: BUCKET_ATTESI.length - bMancanti.length,
    totale: BUCKET_ATTESI.length,
    mancanti: bMancanti.map((b) => b.id),
    daCorreggere: daCorreggere.map((b) => b.id),
  };

  // ---- Migrazioni ----
  const vuota = await baseVuota();
  const fatte = await registrate(ref);
  const mancanti = migrazioniMancanti(MIGRAZIONI, fatte ?? []);
  const migrazioni: StatoSupabase["migrazioni"] = {
    livello: vuota ? "no" : mancanti.length ? "parz" : "ok",
    applicate: MIGRAZIONI.length - mancanti.length,
    totale: MIGRAZIONI.length,
    mancanti: mancanti.map((m) => ({ numero: m.numero, nome: m.nome })),
    registro: fatte !== null,
    baseVuota: vuota,
  };

  // ---- Estensioni e job: solo con il token ----
  let estensioni: StatoSupabase["estensioni"] = { livello: "ignoto", presenti: [], mancanti: [], motivo: "token" };
  let cron: StatoSupabase["cron"] = { livello: "ignoto", giusti: 0, totale: JOB_ATTESI.length, daRifare: [], domini: [], motivo: "token" };
  if (token) {
    const e = await sql(ref, `select extname from pg_extension where extname in (${ESTENSIONI_ATTESE.map(sqlLetterale).join(", ")})`);
    const presenti = e.ok ? e.righe.map((x) => String(x.extname)) : [];
    const eMancanti = ESTENSIONI_ATTESE.filter((x) => !presenti.includes(x));
    estensioni = { livello: !e.ok ? "ignoto" : eMancanti.length ? "no" : "ok", presenti, mancanti: eMancanti, motivo: "" };
    if (!presenti.includes("pg_cron")) {
      cron = { livello: "no", giusti: 0, totale: JOB_ATTESI.length, daRifare: JOB_ATTESI.map((j) => j.nome), domini: [], motivo: "pgcron" };
    } else {
      const j = await sql(ref, "select jobname, command, active from cron.job");
      const righe = j.ok ? (j.righe as { jobname: string; command: string; active?: boolean }[]) : [];
      const { giusti, daRifare, domini } = jobGiusti(righe, sito);
      cron = {
        livello: !j.ok ? "ignoto" : giusti.length === JOB_ATTESI.length ? "ok" : giusti.length ? "parz" : "no",
        giusti: giusti.length,
        totale: JOB_ATTESI.length,
        daRifare,
        domini,
        motivo: raggiungibile ? "" : "localhost",
      };
    }
  }

  const livelli: Livello[] = [migrazioni.livello, bucket.livello, cron.livello, estensioni.livello];
  if (chiavi.url !== "uguali" || chiavi.anon !== "uguali" || chiavi.service !== "ok") livelli.push("no");
  return {
    progetto: { ref, mascherato: refMascherato(ref), dashboard: ref ? `https://supabase.com/dashboard/project/${ref}` : "" },
    chiavi,
    token,
    sito: { raggiungibile },
    migrazioni,
    bucket,
    cron,
    estensioni,
    casella: livelloCasella(livelli),
  };
}

export type EsitoPasso =
  | { ok: true; fatte: number; restano: number }
  | { ok: false; errore: "token" | "localhost" | "segreto" | "pgcron" | "sql" | "storage"; numero?: number; messaggio?: string };

/** Le migrazioni si applicano a pezzi: oltre questo tempo si risponde e il
 *  browser richiama. ⚠️ 8 s e non 20 (5/11/2026, demo): con giri lunghi il
 *  numero a schermo stava fermo mezzo minuto e sembrava che non facesse niente. */
const BUDGET_MS = 8_000;

/** Un passo di «Tout préparer». Rilanciabile: cio' che c'e' gia' non si tocca. */
export async function applicaPasso(passo: Passo): Promise<EsitoPasso> {
  const ref = refDaUrl(env("SUPABASE_URL"));

  if (passo === "bucket") {
    const { data, error } = await supabaseAdmin.storage.listBuckets();
    if (error) return { ok: false, errore: "storage" };
    const { mancanti, daCorreggere } = bucketDaSistemare(((data ?? []) as { id: string; public: boolean }[]).map((b) => ({ id: b.id, public: !!b.public })));
    let fatte = 0;
    for (const b of mancanti) {
      const r = await supabaseAdmin.storage.createBucket(b.id, { public: b.pubblico });
      if (r.error) return { ok: false, errore: "storage", messaggio: b.id };
      fatte++;
    }
    for (const b of daCorreggere) {
      const r = await supabaseAdmin.storage.updateBucket(b.id, { public: b.pubblico });
      if (r.error) return { ok: false, errore: "storage", messaggio: b.id };
      fatte++;
    }
    return { ok: true, fatte, restano: 0 };
  }

  if (!env("SUPABASE_ACCESS_TOKEN")) return { ok: false, errore: "token" };

  if (passo === "estensioni") {
    const r = await sql(ref, "create extension if not exists pg_cron; create extension if not exists pg_net with schema extensions;");
    return r.ok ? { ok: true, fatte: ESTENSIONI_ATTESE.length, restano: 0 } : { ok: false, errore: "sql", messaggio: r.messaggio };
  }

  if (passo === "migrazioni") {
    const reg = await sql(ref, SQL_REGISTRO);
    if (!reg.ok) return { ok: false, errore: "sql", messaggio: reg.messaggio };
    const fatteGia = await registrate(ref);
    const mancanti = migrazioniMancanti(MIGRAZIONI, fatteGia ?? []);
    const inizio = Date.now();
    let fatte = 0;
    for (const m of mancanti) {
      if (Date.now() - inizio > BUDGET_MS) break;
      const r = await sql(ref, SQL_DI.get(m.numero) ?? "");
      if (!r.ok) return { ok: false, errore: "sql", numero: m.numero, messaggio: r.messaggio };
      const segna = await sql(ref, `insert into public.restohub_migrazioni (numero, file) values (${m.numero}, ${sqlLetterale(m.file)}) on conflict (numero) do nothing;`);
      if (!segna.ok) return { ok: false, errore: "sql", numero: m.numero, messaggio: segna.messaggio };
      fatte++;
    }
    // PostgREST tiene la struttura in cache: senza questo, le tabelle appena
    // nate rispondono «Could not find the table … in the schema cache».
    await sql(ref, "notify pgrst, 'reload schema';");
    return { ok: true, fatte, restano: mancanti.length - fatte };
  }

  // ---- I job ----
  const sito = env("PUBLIC_SITE_URL");
  if (!sitoRaggiungibile(sito)) return { ok: false, errore: "localhost" };
  const segreto = env("CRON_SECRET");
  if (!segreto) return { ok: false, errore: "segreto" };
  const ext = await sql(ref, "select 1 from pg_extension where extname = 'pg_cron'");
  if (!ext.ok || !ext.righe.length) return { ok: false, errore: "pgcron" };
  const j = await sql(ref, "select jobname, command, active from cron.job");
  const { daRifare } = jobGiusti(j.ok ? (j.righe as { jobname: string; command: string; active?: boolean }[]) : [], sito);
  let fatte = 0;
  for (const nome of daRifare) {
    const job = JOB_ATTESI.find((x) => x.nome === nome);
    if (!job) continue;
    const r = await sql(ref, sqlJob(job, sito, segreto));
    // ⚠️ Il messaggio di un errore qui potrebbe ripetere l'SQL, che contiene
    // la chiave dei cron: non si restituisce.
    if (!r.ok) return { ok: false, errore: "sql", messaggio: nome };
    fatte++;
  }
  return { ok: true, fatte, restano: 0 };
}
