import { supabaseAdmin } from "../db";
import { cacheOr, cacheDel } from "../cache";
import {
  appartenenzaDi,
  sedeDaScrivere,
  applicaFiltro,
  sede,
  SEDE_UNICA,
  type Ambito,
} from "./sedeRegole";

export {
  SEDE_UNICA,
  tutteLeSedi,
  sede,
  appartenenzaDi,
  filtroPer,
  sedeDaScrivere,
  CLASSIFICA,
  type Ambito,
  type Appartenenza,
} from "./sedeRegole";

/**
 * MULTI-SEDE — IL PUNTO UNICO DI LETTURA.
 *
 * Ogni lettura e ogni scrittura dell'admin passa da qui. Non e' una
 * convenzione da ricordare: `leggi()` restituisce una query che il filtro
 * ce l'ha GIA' dentro, e non esiste un modo di ottenerla senza.
 *
 * ⚠️ Perche' serve tanta disciplina: `supabaseAdmin` usa la service role
 * key e **scavalca la RLS**. Sotto al codice non c'e' nessuna rete di
 * sicurezza. E un filtro dimenticato non da' errore — da' le righe di
 * un'altra societa'. E' il contrario del guasto di Astro 7, che almeno
 * faceva morire la pagina.
 *
 * Le regole (quale tabella e' di chi) stanno in `sedeRegole.ts`, che non
 * importa niente e si prova con dei test senza database.
 */

const CACHE_MULTI = "sede:multi";
const CACHE_SEDI = "sede:elenco";

export interface Sede {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

/** Interruttore `multi_location` in app_config. Assente o "off" = sede
 *  unica, che e' lo stato di tutti i clienti oggi. */
export async function multiSedeAttivo(): Promise<boolean> {
  return cacheOr(CACHE_MULTI, async () => {
    try {
      const { data } = await supabaseAdmin
        .from("app_config")
        .select("value")
        .eq("key", "multi_location")
        .maybeSingle();
      return String(data?.value ?? "").trim().toLowerCase() === "on";
    } catch {
      // Tabella o chiave assenti: sede unica. Mai "tutte", mai un errore
      // che lascia la pagina senza dati.
      return false;
    }
  });
}

/** Le sedi attive, in ordine. Vuoto = installazione a sede unica. */
export async function elencoSedi(): Promise<Sede[]> {
  return cacheOr(CACHE_SEDI, async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from("locations")
        .select("id, name, slug, active")
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error || !data) return [];
      return data as Sede[];
    } catch {
      return []; // migrazione #73 non ancora lanciata su questo cliente
    }
  });
}

/** Da chiamare dopo aver cambiato l'interruttore o le sedi. */
export function scordaSedi(): void {
  cacheDel(CACHE_MULTI);
  cacheDel(CACHE_SEDI);
}

/**
 * L'ambito di una richiesta. La sede arriva dalla SESSIONE — dal ruolo e
 * dalla sede dell'utente, che stanno in `app_metadata` e viaggiano firmate
 * dentro il JWT — **mai da un parametro mandato dal client**: quello lo
 * sceglie chi chiama, e chi chiama e' il browser.
 *
 * `sedeScelta` esiste per il proprietario, che le sedi le vede tutte e ne
 * seleziona una nell'header: si accetta SOLO se e' una sede vera e solo se
 * quell'utente ha diritto di vederla.
 */
export async function ambitoDi(opzioni: {
  /** `app_metadata.location_id` dell'utente: la SUA sede. Null = le vede tutte. */
  sedeUtente?: string | null;
  /** Sede selezionata nell'header, valida solo per chi le vede tutte. */
  sedeScelta?: string | null;
}): Promise<Ambito> {
  if (!(await multiSedeAttivo())) return SEDE_UNICA;

  const sedi = await elencoSedi();
  if (sedi.length === 0) return SEDE_UNICA; // acceso ma nessuna sede: nulla da separare

  const sua = opzioni.sedeUtente ?? null;
  if (sua) {
    // Utente legato a una sede: la sua, sempre. Una `sedeScelta` diversa
    // viene ignorata — e' esattamente il tentativo da cui ci si difende.
    const valida = sedi.find((s) => s.id === sua);
    return valida ? sede(valida.id) : SEDE_UNICA;
  }

  const scelta = opzioni.sedeScelta ?? null;
  const trovata = scelta ? sedi.find((s) => s.id === scelta) : undefined;
  // Proprietario senza scelta: la prima sede, non l'aggregato. L'aggregato
  // si chiede con `tutteLeSedi()` e si vede nel codice.
  return sede((trovata ?? sedi[0]).id);
}

// ============================================================
// Letture e scritture: tutto passa da qui
// ============================================================

/** SELECT con il filtro di sede gia' applicato. Si continua a concatenare
 *  `.eq()`, `.order()`, `.range()` come sempre. */
export function leggi(tabella: string, ambito: Ambito, campi = "*") {
  return applicaFiltro(supabaseAdmin.from(tabella).select(campi) as any, tabella, ambito);
}

/** INSERT con `location_id` gia' impostato secondo la regola della tabella.
 *  `condivisa` vale solo per le miste: e' la scelta «vale per tutte le sedi». */
export function inserisci<T extends Record<string, unknown>>(
  tabella: string,
  ambito: Ambito,
  righe: T | T[],
  condivisa = false
) {
  const location_id = sedeDaScrivere(tabella, ambito, condivisa);
  const conSede = (r: T) => (appartenenzaDi(tabella) === "marchio" ? r : { ...r, location_id });
  const corpo = Array.isArray(righe) ? righe.map(conSede) : conSede(righe);
  return supabaseAdmin.from(tabella).insert(corpo as any);
}

/** UPDATE limitato alla sede: anche passando l'id di una riga di un altro
 *  punto, il filtro fa si' che non venga toccata. */
export function aggiorna(tabella: string, ambito: Ambito, campi: Record<string, unknown>) {
  return applicaFiltro(supabaseAdmin.from(tabella).update(campi) as any, tabella, ambito);
}

/** DELETE limitato alla sede, per lo stesso motivo dell'UPDATE. Qui conta
 *  il doppio: una cancellazione sbagliata non si vede e non si annulla. */
export function cancella(tabella: string, ambito: Ambito) {
  return applicaFiltro(supabaseAdmin.from(tabella).delete() as any, tabella, ambito);
}
