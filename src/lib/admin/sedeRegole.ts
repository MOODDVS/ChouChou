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
  agenda_events: "sede",
  admin_notes: "sede",
  google_reviews: "sede",       // tre schede Google, tre flussi
  push_subscriptions: "sede",
  admin_docs_meta: "sede",      // tre societa', tre set di contratti
  gift_card_redemptions: "sede", // la carta e' del marchio, l'uso registra DOVE
  print_orders: "sede",         // ha un indirizzo di consegna e una fattura
  location_config: "sede",
  location_settings: "sede",
  location_secrets: "sede",

  // --- MISTE: chi crea sceglie se vale per tutte o per una ---
  menu_items: "mista",          // il piatto e' del marchio; l'esaurito no (tabella a parte)
  special_days: "mista",        // Natale chiude tutti; i lavori chiudono uno
  popups: "mista",
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
export function sede(id: string): Ambito {
  if (!RE_UUID.test(id)) throw new Error(`Id di sede non valido: ${JSON.stringify(id)}`);
  return { modo: "sede", id };
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
