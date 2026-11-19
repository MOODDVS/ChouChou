/**
 * LA SCHEDA DEL CLIENTE IN admin.restohub.cloud — le regole pure (19/11/2026).
 *
 * Il lavoro con il database sta in `statoRestohub.ts`; qui solo le decisioni,
 * che si provano senza rete (`tests/statoRestohub.test.mjs`).
 */
import { JOB_ATTESI } from "./admin/supabaseRegole";

/** Il formato della risposta di `/api/restohub/stato`. Cambia solo se l'admin deve saperlo. */
export const VERSIONE_STATO = 1;

/** L'header con la chiave condivisa. Mai nell'indirizzo: finirebbe nei log. */
export const HEADER_CHIAVE = "x-restohub-key";

/** Il job di un indirizzo `/api/cron/...`, col nome che ha in pg_cron. `null` se non e' un job atteso. */
export function jobDaPercorso(percorso: string): string | null {
  const p = String(percorso ?? "").replace(/\/+$/, "");
  return JOB_ATTESI.find((j) => j.percorso === p)?.nome ?? null;
}

/** Una riga di `restohub_giri` (#99). */
export interface RigaGiro {
  job: string;
  ultimo: string;
  esito: number;
  ms: number;
  ultimo_ok: string | null;
}

/** Un job come lo vede la scheda: c'e' sempre, anche se non e' mai passato. */
export interface Giro {
  job: string;
  orario: string;
  ultimo: string | null;
  esito: number | null;
  ms: number | null;
  ultimoOk: string | null;
}

/** Tutti i job attesi, nell'ordine di pg_cron, con l'ultimo giro se c'e'. Le righe sconosciute restano fuori. */
export function giriAttesi(righe: RigaGiro[]): Giro[] {
  const per = new Map(righe.map((r) => [r.job, r]));
  return JOB_ATTESI.map((j) => {
    const r = per.get(j.nome);
    return {
      job: j.nome,
      orario: j.orario,
      ultimo: r?.ultimo ?? null,
      esito: r ? Number(r.esito) : null,
      ms: r ? Number(r.ms) : null,
      ultimoOk: r?.ultimo_ok ?? null,
    };
  });
}

/** Cosa scrivere per un giro: `ultimo_ok` solo se e' andato bene (sotto il 400). */
export function rigaDelGiro(job: string, esito: number, ms: number, adesso: Date): Record<string, unknown> {
  const ora = adesso.toISOString();
  return {
    job,
    ultimo: ora,
    esito: Math.trunc(esito),
    ms: Math.max(0, Math.round(ms)),
    ...(esito < 400 ? { ultimo_ok: ora } : {}),
  };
}
