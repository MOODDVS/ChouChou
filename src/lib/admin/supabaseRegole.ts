/**
 * LA CASELLA SUPABASE DI INTÉGRATIONS — le regole pure (5/11/2026).
 *
 * Controlla il database del cliente e prepara quello che manca: migrazioni,
 * spazi di archivio, tâches planifiées, estensioni. Qui solo le decisioni,
 * senza rete: cosa manca, in che ordine si fa, che SQL serve. Il lavoro vero
 * sta in `supabaseStato.ts`.
 *
 * ⚠️ Le chiavi Supabase NON si scrivono da qui: stanno nel `.env`, perche'
 * servono per arrivare al database stesso. La casella le controlla soltanto.
 */

/** Gli spazi di archivio che il motore usa. `admin_docs` e' privato (#93). */
export const BUCKET_ATTESI: { id: string; pubblico: boolean }[] = [
  { id: "popups", pubblico: true },
  { id: "menu", pubblico: true },
  { id: "documents", pubblico: true },
  { id: "brand", pubblico: true },
  { id: "admin_docs", pubblico: false },
];

/** Le estensioni che servono ai job: pg_cron li fa partire, pg_net chiama il sito. */
export const ESTENSIONI_ATTESE = ["pg_cron", "pg_net"];

/** I cinque job (NUOVO_PROGETTO.md §6): nome, orario, percorso. */
export const JOB_ATTESI: { nome: string; orario: string; percorso: string }[] = [
  { nome: "auto-complete-orders", orario: "0 * * * *", percorso: "/api/cron/auto-complete-orders" },
  { nome: "daily-brief", orario: "5 * * * *", percorso: "/api/cron/daily-brief" },
  { nome: "newsletter", orario: "10 * * * *", percorso: "/api/cron/newsletter" },
  { nome: "reservation-reminders", orario: "15 * * * *", percorso: "/api/cron/reservation-reminders" },
  { nome: "google-reviews-hourly", orario: "20 * * * *", percorso: "/api/cron/google-reviews" },
];

/**
 * Il registro delle migrazioni applicate (#94). Il codice lo crea PRIMA di
 * applicare qualunque cosa: e' la sola migrazione che deve esistere prima
 * delle altre, perche' e' quella che dice quali mancano.
 */
export const SQL_REGISTRO = `create table if not exists public.restohub_migrazioni (
  numero integer primary key,
  file text not null,
  applicata_il timestamptz not null default now()
);
alter table public.restohub_migrazioni enable row level security;
grant select, insert, update, delete on public.restohub_migrazioni to service_role;`;

/** Il riferimento del progetto da `https://<ref>.supabase.co`. "" se non e' un URL Supabase. */
export function refDaUrl(url: unknown): string {
  const m = String(url ?? "").trim().match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i);
  return m ? m[1].toLowerCase() : "";
}

/** Il riferimento da mostrare: le prime e le ultime quattro lettere. */
export function refMascherato(ref: string): string {
  return ref.length > 8 ? `${ref.slice(0, 4)}••••${ref.slice(-4)}` : ref;
}

/** Una migrazione dal nome del file: `092_tavoli_pentagono_rotazione.sql`. */
export interface Migrazione {
  numero: number;
  file: string;
  /** Il nome leggibile: «tavoli pentagono rotazione». */
  nome: string;
}

export function migrazioneDaFile(percorso: string): Migrazione | null {
  const file = String(percorso).split("/").pop() ?? "";
  const m = file.match(/^(\d{3})_([a-z0-9_]+)\.sql$/i);
  if (!m) return null;
  return { numero: Number(m[1]), file, nome: m[2].replace(/_/g, " ") };
}

/** Le migrazioni in ordine, senza doppioni di numero (vince il primo file). */
export function ordinaMigrazioni(percorsi: string[]): Migrazione[] {
  const per = new Map<number, Migrazione>();
  for (const p of percorsi) {
    const m = migrazioneDaFile(p);
    if (m && !per.has(m.numero)) per.set(m.numero, m);
  }
  return [...per.values()].sort((a, b) => a.numero - b.numero);
}

/** Quelle che mancano, in ordine. */
export function migrazioniMancanti(tutte: Migrazione[], applicate: Iterable<number>): Migrazione[] {
  const fatte = new Set(applicate);
  return tutte.filter((m) => !fatte.has(m.numero));
}

/** Gli spazi che mancano, e quelli con la visibilita' sbagliata. */
export function bucketDaSistemare(
  esistenti: { id: string; public: boolean }[],
): { mancanti: { id: string; pubblico: boolean }[]; daCorreggere: { id: string; pubblico: boolean }[] } {
  const per = new Map(esistenti.map((b) => [b.id, b.public]));
  return {
    mancanti: BUCKET_ATTESI.filter((b) => !per.has(b.id)),
    daCorreggere: BUCKET_ATTESI.filter((b) => per.has(b.id) && per.get(b.id) !== b.pubblico),
  };
}

/** Un valore dentro una stringa SQL tra apici. */
export function sqlLetterale(v: string): string {
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * L'indirizzo del sito e' uno su cui un job puo' chiamare? Un job che punta a
 * localhost non arriva da nessuna parte: in sviluppo i job non si creano.
 */
export function sitoRaggiungibile(sito: unknown): boolean {
  try {
    const u = new URL(String(sito ?? ""));
    if (u.protocol !== "https:") return false;
    return !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) && !u.hostname.endsWith(".localhost") && !u.hostname.endsWith(".test");
  } catch {
    return false;
  }
}

/** L'SQL di un job: `cron.schedule` con lo stesso nome lo AGGIORNA (pg_cron ≥ 1.4). */
export function sqlJob(job: { nome: string; orario: string; percorso: string }, sito: string, segreto: string): string {
  const url = sito.replace(/\/+$/, "") + job.percorso;
  return `select cron.schedule(${sqlLetterale(job.nome)}, ${sqlLetterale(job.orario)}, $job$
  select net.http_get(url := ${sqlLetterale(url)},
    headers := jsonb_build_object('x-cron-key', ${sqlLetterale(segreto)})); $job$);`;
}

/**
 * Un job c'e' ed e' giusto? Nome, attivo, chiave nell'header, percorso — e il
 * dominio del sito, ma SOLO quando il sito e' quello online.
 *
 * ⚠️ In locale `PUBLIC_SITE_URL` e' localhost: confrontarlo coi job (che
 * chiamano il dominio vero) li dava tutti sbagliati — un allarme falso,
 * visto il 5/11/2026 su 450 Gradi. In locale si dice A QUALE dominio puntano
 * (`domini`), e lo giudica chi guarda.
 */
export function jobGiusti(
  esistenti: { jobname: string; command: string; active?: boolean }[],
  sito: string,
): { giusti: string[]; daRifare: string[]; domini: string[] } {
  const online = sitoRaggiungibile(sito);
  let host = "";
  try { host = new URL(sito).host; } catch { /* sito non valido */ }
  const per = new Map(esistenti.map((j) => [j.jobname, j]));
  const giusti: string[] = [];
  const daRifare: string[] = [];
  const domini = new Set<string>();
  for (const j of JOB_ATTESI) {
    const e = per.get(j.nome);
    const m = e?.command.match(/https?:\/\/([^/'"\s]+)/);
    if (m) domini.add(m[1]);
    const dominioOk = online ? !!host && !!e && e.command.includes(host) : true;
    const ok = !!e && e.active !== false && /x-cron-key/.test(e.command) && e.command.includes(j.percorso) && dominioOk;
    (ok ? giusti : daRifare).push(j.nome);
  }
  return { giusti, daRifare, domini: [...domini] };
}

/** I passi di «Tout préparer», nell'ordine in cui si fanno. */
export const PASSI = ["estensioni", "migrazioni", "bucket", "cron"] as const;
export type Passo = (typeof PASSI)[number];

export type Livello = "ok" | "parz" | "no" | "ignoto";

/** Il segno della casella da quello dei controlli. */
export function livelloCasella(livelli: Livello[]): { livello: Livello; daFare: number } {
  const daFare = livelli.filter((l) => l === "parz" || l === "no").length;
  if (livelli.every((l) => l === "ok")) return { livello: "ok", daFare: 0 };
  if (livelli.some((l) => l === "no")) return { livello: "no", daFare };
  if (daFare) return { livello: "parz", daFare };
  return { livello: "ignoto", daFare: 0 };
}
