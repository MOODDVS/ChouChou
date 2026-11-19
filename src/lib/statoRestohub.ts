/**
 * LA SCHEDA DEL CLIENTE IN admin.restohub.cloud — le letture (19/11/2026).
 *
 * `/api/restohub/stato` rende un RIASSUNTO di questa installazione: a che
 * punto sono le migrazioni, quando sono passati i job, se si incassa online,
 * quanti ordini e prenotazioni. Cosi' l'admin di RestoHub non tiene le chiavi
 * Supabase dei clienti: ogni sito racconta di se' quel tanto e basta.
 *
 * ⚠️ Niente segreti e niente dati personali in uscita: numeri, date, nomi dei
 * job e delle migrazioni, «live»/«test» della chiave Stripe (mai la chiave).
 * ⚠️ Ogni parte e' chiusa nel suo `try`: se una si rompe esce `null` e le
 * altre arrivano lo stesso.
 */
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DateTime } from "luxon";
import { supabaseAdmin } from "./db";
import { leggi, tutteLeSedi, sede, elencoSedi, contoAttivo, SEDE_UNICA } from "./admin/sede";
import { fusoDi } from "./fuso";
import { MIGRAZIONI } from "./admin/supabaseStato";
import { migrazioniMancanti } from "./admin/supabaseRegole";
import { riepilogo } from "./admin/stripeStato";
import { livelloStripe, modoChiave } from "./admin/stripeRegole";
import { VERSIONE_STATO, giriAttesi, type Giro, type RigaGiro } from "./statoRestohubRegole";

const AVVIATO = new Date().toISOString();

/** Quando e' stato costruito questo server: la data del file compilato. */
function costruito(): string | null {
  try {
    return statSync(fileURLToPath(import.meta.url)).mtime.toISOString();
  } catch {
    return null;
  }
}

export interface StatoRestohub {
  v: number;
  ora: string;
  motore: { avviato: string; costruito: string | null; migrazioniCodice: number; ultimaCodice: number };
  sedi: number | null;
  migrazioni: { registro: boolean; applicate: number; totale: number; mancanti: { numero: number; nome: string }[] } | null;
  giri: { registro: boolean; elenco: Giro[] } | null;
  stripe: { livello: string; pronti: number; totale: number; daEnv: boolean; modi: ("live" | "test" | "")[] } | null;
  attivita: {
    fuso: string;
    ordini: { oggi: number; sette: number; ultimo: string | null };
    prenotazioni: { oggi: number; sette: number; prossime: number; ultimo: string | null };
  } | null;
}

/** Una parte del riassunto: `null` se si rompe o se ci mette piu' di 8 secondi (l'admin aspetta 20). */
async function provaA<T>(fn: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<null>((ok) => { timer = setTimeout(() => ok(null), 8_000); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function migrazioni(): Promise<StatoRestohub["migrazioni"]> {
  const { data, error } = await supabaseAdmin.from("restohub_migrazioni").select("numero");
  const fatte = error ? [] : ((data ?? []) as { numero: number }[]).map((r) => Number(r.numero));
  const mancanti = migrazioniMancanti(MIGRAZIONI, fatte);
  return {
    registro: !error,
    applicate: MIGRAZIONI.length - mancanti.length,
    totale: MIGRAZIONI.length,
    // Senza registro «mancano» tutte: l'elenco non direbbe niente.
    mancanti: error ? [] : mancanti.slice(0, 30).map((m) => ({ numero: m.numero, nome: m.nome })),
  };
}

async function giri(): Promise<StatoRestohub["giri"]> {
  const { data, error } = await supabaseAdmin.from("restohub_giri").select("job, ultimo, esito, ms, ultimo_ok");
  return { registro: !error, elenco: giriAttesi(error ? [] : ((data ?? []) as RigaGiro[])) };
}

async function stripe(): Promise<StatoRestohub["stripe"]> {
  const sedi = await elencoSedi();
  const livelli = await Promise.all([riepilogo("marchio", ""), ...sedi.map((s) => riepilogo(s.id, s.name))]);
  const casella = livelloStripe(livelli);
  // Come la casella: con le sedi contano le sedi, se no il marchio.
  const ambiti = sedi.length ? sedi.map((s) => sede(s.id)) : [SEDE_UNICA];
  const modi = await Promise.all(
    ambiti.map(async (a) => {
      try {
        const c = await contoAttivo(a);
        return c.pronto ? modoChiave(c.chiave) : "";
      } catch {
        return "" as const;
      }
    }),
  );
  return { livello: casella.livello, pronti: casella.pronti, totale: casella.totale, daEnv: casella.daEnv, modi };
}

async function conta(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await q;
  if (error) throw new Error("conteggio");
  return count ?? 0;
}

async function ultimo(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<string | null> {
  const { data, error } = await q;
  if (error) throw new Error("ultimo");
  const r = (data as { created_at?: string }[] | null)?.[0];
  return r?.created_at ?? null;
}

async function attivita(): Promise<StatoRestohub["attivita"]> {
  const fuso = await fusoDi(SEDE_UNICA);
  const oggi = DateTime.now().setZone(fuso).startOf("day");
  const da = oggi.toUTC().toISO()!;
  const da7 = oggi.minus({ days: 6 }).toUTC().toISO()!;
  const tutte = tutteLeSedi();
  const VALIDI = ["paid", "done"];
  const n = { count: "exact" as const, head: true };
  const [oOggi, oSette, oUltimo, pOggi, pSette, pProssime, pUltimo] = await Promise.all([
    conta(leggi("orders", tutte, "id", n).in("status", VALIDI).gte("created_at", da)),
    conta(leggi("orders", tutte, "id", n).in("status", VALIDI).gte("created_at", da7)),
    ultimo(leggi("orders", tutte, "created_at").in("status", VALIDI).order("created_at", { ascending: false }).limit(1)),
    conta(leggi("reservations", tutte, "id", n).gte("created_at", da)),
    conta(leggi("reservations", tutte, "id", n).gte("created_at", da7)),
    conta(leggi("reservations", tutte, "id", n).eq("status", "confirmed").gte("date", oggi.toISODate()!)),
    ultimo(leggi("reservations", tutte, "created_at").order("created_at", { ascending: false }).limit(1)),
  ]);
  return {
    fuso,
    ordini: { oggi: oOggi, sette: oSette, ultimo: oUltimo },
    prenotazioni: { oggi: pOggi, sette: pSette, prossime: pProssime, ultimo: pUltimo },
  };
}

let ricordo: { scade: number; valore: StatoRestohub } | null = null;

/** Il riassunto. Rifatto al massimo una volta al minuto: l'admin chiede ogni cinque. */
export async function statoRestohub(): Promise<StatoRestohub> {
  if (ricordo && ricordo.scade > Date.now()) return ricordo.valore;
  const [sedi, m, g, s, a] = await Promise.all([
    provaA(async () => (await elencoSedi()).length),
    provaA(migrazioni),
    provaA(giri),
    provaA(stripe),
    provaA(attivita),
  ]);
  const valore: StatoRestohub = {
    v: VERSIONE_STATO,
    ora: new Date().toISOString(),
    motore: {
      avviato: AVVIATO,
      costruito: costruito(),
      migrazioniCodice: MIGRAZIONI.length,
      ultimaCodice: MIGRAZIONI.at(-1)?.numero ?? 0,
    },
    sedi,
    migrazioni: m,
    giri: g,
    stripe: s,
    attivita: a,
  };
  ricordo = { scade: Date.now() + 60_000, valore };
  return valore;
}
