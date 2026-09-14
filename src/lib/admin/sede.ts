import { supabaseAdmin } from "../db";
import { cacheOr, cacheDel } from "../cache";
import {
  CHIESTA_TUTTE,
  SEDE_UNICA as SEDE_UNICA_,
  sede as sede_,
  appartenenzaDi,
  sedeDaScrivere,
  applicaFiltro,
  scegliSede,
  type Ambito,
} from "./sedeRegole";
import type { StaffUser } from "./adminAuth";

export {
  SEDE_UNICA,
  CHIESTA_TUTTE,
  tutteLeSedi,
  sede,
  appartenenzaDi,
  filtroPer,
  applicaFiltro,
  sedeDaScrivere,
  scegliSede,
  NESSUNA_SEDE,
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
  /** Foto della sede: la pastiglia dell'header la mostra, e senza ripiega
   *  sulle iniziali. */
  image_url: string | null;
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
        .select("id, name, slug, active, image_url")
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

/** Nome del cookie in cui l'header scrive la sede selezionata.
 *  ⚠️ Si scrive con `Path=/`, non `/admin`: le pagine stanno sotto /admin ma
 *  le API sotto /api/admin, e un cookie di /admin a /api/admin non arriva. */
export const COOKIE_SEDE = "mdd_sede";
/** Header equivalente, per le chiamate fatte dal JS dell'admin. */
export const HEADER_SEDE = "x-sede";

/** La sede CHIESTA dalla richiesta: header se c'è, altrimenti cookie.
 *  E' solo una richiesta — chi decide se vale è `scegliSede`. */
function sedeChiestaDa(request: Request): string | null {
  const h = request.headers.get(HEADER_SEDE);
  if (h) return h.trim();
  const cookie = request.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_SEDE}=([^;]*)`).exec(cookie);
  const v = m ? decodeURIComponent(m[1]).trim() : null;
  // ⚠️ L'AGGREGATO NON SI RICORDA. «tutte» vale solo se arriva nell'header
  // `x-sede`, cioe' chiesto da UNA richiesta — il filtro di un elenco o di una
  // statistica. Nel cookie non deve valere: sarebbe un contesto globale in cui
  // meta' dell'applicazione non puo' creare niente, e in cui basta un cookie
  // vecchio per restarci incastrati. Se ce lo si trova, si ignora.
  return v === CHIESTA_TUTTE ? null : v;
}

/**
 * L'ambito di una richiesta: da qui passano tutte le letture dell'admin.
 *
 * La sede dell'utente arriva dalla SESSIONE — `app_metadata.location_id`,
 * dentro il JWT firmato — e il browser non può cambiarla. Quella selezionata
 * nell'header viaggia invece in un cookie, ed è una *richiesta*: vale solo
 * per chi ha diritto di vedere più sedi, e solo se esiste davvero.
 *
 * La decisione sta in `scegliSede()`, che è pura e ha i suoi test.
 */
export async function ambitoDiRichiesta(
  request: Request,
  staff: StaffUser | null,
): Promise<Ambito> {
  const [multi, sedi] = await Promise.all([multiSedeAttivo(), elencoSedi()]);
  return scegliSede({
    multiAttivo: multi,
    sedi: sedi.map((s) => s.id),
    sedeUtente: staff?.location_id ?? null,
    sedeChiesta: sedeChiestaDa(request),
  });
}

/**
 * L'ambito per una richiesta PUBBLICA (sito, slot, checkout).
 *
 * ⚠️ SEGNAPOSTO, da sostituire al pezzo 8. Il sito pubblico dira' quale
 * punto scegliendo dallo slug nell'URL; finche' quel lavoro non c'e', un
 * cliente multi-sede vede il PRIMO punto. E' deterministico e sbagliato in
 * modo visibile — mostra sempre lo stesso — invece che silenzioso e sbagliato
 * in modo variabile, che e' quello che succederebbe lasciando `SEDE_UNICA`:
 * li' `special_days` e' «mista», il filtro sparisce, e la chiusura di un
 * punto chiuderebbe anche gli altri.
 *
 * Per i quattro clienti a sede unica rende `SEDE_UNICA`, cioe' niente filtro,
 * cioe' esattamente il comportamento di oggi.
 */
export async function ambitoPubblico(): Promise<Ambito> {
  if (!(await multiSedeAttivo())) return SEDE_UNICA_;
  const sedi = await elencoSedi();
  if (sedi.length === 0) return SEDE_UNICA_;
  return sede_(sedi[0].id);
}

/** Le sedi che questo utente può vedere. Una sola se è legato a una sede,
 *  tutte altrimenti. Serve all'header per sapere se mostrare il selettore. */
export async function sediVisibili(staff: StaffUser | null): Promise<Sede[]> {
  if (!(await multiSedeAttivo())) return [];
  const sedi = await elencoSedi();
  const sua = staff?.location_id ?? null;
  return sua ? sedi.filter((s) => s.id === sua) : sedi;
}

// ============================================================
// Letture e scritture: tutto passa da qui
// ============================================================

// ⚠️ I TIPI DEL COSTRUTTORE DI QUERY.
//
// `applicaFiltro` lavora su un'interfaccia ridotta (`Query`: solo `eq` e
// `or`), apposta, per poterla provare nei test con un costruttore finto. Ma
// se le funzioni qui sotto rendessero QUELLA, il tipo vero si perderebbe e
// `data` diventerebbe `any` in cinquantacinque file — cioe' niente controlli
// proprio dove il filtro di sede puo' sbagliare.
//
// Quindi si dichiara il tipo di ritorno uguale a quello vero. E si ricava da
// CHIAMATE CAMPIONE, non da `ReturnType<typeof supabaseAdmin.from>`:
// quest'ultimo risolve il generico al suo vincolo e rende un costruttore in
// cui `data` e' `unknown` — provato, e peggiora le cose invece di
// sistemarle. Le funzioni qui sotto non vengono mai eseguite: esistono solo
// perche' `typeof` possa guardarle.
//
// ⚠️ E il nome della tabella e' una VARIABILE, non una stringa scritta li'.
// Il test «ogni tabella letta nel codice e' classificata» scandisce `src/`
// cercando `.from("...")`: con un nome finto scritto a mano lo troverebbe e
// chiederebbe di classificare una tabella che non esiste. Il test ha
// ragione — e' il codice campione che non deve sembrare una lettura vera.
const TABELLA_CAMPIONE = "nessuna";
function _qLettura() { return supabaseAdmin.from(TABELLA_CAMPIONE).select("*"); }
function _qInserimento() { return supabaseAdmin.from(TABELLA_CAMPIONE).insert({}); }
function _qAggiornamento() { return supabaseAdmin.from(TABELLA_CAMPIONE).update({}); }
function _qCancellazione() { return supabaseAdmin.from(TABELLA_CAMPIONE).delete(); }
function _qSalvataggio() { return supabaseAdmin.from(TABELLA_CAMPIONE).upsert({}, { onConflict: "k" }); }
type QLettura = ReturnType<typeof _qLettura>;
type QInserimento = ReturnType<typeof _qInserimento>;
type QAggiornamento = ReturnType<typeof _qAggiornamento>;
type QCancellazione = ReturnType<typeof _qCancellazione>;
type QSalvataggio = ReturnType<typeof _qSalvataggio>;

/** SELECT con il filtro di sede gia' applicato. Si continua a concatenare
 *  `.eq()`, `.order()`, `.range()` come sempre. */
export function leggi(tabella: string, ambito: Ambito, campi = "*"): QLettura {
  return applicaFiltro(
    supabaseAdmin.from(tabella).select(campi) as never,
    tabella,
    ambito,
  ) as unknown as QLettura;
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
  return supabaseAdmin.from(tabella).insert(corpo as never) as QInserimento;
}

/**
 * UPSERT con `location_id` impostato E con la chiave di conflitto giusta.
 *
 * ⚠️ Esiste per una ragione precisa. La migrazione #73 ha sostituito i vincoli
 * unici a due colonne (`date, service_key`) con indici a TRE
 * (`location_id, date, service_key`, `nulls not distinct`). Da quel momento un
 * `onConflict: "date,service_key"` non trova piu' nessun vincolo e Postgres
 * risponde «there is no unique or exclusion constraint matching»: il
 * salvataggio della chiusura muore. Tenendo la regola qui, la chiave si
 * costruisce in un posto solo e non si puo' dimenticare in uno dei due file.
 *
 * `chiave` sono le colonne SENZA `location_id`: ce lo mette questa funzione,
 * e solo dove la tabella non e' del marchio.
 */
export function salva<T extends Record<string, unknown>>(
  tabella: string,
  ambito: Ambito,
  righe: T | T[],
  chiave: string,
  condivisa = false,
) {
  const location_id = sedeDaScrivere(tabella, ambito, condivisa);
  const diMarchio = appartenenzaDi(tabella) === "marchio";
  const conSede = (r: T) => (diMarchio ? r : { ...r, location_id });
  const corpo = Array.isArray(righe) ? righe.map(conSede) : conSede(righe);
  const onConflict = diMarchio ? chiave : `location_id,${chiave}`;
  return supabaseAdmin.from(tabella).upsert(corpo as never, { onConflict }) as QSalvataggio;
}

/** UPDATE limitato alla sede: anche passando l'id di una riga di un altro
 *  punto, il filtro fa si' che non venga toccata. */
export function aggiorna(
  tabella: string,
  ambito: Ambito,
  campi: Record<string, unknown>,
): QAggiornamento {
  return applicaFiltro(
    supabaseAdmin.from(tabella).update(campi as never) as never,
    tabella,
    ambito,
  ) as unknown as QAggiornamento;
}

/** DELETE limitato alla sede, per lo stesso motivo dell'UPDATE. Qui conta
 *  il doppio: una cancellazione sbagliata non si vede e non si annulla. */
export function cancella(tabella: string, ambito: Ambito): QCancellazione {
  return applicaFiltro(
    supabaseAdmin.from(tabella).delete() as never,
    tabella,
    ambito,
  ) as unknown as QCancellazione;
}

// ============================================================
// CONFIGURAZIONE — ogni sede ha la sua
// ============================================================
//
// `app_config` sono i valori dell'INSTALLAZIONE; `location_config` ha la
// stessa forma (chiave/valore) e contiene quelli della sede. In lettura si
// sovrappongono, e serve a una cosa sola: una sede che non ha ancora salvato
// niente parte con i valori dell'installazione gia' scritti nei campi,
// invece che con un modulo vuoto.
//
// In SCRITTURA non c'e' nessuna sovrapposizione: con una sede selezionata
// tutto quello che si salva e' suo. Vedi `scriviConfig`.
//
// ⚠️ Una chiave scritta male non esplode: **ricade** sul valore
// dell'installazione. `company_steet` non da' errore, rende l'indirizzo di
// un altro. Per questo chi scrive deve passare da una lista chiusa di chiavi
// (`CHIAVI_GENERAL` e compagne in `settings.ts`), non da quello che arriva
// nel corpo della richiesta.

export interface Config {
  /** Quello che vale qui: i valori della sede, e dove non ce ne sono ancora,
   *  quelli dell'installazione. */
  valori: Map<string, string>;
  /** Solo l'installazione. */
  marchio: Map<string, string>;
  /** Le chiavi che questa sede ha gia' scritto di suo. */
  sovrascritte: Set<string>;
}

export async function leggiConfig(ambito: Ambito, chiavi: string[]): Promise<Config> {
  const marchio = new Map<string, string>();
  const valori = new Map<string, string>();
  const sovrascritte = new Set<string>();
  if (chiavi.length === 0) return { valori, marchio, sovrascritte };

  const { data: base } = await supabaseAdmin
    .from("app_config")
    .select("key, value")
    .in("key", chiavi);
  for (const r of base ?? []) marchio.set(r.key, String(r.value ?? ""));
  for (const [k, v] of marchio) valori.set(k, v);

  // I valori della sede si leggono SOLO guardando una sede precisa.
  // Con "tutte" o "unica" non si legge `location_config` affatto: senza
  // filtro renderebbe le righe di tutte le sedi mescolate, e l'ultima che
  // arriva vincerebbe. Meglio niente che un valore a caso.
  if (ambito.modo !== "sede") return { valori, marchio, sovrascritte };

  try {
    const { data: extra } = await supabaseAdmin
      .from("location_config")
      .select("key, value")
      .eq("location_id", ambito.id)
      .in("key", chiavi);
    for (const r of extra ?? []) {
      valori.set(r.key, String(r.value ?? ""));
      sovrascritte.add(r.key);
    }
  } catch {
    // Migrazione #73 non lanciata: si vede il marchio, come prima.
  }
  return { valori, marchio, sovrascritte };
}

/**
 * Scrive la configurazione nel posto giusto per l'ambito.
 *
 * - `unica` / `tutte` → `app_config`: e' il valore del MARCHIO.
 * - `sede` → `location_config`, ma **solo se diverso da quello del marchio**.
 *   Se coincide, l'eccezione si CANCELLA e la sede torna a ereditare.
 *
 * ⚠️ Quest'ultima regola non e' un'ottimizzazione. Senza, il primo
 * salvataggio in una sede copierebbe tutti i valori del marchio in righe
 * sue: da quel momento cambiare il valore del marchio non arriverebbe piu'
 * a nessuno, e nessuno capirebbe perche'. Le copie identiche sono il modo
 * in cui l'ereditarieta' muore in silenzio.
 */
/** A che livello vive un gruppo di impostazioni. Lo decide la SCHEDA che le
 *  contiene, una volta, nel codice — non l'utente campo per campo. */
export type Livello = "sede" | "gruppo";

export async function scriviConfig(
  ambito: Ambito,
  coppie: Record<string, string>,
  livello: Livello = "sede",
): Promise<string | null> {
  const chiavi = Object.keys(coppie);
  if (chiavi.length === 0) return null;

  // Sede unica, o roba che vale per tutto il gruppo: `app_config`.
  if (livello === "gruppo" || ambito.modo !== "sede") {
    const righe = chiavi.map((key) => ({ key, value: coppie[key] }));
    const { error } = await supabaseAdmin.from("app_config").upsert(righe, { onConflict: "key" });
    return error ? error.message : null;
  }

  // Livello «sede»: con una sede selezionata tutto quello che si salva e' suo.
  //
  // ⚠️ La scelta sta nella SCHEDA, non nel campo (deciso 14/09/2026). Si era
  // provata la strada del campo — condiviso per difetto, con una catena
  // cliccabile accanto a ogni etichetta — e non regge: un gruppo puo' avere
  // tre nomi, tre loghi e tre identita' diverse, quindi non esiste nessun
  // elenco di «campi che valgono di sicuro per tutti» che sia vero anche per
  // il cliente dopo. La SCHEDA invece si sa cosa contiene: gli orari sono di
  // un posto fisico, i link sono di un sito, e quello non cambia da cliente a
  // cliente. Una decisione presa una volta nel codice, non una domanda fatta
  // all'utente dieci volte.
  //
  // `app_config` resta i valori dell'INSTALLAZIONE: `leggiConfig` li mostra
  // come punto di partenza a una sede che non ha ancora salvato niente.
  const righe = chiavi.map((key) => ({ location_id: ambito.id, key, value: coppie[key] }));
  const { error } = await supabaseAdmin
    .from("location_config")
    .upsert(righe, { onConflict: "location_id,key" });
  return error ? error.message : null;
}

// ============================================================
// ORARI SETTIMANALI — la riga sovrascrive il GIORNO INTERO
// ============================================================
//
// `settings` ha `day_of_week` come chiave naturale, quindi la variante per
// sede non puo' stare nella stessa tabella: vive in `location_settings`, con
// le stesse colonne.
//
// ⚠️ L'unita' di sovrascrittura e' il GIORNO, non il campo. Una riga per il
// martedi' della sede vince su tutto il martedi' dell'installazione — non si
// mescolano il pranzo di uno e la cena dell'altra. Mescolare darebbe orari
// che nessuno ha mai scritto, e nessuno saprebbe da dove vengono.
//
// Riga assente = vale il giorno dell'installazione.

export interface Orario {
  day_of_week: number;
  lunch_active: boolean;
  lunch_open: string | null;
  lunch_close: string | null;
  dinner_active: boolean;
  dinner_open: string | null;
  dinner_close: string | null;
  prep_time_minutes: number;
  slot_duration_minutes: number;
  exceptional_closures?: unknown;
}

const CAMPI_ORARIO =
  "day_of_week, lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, " +
  "dinner_close, prep_time_minutes, slot_duration_minutes, exceptional_closures";

/** I sette giorni che valgono QUI: quelli dell'installazione, e dove la sede
 *  ha scritto il suo, il suo. In ordine da domenica (0) a sabato (6). */
export async function leggiOrari(ambito: Ambito): Promise<Orario[]> {
  const { data, error } = await supabaseAdmin
    .from("settings")
    .select(CAMPI_ORARIO)
    .order("day_of_week", { ascending: true });
  if (error || !data) throw new Error("settings illeggibili");
  const giorni = new Map<number, Orario>((data as unknown as Orario[]).map((r) => [r.day_of_week, r]));

  if (ambito.modo === "sede") {
    try {
      const { data: suoi } = await supabaseAdmin
        .from("location_settings")
        .select(CAMPI_ORARIO)
        .eq("location_id", ambito.id);
      for (const r of (suoi ?? []) as unknown as Orario[]) giorni.set(r.day_of_week, r);
    } catch {
      // Migrazione #73 non lanciata: valgono gli orari dell'installazione.
    }
  }
  return [...giorni.values()].sort((a, b) => a.day_of_week - b.day_of_week);
}

/** Salva i giorni passati. Con una sede selezionata diventano suoi; a sede
 *  unica si aggiorna `settings`, come e' sempre stato. */
export async function scriviOrari(
  ambito: Ambito,
  righe: (Orario & { location_id?: string })[],
): Promise<string | null> {
  if (righe.length === 0) return null;

  if (ambito.modo !== "sede") {
    for (const r of righe) {
      const { day_of_week, ...campi } = r;
      const { error } = await supabaseAdmin
        .from("settings")
        .update(campi)
        .eq("day_of_week", day_of_week);
      if (error) return error.message;
    }
    return null;
  }

  const conSede = righe.map((r) => ({ ...r, location_id: ambito.id }));
  const { error } = await supabaseAdmin
    .from("location_settings")
    .upsert(conSede, { onConflict: "location_id,day_of_week" });
  return error ? error.message : null;
}

/**
 * Crea i sette giorni della sede copiandoli dall'installazione, se non ci
 * sono ancora.
 *
 * ⚠️ Serve ai salvataggi PARZIALI — il bottone del tempo di preparazione in
 * Commandes tocca un campo solo. Senza righe da aggiornare quel bottone non
 * scriverebbe niente e non direbbe niente: il ristoratore lo preme, vede il
 * tempo cambiare sullo schermo, e al reload e' tornato come prima.
 *
 * Il salvataggio completo di Horaires non ne ha bisogno: manda tutti e sette
 * i giorni e li scrive comunque.
 */
export async function assicuraOrariSede(ambito: Ambito): Promise<string | null> {
  if (ambito.modo !== "sede") return null;
  const { data: suoi } = await supabaseAdmin
    .from("location_settings")
    .select("day_of_week")
    .eq("location_id", ambito.id);
  const gia = new Set((suoi ?? []).map((r) => r.day_of_week as number));
  if (gia.size >= 7) return null;

  const { data: base, error } = await supabaseAdmin
    .from("settings")
    .select(CAMPI_ORARIO);
  if (error || !base) return error?.message ?? "settings illeggibili";
  const mancanti = (base as unknown as Orario[])
    .filter((r) => !gia.has(r.day_of_week))
    .map((r) => ({ ...r, location_id: ambito.id }));
  if (mancanti.length === 0) return null;
  const { error: e2 } = await supabaseAdmin
    .from("location_settings")
    .upsert(mancanti, { onConflict: "location_id,day_of_week" });
  return e2 ? e2.message : null;
}
