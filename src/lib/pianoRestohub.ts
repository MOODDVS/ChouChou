/**
 * IL PIANO DI ALLINEAMENTO — quello che admin.restohub.cloud deve fare sul
 * Supabase di questo cliente per allinearlo al motore (27/11/2026).
 *
 * ⚠️ IL TOKEN DI SUPABASE NON VIENE QUI. Il token dell'organizzazione MOODD
 * apre TUTTI i database dei clienti: sta solo nell'admin, che esegue l'SQL
 * con la Management API. Da qui escono soltanto le cose di questo cliente
 * che l'admin non puo' sapere: il progetto (`ref`), l'SQL delle migrazioni
 * del SUO codice (quelle che il suo sito sa usare) e l'SQL dei job, che
 * porta dentro il suo `CRON_SECRET` e il suo dominio.
 * ⚠️ Per questo la rotta che lo rende vuole la chiave dell'admin, e nessun
 * log ne scrive il contenuto.
 */
import { MIGRAZIONI, sqlMigrazione } from "./admin/supabaseStato";
import { JOB_ATTESI, SQL_REGISTRO, refDaUrl, sitoRaggiungibile, sqlJob } from "./admin/supabaseRegole";

/** Il formato della risposta. Cambia solo se l'admin deve saperlo. */
export const VERSIONE_PIANO = 1;

export interface PianoAllineamento {
  v: number;
  /** Il progetto Supabase (`https://<ref>.supabase.co`). "" = SUPABASE_URL storta. */
  ref: string;
  /** Il dominio che i job chiamano. */
  sito: string;
  estensioni: string;
  registro: string;
  migrazioni: { numero: number; file: string; nome: string; sql: string }[];
  /** `null` = i job non si possono scrivere da qui (`motivo`). */
  job: { nome: string; orario: string; percorso: string; sql: string }[] | null;
  motivo: "" | "localhost" | "segreto";
}

function env(nome: string): string {
  const v = (import.meta.env as Record<string, unknown>)[nome] ?? process.env[nome];
  return String(v ?? "").trim();
}

export function pianoAllineamento(): PianoAllineamento {
  const sito = env("PUBLIC_SITE_URL").replace(/\/+$/, "");
  const segreto = env("CRON_SECRET");
  const motivo = !sitoRaggiungibile(sito) ? "localhost" : !segreto ? "segreto" : "";
  return {
    v: VERSIONE_PIANO,
    ref: refDaUrl(env("SUPABASE_URL")),
    sito,
    estensioni: "create extension if not exists pg_cron; create extension if not exists pg_net with schema extensions;",
    registro: SQL_REGISTRO,
    migrazioni: MIGRAZIONI.map((m) => ({ numero: m.numero, file: m.file, nome: m.nome, sql: sqlMigrazione(m.numero) })),
    job: motivo ? null : JOB_ATTESI.map((j) => ({ ...j, sql: sqlJob(j, sito, segreto) })),
    motivo,
  };
}
