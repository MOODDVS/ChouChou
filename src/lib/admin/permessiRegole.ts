/**
 * PERMESSI — chi puo' vedere che cosa. Modulo puro: non importa niente.
 *
 * ⚠️ COSA C'ERA PRIMA (e perche' questo file esiste).
 * Il ruolo era un SUGGERIMENTO, non una barriera. `AdminNav` chiedeva
 * `/api/admin/pages` e nascondeva i link NEL BROWSER; `settings` e `super`
 * facevano il loro controllo dentro uno <script>, cioe' dopo che la pagina
 * era gia' stata mandata. Un «utente» che scriveva /admin/stats riceveva la
 * pagina con il fatturato del giorno gia' calcolato sul server e incollato
 * dentro l'HTML. Nascondere un link non e' un permesso.
 *
 * Adesso la decisione sta qui, in una funzione pura, e la porta la chiude il
 * middleware — un posto solo, non cinquantotto.
 *
 * ⚠️ TRE LIVELLI, IN QUEST'ORDINE. Una pagina si vede solo se passa tutti e
 * tre, e ognuno risponde a una domanda diversa:
 *   1. l'INSTALLAZIONE la offre?   (`nascoste`, deciso dal super admin)
 *   2. il RUOLO ci arriva?         (super / admin / user)
 *   3. QUESTO utente ce l'ha?      (`pagineUtente`, le caselle del modale)
 * Il primo e' del cliente, il terzo e' della persona. Confonderli vorrebbe
 * dire che spegnere Statistiche per il cameriere la spegne al proprietario.
 */

export type Ruolo = "super" | "admin" | "user";

/** La home dell'admin: chiunque abbia fatto il login ci arriva. */
export const PAGINA_HOME = "home";

/** Solo MOODD. Non e' in PAGINE_ADMIN: non si puo' spuntare a nessuno. */
export const PAGINE_SOLO_SUPER = ["super"];

/**
 * Cio' che un «utente» NON vede finche' nessuno ha spuntato niente per lui.
 * E' il comportamento storico, non una regola morale: appena il modale
 * assegna delle pagine a quella persona, comanda quella scelta.
 */
export const PAGINE_SOLO_ADMIN = ["settings", "stats"];

/** Dal percorso alla chiave di pagina. "" se non e' una pagina admin. */
export function chiavePagina(pathname: string): string {
  const p = String(pathname || "").replace(/\/+$/, "");
  if (p === "/admin") return PAGINA_HOME;
  const m = p.match(/^\/admin\/([a-z0-9-]+)/i);
  if (!m) return "";
  return m[1].toLowerCase();
}

/** Le pagine che questo utente puo' aprire, in ordine di `tutte`. */
export function pagineConsentite(ctx: {
  ruolo: Ruolo;
  /** Le caselle spuntate per QUESTA persona. null/undefined = mai deciso. */
  pagineUtente?: string[] | null;
  /** Spente per tutta l'installazione (super admin → Réglages). */
  nascoste?: string[] | null;
  /** L'elenco completo delle pagine dell'admin. */
  tutte: string[];
}): string[] {
  const tutte = ctx.tutte ?? [];
  if (ctx.ruolo === "super") return [...tutte, ...PAGINE_SOLO_SUPER];

  const spente = new Set(ctx.nascoste ?? []);
  const disponibili = tutte.filter((k) => !spente.has(k));
  if (ctx.ruolo === "admin") return disponibili;

  // "user": o le sue caselle, o il default storico.
  const scelte = ctx.pagineUtente;
  if (Array.isArray(scelte)) {
    const volute = new Set(scelte);
    return disponibili.filter((k) => volute.has(k));
  }
  return disponibili.filter((k) => !PAGINE_SOLO_ADMIN.includes(k));
}

/**
 * Puo' aprire questa pagina?
 *
 * ⚠️ Una chiave SCONOSCIUTA e' permessa. Non e' una svista: le pagine admin
 * nascono senza passare da PAGINE_ADMIN (login, reset-password, e la
 * prossima che qualcuno aggiunge), e un «nego cio' che non conosco»
 * spegnerebbe una pagina nuova senza che nessuno capisca perche'. Cio' che
 * va protetto si dichiara — ed e' dichiarato qui sopra.
 */
export function puoVederePagina(
  chiave: string,
  ctx: Parameters<typeof pagineConsentite>[0],
): boolean {
  if (!chiave || chiave === PAGINA_HOME) return true;
  if (PAGINE_SOLO_SUPER.includes(chiave)) return ctx.ruolo === "super";
  if (!(ctx.tutte ?? []).includes(chiave)) return true;
  return pagineConsentite(ctx).includes(chiave);
}

/**
 * LA FUNZIONE E' ACCESA PER QUESTO LOCALE?
 *
 * ⚠️ Non e' un permesso, e' un'ESISTENZA — e sono due domande diverse.
 * `puoVederePagina` risponde «questa persona puo' aprire la pagina», e per il
 * super e' sempre si': deve poter entrare in Commandes anche per riaccenderla.
 * Qui si chiede un'altra cosa: questo ristorante prende ordini? Se il super ha
 * spento «Commandes» in Pages visibles, in questa installazione gli ordini NON
 * ESISTONO, e la Accueil non deve mostrarne la colonna NEMMENO AL SUPER: una
 * colonna «0 commandes aujourd'hui» per un locale che non prende ordini non e'
 * un dato, e' un errore che si legge come un dato.
 *
 * Una chiave sconosciuta e' accesa, per la stessa ragione di `puoVederePagina`:
 * cio' che si spegne si dichiara in PAGINE_ADMIN.
 */
export function funzioneAccesa(
  chiave: string,
  ctx: { nascoste?: string[] | null },
): boolean {
  return !(ctx.nascoste ?? []).includes(String(chiave || ""));
}

/** Le caselle da spuntare per difetto quando si crea un «utente». */
export function pagineDiDefault(tutte: string[]): string[] {
  return (tutte ?? []).filter((k) => !PAGINE_SOLO_ADMIN.includes(k));
}

/** Ripulisce quello che arriva dal modale: solo chiavi note, senza doppioni. */
export function pulisciPagine(grezzo: unknown, tutte: string[]): string[] | null {
  if (grezzo === null || grezzo === undefined) return null;
  if (!Array.isArray(grezzo)) return null;
  const note = new Set(tutte ?? []);
  const out: string[] = [];
  for (const v of grezzo) {
    const k = String(v ?? "").trim().toLowerCase();
    if (note.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

// ============================================================
// LE API (20/09/2026)
//
// Chiudere le pagine non basta: /admin/stats era sbarrata e
// /api/admin/stats rispondeva lo stesso a chiunque avesse fatto il login.
// Una serratura sulla porta e la finestra aperta.
//
// ⚠️ NEL DUBBIO SI LASCIA APERTO. Bloccare per sbaglio un'API che serve a
// una pagina permessa rompe l'admin per tutti, subito; lasciarla aperta e'
// il comportamento di oggi. Percio' ogni voce qui sotto e' una DECISIONE, e
// `PAGINA_APERTA` non e' una svista ma una riga scritta apposta.
//
// ⚠️ Le API che la HOME chiama restano aperte anche quando i dati sono di
// un'altra pagina: le tile sono legate alla loro pagina con
// `data-admin-page` e spariscono da sole: se la tile non c'e', la chiamata
// non parte. Quelle di cui non ho potuto verificare il chiamante sono
// aperte per prudenza, ed e' segnato.
// ============================================================

/** L'API e' di chiunque abbia fatto il login. */
export const PAGINA_APERTA = PAGINA_HOME;

export const API_PAGINA: Record<string, string> = {
  // --- Ordini -----------------------------------------------------------
  "orders": "orders",
  "refund": "orders",
  "orders-recupero": "orders",   // la guarigione dei pagamenti non registrati
  // --- Prenotazioni -----------------------------------------------------
  "reservations": "reservations",
  "service-closures": "reservations",
  "zone-closures": "reservations",
  "zone-closure-impact": "reservations",
  // --- Clienti ----------------------------------------------------------
  "clients": "clients",
  // --- Menu -------------------------------------------------------------
  "menu": "menu",
  "categories": "menu",
  "lunch": "menu",
  "set-menus": "menu",
  // --- Statistiche (il fatturato: la ragione per cui esiste questa mappa)
  "stats": "stats",
  "stats-reservations": "stats",
  "traffic": "stats",
  // --- Marketing --------------------------------------------------------
  "coupons": "marketing",
  "popups": "marketing",
  "newsletter": "marketing",
  "newsletter-schedule": "marketing",
  "credits": "marketing",
  "gift-cards": "marketing",
  "gift-cards-pdf": "marketing",
  "gift-cards-shop": "marketing",
  // --- Assets -----------------------------------------------------------
  "images": "assets",
  // --- Stampa -----------------------------------------------------------
  "print-catalog": "print",
  "print-order": "print",
  // --- Agenda -----------------------------------------------------------
  "agenda": "agenda",
  // --- Réglages ---------------------------------------------------------
  "settings": "settings",
  "docs": "settings",
  "team": "settings",
  "tables": "settings",
  "site-images": "settings",
  // --- Solo MOODD -------------------------------------------------------
  "users": "super",
  "locations": "super",
  // ⚠️ `printers` (le stampanti dei ticket), non `print`: `print` e' gia' il
  // catalogo degli stampati ordinabili a MOODD, ed e' un'altra cosa. Due
  // nomi uguali in due posti diversi si pagano la prima volta che qualcuno
  // cerca il file sbagliato con una stampante ferma in cucina.
  "printers": "super",
  "integrations": "super",
  "google-place": "super",
  // --- Scheda Google ----------------------------------------------------
  // "google" NON e' in PAGINE_ADMIN: oggi quella pagina non si puo' spegnere
  // e queste restano aperte (una chiave sconosciuta non blocca). Il giorno
  // che la si aggiunge all'elenco, si chiudono da sole senza toccare nulla.
  "google/attributes": "google",
  "google/data": "google",
  "google/locations": "google",
  "google/media": "google",
  "google/menu": "google",
  "google/posts": "google",
  "google/profile": "google",
  "google/reply": "google",
  "google/reviews": "google",
  "google/rh-hours": "google",
  "google/sync": "google",
  "google-info": "google",
  // --- Aperte, e ognuna per una ragione ---------------------------------
  "today": PAGINA_APERTA,          // la home ne ha bisogno sempre
  "notes": PAGINA_APERTA,          // tile Notes: nessun data-admin-page
  "home-layout": PAGINA_APERTA,    // layout PERSONALE di chi guarda
  "pages": PAGINA_APERTA,          // e' AdminNav a chiederla, per sapere cosa mostrare
  "search-console": PAGINA_APERTA, // tile Visibilite': nessun data-admin-page
  "events": PAGINA_APERTA,         // eventi del locale, tile «Prossimi eventi»
  // L'abitudine oraria della Accueil: la fascia della giornata la chiede
  // sempre, e dentro conta solo cio' che chi guarda ha il diritto di vedere
  // (vedi caricaAffluenza). Chiuderla qui spegnerebbe il grafico a chi ha la
  // home ma non le prenotazioni — e la home ce l'hanno tutti.
  "affluence": PAGINA_APERTA,
  "special-days": PAGINA_APERTA,   // orari: li legge anche la home
  "special-days-impact": PAGINA_APERTA,
  "slots": PAGINA_APERTA,
  "push": PAGINA_APERTA,           // notifiche del dispositivo di chi guarda
  "upload": PAGINA_APERTA,         // caricamento immagini, usato da piu' pagine
  "documents": PAGINA_APERTA,      // chiamata dalla home: chiamante non verificato
};

/** Dal percorso al nome dell'API. "" se non e' un'API admin. */
export function chiaveApi(pathname: string): string {
  const m = String(pathname || "").replace(/\/+$/, "").match(/^\/api\/admin\/(.+)$/);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Puo' chiamare questa API?
 *
 * ⚠️ Un'API SCONOSCIUTA e' permessa, come per le pagine: una nuova non deve
 * nascere bloccata. Una rete in tests/permessi.test.mjs fallisce se un file
 * sotto pages/api/admin non e' in `API_PAGINA`, cosi' la dimenticanza si
 * paga subito e non in produzione.
 */
export function puoChiamareApi(
  chiave: string,
  ctx: Parameters<typeof pagineConsentite>[0],
): boolean {
  if (!chiave) return true;
  const pagina = API_PAGINA[chiave];
  if (!pagina) return true;
  return puoVederePagina(pagina, ctx);
}
