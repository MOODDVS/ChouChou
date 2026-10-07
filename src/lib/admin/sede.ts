import { supabaseAdmin } from "../db";
import { cacheOr, cacheDel, cacheDelPrefisso } from "../cache";
import { decifra } from "../segreti";
import {
  CHIESTA_TUTTE,
  SEDE_UNICA as SEDE_UNICA_,
  sede as sede_,
  appartenenzaDi,
  sedeDaScrivere,
  applicaFiltro,
  scegliSede,
  scegliSegreto,
  pagamentoOnlinePronto,
  type Ambito,
  type Fonte,
  sedeDettaDa,
  HEADER_SEDE,
  tabellaConfig,
  appartenenzaConfig,
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
  scegliSegreto,
  pagamentoOnlinePronto,
  SegretoIlleggibile,
  type Fonte,
  NESSUNA_SEDE,
  CLASSIFICA,
  CLASSIFICA_CONFIG,
  FAMIGLIE_CONFIG,
  appartenenzaConfig,
  configDiSede,
  tabellaConfig,
  type Ambito,
  type Appartenenza,
  type ApparCfg,
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

/**
 * ⚠️ L'INTERRUTTORE `multi_location` NON ESISTE PIU' (deciso 15/09/2026).
 *
 * Era un secondo asse che diceva la stessa cosa dell'elenco delle sedi, con
 * in piu' la possibilita' di contraddirla: tre sedi nel database e
 * l'interruttore spento voleva dire tre punti che il codice non separava —
 * e nessuno se ne accorgeva, perche' non dava errore. Ora la verita' e' una
 * sola ed e' `elencoSedi()`:
 *
 *   nessuna sede  -> nessun filtro (lo stato dei clienti non ancora migrati)
 *   una sede      -> tutto e' suo, e il selettore non compare
 *   due o piu'    -> si sceglie nell'header
 *
 * `multiSedeAttivo()` resta come SCORCIATOIA di lettura — «questa
 * installazione separa i dati?» — perche' si legge meglio di
 * `(await elencoSedi()).length > 0` sparso in giro. Ma non legge piu'
 * nessuna chiave: guarda le sedi.
 */
export async function multiSedeAttivo(): Promise<boolean> {
  return (await elencoSedi()).length > 0;
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

/** Da chiamare dopo aver creato, modificato o disattivato una sede: e'
 *  l'elenco che decide tutto, quindi la sua cache va buttata. */
export function scordaSedi(): void {
  cacheDel(CACHE_SEDI);
}

/** Nome del cookie in cui l'header scrive la sede selezionata.
 *  ⚠️ Si scrive con `Path=/`, non `/admin`: le pagine stanno sotto /admin ma
 *  le API sotto /api/admin, e un cookie di /admin a /api/admin non arriva. */
export const COOKIE_SEDE = "mdd_sede";
/** Header equivalente, per le chiamate fatte dal JS dell'admin. */
// `HEADER_SEDE` vive in `sedeRegole.ts` insieme alla regola che lo legge:
// qui si riesporta perche' l'admin lo importa da questo file da sempre.
export { HEADER_SEDE };

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
  const sedi = await elencoSedi();
  return scegliSede({
    sedi: sedi.map((s) => s.id),
    sedeUtente: staff?.location_id ?? null,
    sedeChiesta: sedeChiestaDa(request),
  });
}

/**
 * L'ambito per una richiesta PUBBLICA (sito, slot, checkout).
 *
 * ⚠️ NON E' PIU' IL PERCORSO NORMALE (dal 16/09/2026, pezzo 8). Ogni
 * endpoint pubblico passa da `ambitoPubblicoChiesto()`, e la richiesta dice
 * il suo punto. Questo resta il RIPIEGO per chi non dice niente: un sito a
 * punto unico — cioe' i quattro clienti di oggi, per i quali `elencoSedi()`
 * e' vuoto e qui si rende `SEDE_UNICA`, cioe' nessun filtro, cioe' esattamente
 * il comportamento di sempre.
 *
 * Su un'installazione multi-sede rende la PRIMA sede, e resta una scelta a
 * caso travestita da valore predefinito: se ci si finisce, vuol dire che
 * qualcuno ha dimenticato di dire da dove sta ordinando. E' comunque meglio
 * di `SEDE_UNICA`, che li' toglierebbe il filtro: `special_days` e' «mista»,
 * e la chiusura di un punto chiuderebbe anche gli altri due.
 *
 * Per i quattro clienti a sede unica rende `SEDE_UNICA`, cioe' niente filtro,
 * cioe' esattamente il comportamento di oggi.
 */
export async function ambitoPubblico(): Promise<Ambito> {
  const sedi = await elencoSedi();
  if (sedi.length === 0) return SEDE_UNICA_;
  return sede_(sedi[0].id);
}

/**
 * L'ambito pubblico quando CHI CHIAMA sa gia' di quale punto parla.
 *
 * Serve all'admin che interroga un endpoint pubblico: la tile «Evenements
 * locaux» della home chiede a `/api/reservation?month=` quali giorni sono
 * chiusi, e con `ambitoPubblico()` le risposte erano sempre della PRIMA
 * sede — con Stockel selezionato, il pallino «aperto/chiuso» diceva gli
 * orari di Schaerbeek. Nessun errore, solo un'informazione falsa.
 *
 * ⚠️ SOLO L'HEADER `x-sede`, MAI IL COOKIE. Il cookie della sede vive su
 * `Path=/` e quindi viaggia anche verso le pagine pubbliche: leggendolo qui,
 * un super admin che apre il sito vero si troverebbe a vedere gli orari
 * della sede che aveva selezionato nell'admin, e non capirebbe perche'. Una
 * richiesta dice quale punto vuole; non lo si indovina da quello che il
 * browser si porta dietro.
 *
 * ⚠️ E mai l'aggregato: «tutte le sedi» non e' un posto dove si prenota.
 *
 * Al pezzo 8 il sito pubblico passera' di qui con la sede del suo URL, e
 * `ambitoPubblico()` restera' il ripiego per chi non dice niente.
 */
export async function ambitoPubblicoChiesto(request: Request): Promise<Ambito> {
  const chiesta = sedeDettaDa(request);
  if (chiesta) {
    // ⚠️ Deve esistere ed essere ATTIVA (`elencoSedi` rende solo quelle).
    // Non e' un controllo di sicurezza — scegliere una pizzeria non e' un
    // privilegio — e' un controllo di sanita': un id storto qui vorrebbe dire
    // un ordine che non appartiene a nessuno. Non si trova: si ripiega.
    const sedi = await elencoSedi();
    if (sedi.some((s) => s.id === chiesta)) return sede_(chiesta);
  }
  return ambitoPubblico();
}

/**
 * L'AMBITO DI UNA RIGA CHE SI HA GIA' IN MANO.
 *
 * Serve dove l'evento non nasce da una richiesta dell'admin ma da un dato:
 * il webhook Stripe ha l'ordine, il cron ha la prenotazione. La sede non si
 * chiede al cookie, si legge dalla riga.
 *
 * ⚠️ `location_id` nullo rende `SEDE_UNICA`, cioe' NESSUN filtro — quindi la
 * notifica arriva a tutti. E' voluto: su un'installazione a sede unica e'
 * esatto, e in un gruppo una riga rimasta senza sede (storico non ancora
 * travasato) e' meglio che faccia squillare tre telefoni piuttosto che
 * nessuno. Un ordine non notificato e' un cliente che aspetta.
 */
export function ambitoDiRiga(location_id: string | null | undefined): Ambito {
  return location_id ? sede_(location_id) : SEDE_UNICA_;
}

/** Le sedi che questo utente può vedere. Una sola se è legato a una sede,
 *  tutte altrimenti. Serve all'header per sapere se mostrare il selettore.
 *
 *  ⚠️ Con UNA sede sola rende l'elenco vuoto, quindi il selettore non
 *  compare: un menu a tendina con una voce sola non e' una scelta, e'
 *  un elemento in piu' da capire. Il ristorante singolo non deve nemmeno
 *  accorgersi che il multi-sede esiste. */
export async function sediVisibili(staff: StaffUser | null): Promise<Sede[]> {
  const sedi = await elencoSedi();
  if (sedi.length <= 1) return [];
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
 *  `.eq()`, `.order()`, `.range()` come sempre.
 *
 *  `opzioni` e' quello di `.select()`: serve per CONTARE senza portarsi via
 *  le righe (`{ count: "exact", head: true }`). ⚠️ Passa da qui e non da un
 *  `supabaseAdmin.from(...)` scritto a mano: li' il filtro di sede non ci
 *  sarebbe, e un conteggio senza filtro e' il numero di TUTTE le sedi dato
 *  per quello di una — plausibile, e sbagliato. */
export function leggi(
  tabella: string,
  ambito: Ambito,
  campi = "*",
  opzioni?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
): QLettura {
  return applicaFiltro(
    supabaseAdmin.from(tabella).select(campi, opzioni) as never,
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
/**
 * ⚠️ NON c'e' piu' un parametro «livello» (tolto 20/09/2026). C'era, e i
 * chiamanti lo passavano a mano: i link social «gruppo», il fuso «gruppo»,
 * tutto il resto implicitamente «sede». Due sorgenti di verita' — il
 * chiamante e la natura della chiave — e chi aggiungeva un campo doveva
 * indovinare quale valesse. Adesso decide `CLASSIFICA_CONFIG`, una volta.
 */
export async function scriviConfig(
  ambito: Ambito,
  coppie: Record<string, string>,
): Promise<string | null> {
  const chiavi = Object.keys(coppie);
  if (chiavi.length === 0) return null;

  // ⚠️ Ogni chiave passa da `appartenenzaConfig`, che LANCIA se non e'
  // dichiarata in CLASSIFICA_CONFIG. Sembra severo per una scrittura, ma e'
  // il solo momento in cui qualcuno sta guardando: da qui in poi la chiave
  // vive in una tabella e nessuno si chiede piu' se vada letta con un ambito.
  for (const k of chiavi) appartenenzaConfig(k);

  // Sede unica (o aggregato): non esiste nessun `location_config` in cui
  // scrivere, tutto va nel valore dell'installazione.
  if (ambito.modo !== "sede") {
    const righe = chiavi.map((key) => ({ key, value: coppie[key] }));
    const { error } = await supabaseAdmin.from("app_config").upsert(righe, { onConflict: "key" });
    return error ? error.message : null;
  }

  // Con una sede selezionata NON tutto quello che si salva e' suo: la lingua
  // dell'admin, il tema, le lingue pubbliche sono dell'installazione. Chi le
  // rilegge (adminBoot) non passa nessun ambito — se finissero in
  // `location_config` verrebbero scritte e non lette mai piu'. Silenzioso.
  const diSede = chiavi.filter((k) => tabellaConfig(k, ambito) === "location_config");
  const diMarchio = chiavi.filter((k) => !diSede.includes(k));
  if (diMarchio.length) {
    const righe = diMarchio.map((key) => ({ key, value: coppie[key] }));
    const { error } = await supabaseAdmin.from("app_config").upsert(righe, { onConflict: "key" });
    if (error) return error.message;
  }
  if (diSede.length === 0) return null;

  // Quello che resta e' DI QUESTA SEDE.
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
  const righe = diSede.map((key) => ({ location_id: ambito.id, key, value: coppie[key] }));
  const { error } = await supabaseAdmin
    .from("location_config")
    .upsert(righe, { onConflict: "location_id,key" });
  return error ? error.message : null;
}

/**
 * Toglie l'ECCEZIONE di una o piu' chiavi per questa sede: la riga sparisce da
 * `location_config` e la sede torna a leggere il valore del marchio.
 *
 * ⚠️ Serve perche' `scriviConfig(ambito, { k: "" })` NON vuol dire questo.
 * Scrive un'eccezione VUOTA, che `leggiConfig` conta come override e che chi
 * legge risolve sull'.env: ne' il marchio, ne' un errore. Sono due cose
 * diverse e servono entrambe — «questo punto non manda email a nessuno» e
 * «questo punto fa come il gruppo» — e finora la seconda non si poteva dire:
 * in `location_config` non c'era nessuna cancellazione, quindi una sede che
 * aveva salvato una volta non tornava piu' a ereditare.
 *
 * Con `unica` / `tutte` non fa niente, e non e' un errore: non esiste nessuna
 * eccezione da togliere, il valore del marchio E' il valore.
 */
export async function cancellaConfig(ambito: Ambito, chiavi: string[]): Promise<string | null> {
  if (chiavi.length === 0 || ambito.modo !== "sede") return null;
  // Stessa severita' di `scriviConfig`: una chiave non dichiarata in
  // CLASSIFICA_CONFIG lancia qui, il solo momento in cui qualcuno guarda.
  for (const k of chiavi) appartenenzaConfig(k);
  const diSede = chiavi.filter((k) => tabellaConfig(k, ambito) === "location_config");
  if (diSede.length === 0) return null;
  const { error } = await supabaseAdmin
    .from("location_config")
    .delete()
    .eq("location_id", ambito.id)
    .in("key", diSede);
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

// ============================================================
// SEGRETI DELLA SEDE — le chiavi con cui si incassa
// ============================================================
//
// Tre pizzerie, tre societa', tre conti Stripe, UN solo deploy: nel `.env`
// ci sta una chiave sola, quindi le altre due devono stare da qualche parte
// che sappia distinguerle. Stanno in `location_secrets`, cifrate (vedi
// `segreti.ts`), una riga per (sede, chiave).
//
// ⚠️ SEDE ASSENTE O RIGA ASSENTE = SI RIPIEGA SULL'AMBIENTE. Non e' una
// comodita': e' il comportamento dei quattro clienti a sede unica di oggi,
// che continuano a pagare con la chiave nel loro `.env` senza che nessuno
// tocchi niente. E resta anche il paracadute di un gruppo: una sede a cui
// non hanno ancora messo la chiave incassa sul conto del `.env` invece di
// mostrare un errore di pagamento al cliente davanti alla cassa.
//
// ⚠️⚠️ E' IL DATO A DECIDERE IL CONTO, NON LA RICHIESTA. Il rimborso di un
// ordine deve uscire dal conto che l'ha incassato, cioe' dalla sede scritta
// NELLA RIGA (`ambitoDiRiga(ordine.location_id)`) — non dalla sede
// selezionata nell'header di chi sta guardando. Sono due cose che quasi
// sempre coincidono, e il giorno che non coincidono ci sono dei soldi che
// escono dal conto sbagliato di una societa' che non c'entra.

/** Le chiavi che possono vivere per sede. Elenco chiuso: l'API dei segreti
 *  non ne accetta altre, e ogni voce ha il suo ripiego nell'ambiente. */
export const CHIAVI_SEGRETE = ["stripe_secret_key", "stripe_webhook_secret"] as const;

// Il ripiego nell'ambiente, chiave per chiave. ⚠️ Scritte per esteso, non
// costruite con `import.meta.env[nome]`: Vite sostituisce `import.meta.env.X`
// guardando il testo, e un accesso calcolato non lo sostituisce affatto —
// renderebbe `undefined` nel build, cioe' pagamenti che funzionano in `dev` e
// non in produzione. `process.env` regge l'accesso calcolato e fa da rete.
const DA_AMBIENTE: Record<string, string | undefined> = {
  stripe_secret_key: import.meta.env.STRIPE_SECRET_KEY,
  stripe_webhook_secret: import.meta.env.STRIPE_WEBHOOK_SECRET,
};

/** ⚠️ Esportata, ma solo per chiedere SE il ripiego esiste (`!== ""`). Il
 *  valore non deve uscire da qui: il pannello Sedi mostra lo stato, non le
 *  chiavi. */
export function segretoDAmbiente(chiave: string): string {
  const scritto = DA_AMBIENTE[chiave];
  if (scritto) return String(scritto).trim();
  return String(process.env[chiave.toUpperCase()] ?? "").trim();
}

const CACHE_SEGRETO = "sede:segreto";

/**
 * Il valore di un segreto QUI: quello della sede se c'e', altrimenti quello
 * dell'ambiente. Rende `""` se non c'e' ne' l'uno ne' l'altro — chi chiama
 * decide se e' un errore (incassare) o no (verificare una firma).
 *
 * La cache dura quanto le altre (60 s) e si butta scrivendo: una chiave
 * ruotata deve valere subito, non dopo mezzo minuto di pagamenti falliti.
 *
 * ⚠️⚠️ RIGA ASSENTE E RIGA ILLEGGIBILE NON SONO LA STESSA COSA, e la prima
 * versione di questa funzione le trattava uguale (corretto il 15/09/2026,
 * prima di andare in produzione).
 *
 *   assente    = nessuno ha configurato questa sede -> vale l'ambiente. E'
 *                una CONFIGURAZIONE, ed e' il caso dei clienti a sede unica.
 *   illeggibile = qualcuno ha messo una chiave qui, e non riusciamo a
 *                aprirla: `SECRETS_KEY` cambiata, backup ripristinato altrove,
 *                riga manomessa. E' un GUASTO.
 *
 * Ripiegare sull'ambiente nel secondo caso vuol dire incassare sul conto
 * sbagliato in silenzio — il pagamento riesce, il cliente e' contento, e i
 * soldi di una societa' finiscono su un'altra. Meglio un pagamento che si
 * rifiuta e un messaggio che dice cosa e' successo.
 */
/** Quello che c'e' scritto per QUESTA sede, gia' decifrato.
 *  `null` = nessuna riga. `""` = riga che non si apre. Due cose diverse, e
 *  la cache deve ricordarsi quale delle due. */
async function segretoDellaSede(ambito: Ambito, chiave: string): Promise<string | null> {
  if (ambito.modo !== "sede") return null;
  return cacheOr<string | null>(`${CACHE_SEGRETO}:${ambito.id}:${chiave}`, async () => {
    try {
      const { data } = await supabaseAdmin
        .from("location_secrets")
        .select("value")
        .eq("location_id", ambito.id)
        .eq("key", chiave)
        .maybeSingle();
      if (!data) return null;
      return decifra(String((data as { value?: unknown }).value ?? ""));
    } catch {
      return null; // migrazione #73 non lanciata: vale l'ambiente
    }
  });
}

export async function leggiSegreto(ambito: Ambito, chiave: string): Promise<string> {
  if (ambito.modo !== "sede") return segretoDAmbiente(chiave);
  // La regola sta in `sedeRegole.ts`, pura e con i suoi test.
  return scegliSegreto(await segretoDellaSede(ambito, chiave), segretoDAmbiente(chiave), chiave);
}

/**
 * DA DOVE viene il segreto che si userebbe qui — non quanto vale.
 *
 * Serve a decidere se mostrare o no il link di pagamento: li' non interessa
 * la chiave, interessa se le due meta' di un conto Stripe vengono dallo
 * stesso posto. Una riga che non si apre rende "nessuna": non e' una chiave
 * su cui si possa incassare.
 */
export async function fonteSegreto(ambito: Ambito, chiave: string): Promise<Fonte> {
  const suo = await segretoDellaSede(ambito, chiave);
  if (suo) return "sede";
  if (suo === "") return "nessuna"; // riga presente e illeggibile: rotta
  return segretoDAmbiente(chiave) ? "ambiente" : "nessuna";
}

/** Si puo' offrire un link di pagamento in questa sede? Vedi la nota lunga
 *  su `pagamentoOnlinePronto` in `sedeRegole.ts`. */
export async function pagamentoOnlineAttivo(ambito: Ambito): Promise<boolean> {
  const [chiave, firma] = await Promise.all([
    fonteSegreto(ambito, "stripe_secret_key"),
    fonteSegreto(ambito, "stripe_webhook_secret"),
  ]);
  return pagamentoOnlinePronto(chiave, firma);
}

/**
 * Lo stesso segreto per OGNI sede che ce l'ha, con l'ambiente in testa.
 *
 * Serve al webhook di Stripe, che e' il caso rovesciato: la firma va
 * verificata PRIMA di poter leggere il corpo, quindi non si sa ancora di
 * quale sede sia l'evento. Si prova ogni chiave di firma: quella che
 * verifica dice anche da quale conto arriva. Sono tre HMAC su qualche
 * migliaio di byte — meno di un millisecondo.
 */
export async function segretiDOgniSede(
  chiave: string,
): Promise<{ ambito: Ambito; valore: string }[]> {
  const fuori: { ambito: Ambito; valore: string }[] = [];
  const amb = segretoDAmbiente(chiave);
  if (amb) fuori.push({ ambito: SEDE_UNICA_, valore: amb });
  for (const s of await elencoSedi()) {
    // ⚠️ Una sede illeggibile non ferma le altre. Qui si sta verificando la
    // firma di un evento gia' arrivato: far morire tutto vorrebbe dire che
    // la chiave rotta di UNA sede blocca gli ordini di tutte e tre.
    let v = "";
    try {
      v = await leggiSegreto(sede_(s.id), chiave);
    } catch (e) {
      console.error(`[segreti] sede ${s.id}:`, e instanceof Error ? e.message : e);
      continue;
    }
    // Senza riga sua `leggiSegreto` rende l'ambiente: gia' in elenco.
    if (v && v !== amb) fuori.push({ ambito: sede_(s.id), valore: v });
  }
  return fuori;
}

/** Da chiamare dopo aver scritto o cancellato un segreto. */
export function scordaSegreti(sedeId?: string): void {
  cacheDelPrefisso(sedeId ? `${CACHE_SEGRETO}:${sedeId}` : CACHE_SEGRETO);
}

/**
 * L'AMBITO DI UNA RIGA CHE SI HA SOLO PER ID.
 *
 * Gemella di `ambitoDiRiga`, per quando il `location_id` non ce l'hai gia'
 * in mano: lo va a leggere. Serve dove la lettura principale era stata
 * scritta prima delle sedi e non seleziona quella colonna — il rimborso,
 * l'annullo, il supplemento — e dove riscrivere la SELECT vorrebbe dire
 * romperla sui clienti che non hanno ancora lanciato la migrazione #73.
 *
 * ⚠️ Riga assente, colonna assente o errore rendono `SEDE_UNICA`, cioe' il
 * valore dell'ambiente. E' il ripiego giusto: su un'installazione a sede
 * unica e' esatto, e altrove e' il conto storico — quello su cui quell'ordine
 * e' stato incassato prima che le sedi esistessero.
 */
export async function cercaAmbito(
  tabella: string,
  id: string,
  ambito: Ambito,
): Promise<Ambito> {
  try {
    const { data, error } = await leggi(tabella, ambito, "location_id")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return SEDE_UNICA_;
    return ambitoDiRiga((data as { location_id?: string | null }).location_id ?? null);
  } catch {
    return SEDE_UNICA_;
  }
}
