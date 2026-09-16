/**
 * MULTI-SEDE — LE REGOLE, in un file solo e senza dipendenze.
 *
 * Qui c'e' la parte che DECIDE: a chi appartiene ogni tabella e che filtro
 * ne consegue. Niente Supabase, niente rete, niente `import` — cosi' si
 * prova con dei test veri (`tests/sede.test.mjs`) senza un database.
 * L'applicazione vera e' in `sede.ts`, che importa questo file.
 *
 * ------------------------------------------------------------------
 * LA REGOLA DI FONDO (decisa 08/09/2026)
 * `location_id` NULL significa **«vale per tutte le sedi»**. Le righe che
 * esistono oggi sono tutte a NULL, quindi per un cliente con un punto solo
 * la verita' e' gia' scritta nel dato e non serve nessun filtro.
 *
 * ⚠️ NULL in una RIGA non e' la stessa cosa della richiesta «dammi tutte le
 * sedi». Sono due concetti, e qui hanno due nomi diversi apposta: il primo
 * e' `"marchio"`, il secondo e' `{ modo: "tutte" }`. Se si scrivessero
 * uguale, una query a cui per sbaglio non arriva la sede diventerebbe
 * indistinguibile da un aggregato legittimo — e nessuno se ne accorgerebbe,
 * perche' non darebbe errore: darebbe solo righe di un'altra societa'.
 * ------------------------------------------------------------------
 */

/** A chi appartiene una tabella.
 *  - `marchio`: condivisa sempre. Non si filtra mai, e in scrittura
 *    `location_id` resta NULL (clienti, menu, newsletter, buoni…).
 *  - `sede`: di un punto fisico. Si filtra sempre (ordini, prenotazioni,
 *    tavoli, chiusure, agenda, recensioni Google, documenti…).
 *  - `mista`: l'oggetto puo' essere del marchio O di un punto, e chi lo
 *    crea sceglie. In lettura si vedono tutti e due (piatti, giorni
 *    speciali, pop-up, personale). */
export type Appartenenza = "marchio" | "sede" | "mista";

/**
 * LA TABELLA, come codice. Ogni tabella dell'admin sta qui, e una tabella
 * che non c'e' e' un errore, non un caso non filtrato: `appartenenzaDi()`
 * lancia. Un test scorre `src/` e verifica che ogni tabella davvero usata
 * sia dichiarata — una dimenticanza qui sarebbe una tabella senza regola.
 */
export const CLASSIFICA: Record<string, Appartenenza> = {
  // --- del MARCHIO: condivise fra tutte le sedi ---
  app_config: "marchio",        // livello marchio; la sede sovrascrive in location_config
  settings: "marchio",          // orari del marchio; la sede sovrascrive in location_settings
  clients: "marchio",           // il cliente e' del marchio, `blocked` compreso
  menu_categories: "marchio",
  lunch_menus: "marchio",
  set_menus: "marchio",
  coupons: "marchio",
  gift_cards: "marchio",
  gift_card_orders: "marchio",
  newsletter_log: "marchio",
  newsletter_optout: "marchio", // il consenso segue la persona, non il punto
  newsletter_schedule: "marchio",
  newsletter_credits: "marchio",
  page_views: "marchio",        // un solo sito pubblico per i tre punti
  locations: "marchio",

  // --- della SEDE: di un punto fisico ---
  orders: "sede",
  reservations: "sede",
  restaurant_tables: "sede",
  service_closures: "sede",
  zone_closures: "sede",
  admin_notes: "sede",
  google_reviews: "sede",       // tre schede Google, tre flussi
  push_subscriptions: "sede",
  admin_docs_meta: "sede",      // tre societa', tre set di contratti
  gift_card_redemptions: "sede", // la carta e' del marchio, l'uso registra DOVE
  print_orders: "sede",         // ha un indirizzo di consegna e una fattura
  menu_sold_out: "sede",       // stato, non definizione: l'esaurito e' del punto
  location_config: "sede",
  location_settings: "sede",
  location_secrets: "sede",

  // --- MISTE: chi crea sceglie se vale per tutte o per una ---
  menu_items: "mista",          // il piatto e' del marchio; l'esaurito no (tabella a parte)
  special_days: "mista",        // Natale chiude tutti; i lavori chiudono uno
  popups: "mista",
  // ⚠️ L'AGENDA E' DEL MARCHIO, con l'eccezione possibile (deciso 16/09/2026).
  // Era «sede»: ogni punto vedeva solo i suoi eventi, e una serata annunciata
  // dal gruppo andava scritta tre volte. Ora il default e' «tutte le sedi»
  // (come i pop-up), e resta la possibilita' di un evento di un punto solo —
  // la degustazione che fa solo Stockel. Il default lo decide chi crea, in
  // `api/admin/agenda.ts`, e la direzione dell'errore: un evento del gruppo
  // che compare ovunque e' quello che ci si aspetta, uno di sede dimenticato
  // su tutte si vede subito e si corregge.
  agenda_events: "mista",
  team: "mista",                // il personale e' del punto, ma qualcuno gira
};

/** Dove stiamo leggendo.
 *  - `unica`: multi-sede spento. E' lo stato dei quattro clienti attuali:
 *    NESSUN filtro viene aggiunto, le query restano quelle di sempre.
 *  - `sede`: si guarda un punto preciso.
 *  - `tutte`: l'aggregato. Non e' un ripiego ed e' l'unico caso in cui una
 *    lettura senza sede e' legittima: si ottiene SOLO chiamando
 *    `tutteLeSedi()`, mai lasciando vuoto un parametro. */
export type Ambito =
  | { modo: "unica" }
  | { modo: "sede"; id: string }
  | { modo: "tutte" };

/** Il valore che il selettore dell'header manda per chiedere l'aggregato.
 *  Una parola, non un id: cosi' non si confonde mai con una sede vera, e un
 *  cookie vuoto o corrotto non diventa per sbaglio «tutte». */
export const CHIESTA_TUTTE = "tutte";

/** Installazione a sede unica: lo stato di tutti i clienti al 13/09/2026. */
export const SEDE_UNICA: Ambito = { modo: "unica" };

/** L'aggregato delle statistiche. Volutamente verboso: leggendo il codice
 *  si deve vedere che qualcuno ha CHIESTO tutte le sedi. */
export function tutteLeSedi(): Ambito {
  return { modo: "tutte" };
}

/** Una sede precisa. Valida l'id: finisce dentro un'espressione di filtro
 *  PostgREST (`.or(...)`), che e' testo — un id non validato sarebbe
 *  un'iniezione nel filtro. */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Sede che non esiste: filtra tutto via senza lanciare. Si usa quando
 *  l'utente e' legato a una sede sparita — meglio il vuoto che i dati altrui. */
export const NESSUNA_SEDE = "00000000-0000-0000-0000-000000000000";
export function sede(id: string): Ambito {
  if (!RE_UUID.test(id)) throw new Error(`Id di sede non valido: ${JSON.stringify(id)}`);
  return { modo: "sede", id };
}

/**
 * LA CARTELLA DEI DOCUMENTI di questo punto, dentro il bucket.
 *
 * I documenti si separano nel PERCORSO e non in una colonna: la loro lista
 * si costruisce leggendo lo Storage, e un file senza riga di metadati — la
 * maggioranza, visto che i metadati servono ai contratti — non avrebbe
 * nessuna sede da cui farsi filtrare. Il percorso invece c'e' sempre.
 *
 * ⚠️ Si usa l'ID, non lo slug, anche se in un bucket lo slug si leggerebbe
 * meglio. Lo slug e' MODIFICABILE dal super admin: il giorno che qualcuno
 * corregge «schaerbek» in «schaerbeek», tutti i documenti di quel punto
 * resterebbero in una cartella che il codice non guarda piu'. L'id non
 * cambia mai.
 *
 * Sede unica: stringa vuota, cioe' esattamente i percorsi di oggi.
 */
export function radiceDocs(ambito: Ambito): string {
  return ambito.modo === "sede" ? `sedi/${ambito.id}/` : "";
}

/** Il filtro da applicare, descritto e non ancora applicato: cosi' si
 *  confronta in un test senza toccare Supabase. */
export type Filtro =
  | { tipo: "nessuno" }
  | { tipo: "sede"; valore: string }
  | { tipo: "sede-o-marchio"; espressione: string };

export function appartenenzaDi(tabella: string): Appartenenza {
  const a = CLASSIFICA[tabella];
  if (!a) {
    throw new Error(
      `Tabella "${tabella}" non classificata in CLASSIFICA (src/lib/admin/sedeRegole.ts). ` +
      `Dichiarala come "marchio", "sede" o "mista" prima di leggerla.`
    );
  }
  return a;
}

/**
 * Il filtro per una tabella in un ambito. Unico posto dove si decide.
 *
 * `unica` e `tutte` non filtrano mai — la differenza fra i due sta nel
 * fatto che uno e' lo stato dell'installazione e l'altro e' una richiesta
 * esplicita, non nel risultato.
 */
export function filtroPer(tabella: string, ambito: Ambito): Filtro {
  const appartenenza = appartenenzaDi(tabella);
  if (appartenenza === "marchio") return { tipo: "nessuno" };
  if (ambito.modo !== "sede") return { tipo: "nessuno" };
  if (appartenenza === "sede") return { tipo: "sede", valore: ambito.id };
  // mista: la riga della sede E quella del marchio
  return {
    tipo: "sede-o-marchio",
    espressione: `location_id.eq.${ambito.id},location_id.is.null`,
  };
}

/**
 * Che `location_id` scrivere inserendo in questa tabella.
 *
 * `condivisa` vale solo per le tabelle miste ed e' la scelta di chi crea
 * («vale per tutte le sedi» nel modale): sulle altre non ha effetto,
 * perche' li' non c'e' niente da scegliere.
 */
export function sedeDaScrivere(
  tabella: string,
  ambito: Ambito,
  condivisa = false
): string | null {
  const appartenenza = appartenenzaDi(tabella);
  if (ambito.modo === "tutte") {
    throw new Error(
      `Scrittura su "${tabella}" senza una sede: "tutte" e' un ambito di sola lettura.`
    );
  }
  if (appartenenza === "marchio") return null;
  if (ambito.modo === "unica") return null; // sede unica: NULL e' la verita'
  if (appartenenza === "mista" && condivisa) return null;
  return ambito.id;
}

/**
 * QUALE SEDE, per questa richiesta. Funzione pura: prende quello che si sa e
 * rende l'ambito. Tutta la parte che legge il database sta in `sede.ts`.
 *
 * ⚠️ `sedeChiesta` arriva dal CLIENT (il selettore nell'header). Non e' un
 * ordine, e' una richiesta: vale solo per chi ha diritto di vedere piu' sedi,
 * e solo se e' una sede che esiste davvero. Un utente legato a una sede resta
 * sulla sua qualunque cosa mandi — e' proprio il tentativo da cui ci si
 * difende, e non deve nemmeno dare errore: semplicemente non ha effetto.
 *
 * Chi vede tutte le sedi e non ne ha scelta una ottiene **la prima**, non
 * l'aggregato: «tutte» si chiede con `tutteLeSedi()` e si vede nel codice.
 */
export function scegliSede(opz: {
  /** Id delle sedi ATTIVE, in ordine.
   *
   *  ⚠️ VUOTO = nessun filtro, cioe' il comportamento di sempre. E' lo stato
   *  di un'installazione che non ha ancora la sua sede, e non e' un ripiego:
   *  e' la verita'. Fino al 15/09/2026 c'era anche un interruttore
   *  `multi_location`, ed era un secondo asse che diceva la stessa cosa —
   *  con la possibilita' di contraddirla: sedi create e interruttore spento
   *  voleva dire tre punti nel database e nessun filtro nel codice. Adesso
   *  la verita' e' una sola, ed e' QUESTO elenco. */
  sedi: string[];
  /** `app_metadata.location_id` dell'utente. Null = le vede tutte. */
  sedeUtente?: string | null;
  /** Sede selezionata nell'header (cookie o header HTTP). */
  sedeChiesta?: string | null;
}): Ambito {
  if (opz.sedi.length === 0) return SEDE_UNICA;

  const sua = opz.sedeUtente ?? null;
  if (sua) {
    // Legato a una sede: la sua, sempre. Se quella sede non esiste piu' (o e'
    // stata disattivata, o l'id e' malformato) NON si ripiega su un'altra:
    // si filtra su una sede che non esiste, quindi non si vede niente. Un
    // responsabile rimasto senza sede deve vedere il vuoto, mai i dati di
    // un altro punto.
    if (!RE_UUID.test(sua)) return sede(NESSUNA_SEDE);
    return opz.sedi.includes(sua) ? sede(sua) : sede(NESSUNA_SEDE);
  }

  const chiesta = opz.sedeChiesta ?? null;
  // L'aggregato si CHIEDE. Arriva fin qui solo come parola intera, non come
  // parametro mancante: una sede dimenticata da' `opz.sedi[0]`, non «tutte».
  // E vale soltanto per chi non e' legato a un punto — chi lo e' non arriva
  // nemmeno qui, si e' fermato al ramo sopra.
  if (chiesta === CHIESTA_TUTTE) return tutteLeSedi();
  return sede(chiesta && opz.sedi.includes(chiesta) ? chiesta : opz.sedi[0]);
}

/** Costruttore di query, ridotto a quello che serve qui. Tenerlo minimo
 *  vuol dire che un test puo' passarne uno finto e guardare che chiamate
 *  riceve: il filtro si prova davvero, non si deduce. */
export interface Query {
  eq(colonna: string, valore: unknown): Query;
  or(espressione: string): Query;
}

/** Applica il filtro a una query. Quattro righe, e sono le uniche in tutto
 *  il progetto che sanno tradurre una regola in una condizione. */
export function applicaFiltro<T extends Query>(q: T, tabella: string, ambito: Ambito): T {
  const f = filtroPer(tabella, ambito);
  if (f.tipo === "nessuno") return q;
  if (f.tipo === "sede") return q.eq("location_id", f.valore) as T;
  return q.or(f.espressione) as T;
}

// ============================================================
// SEGRETI — assente e illeggibile sono due cose diverse
// ============================================================

export class SegretoIlleggibile extends Error {
  constructor(chiave: string) {
    super(
      `Segreto «${chiave}» di questa sede illeggibile: SECRETS_KEY non e' quella ` +
        `con cui era stato salvato. Riscrivilo da Super admin > Sedi.`,
    );
    this.name = "SegretoIlleggibile";
  }
}

/**
 * Che valore vale, visto quello che c'e' nel database e quello che c'e'
 * nell'ambiente. Funzione pura: sta qui per potersi provare senza database,
 * perche' la regola che decide su quale conto arrivano i soldi non puo'
 * dipendere da un test che nessuno riesce a scrivere.
 *
 * ⚠️ `letto` ha TRE stati, non due:
 *
 *   null  = non c'e' nessuna riga. Nessuno ha configurato questa sede, e
 *           vale l'ambiente. E' una CONFIGURAZIONE — e' il caso normale di
 *           un'installazione a sede unica.
 *   ""    = la riga c'e' ma non si apre (SECRETS_KEY cambiata, backup
 *           ripristinato altrove, riga manomessa). E' un GUASTO.
 *   testo = la chiave della sede.
 *
 * La prima versione univa i primi due (scritta e corretta il 15/09/2026,
 * prima del rilascio). Ripiegare sull'ambiente quando la riga non si apre
 * vuol dire incassare sul conto sbagliato IN SILENZIO: il pagamento riesce,
 * il cliente e' contento, e i soldi di una societa' finiscono su un'altra.
 * Un pagamento che si rifiuta dicendo perche' e' molto meglio.
 */
export function scegliSegreto(
  letto: string | null,
  ambiente: string,
  chiave: string,
): string {
  if (letto === null) return ambiente;
  if (letto === "") throw new SegretoIlleggibile(chiave);
  return letto;
}

/** Da dove viene un segreto: dalla sede, dall'ambiente, o da nessuna parte. */
export type Fonte = "sede" | "ambiente" | "nessuna";

/**
 * Si puo' incassare online QUI?
 *
 * Servono due cose, e devono venire DALLO STESSO POSTO: la chiave con cui si
 * incassa e il segreto con cui si verifica la firma dell'evento che dice
 * «pagato». Sono le due meta' di un conto Stripe.
 *
 * ⚠️ Mezze configurazioni. Chiave della sede + firma dell'ambiente vuol dire
 * che l'evento arriva firmato dal conto della sede e viene verificato con il
 * segreto di un altro: non verifica, e l'ordine resta «in attesa» per sempre.
 * Il cliente ha pagato davvero — i soldi sono su Stripe — ma in cucina non
 * arriva niente e nessuno se ne accorge finche' non chiama.
 *
 * Meglio non offrire il link di pagamento che offrirlo e incassare nel vuoto.
 * Il ristoratore vede solo contanti e bancomat, e continua a lavorare; chi
 * puo' rimediare (il super admin) lo legge nel pannello Sedi, dove le due
 * righe sono corallo.
 */
export function pagamentoOnlinePronto(chiave: Fonte, firma: Fonte): boolean {
  if (chiave === "nessuna" || firma === "nessuna") return false;
  return chiave === firma;
}
