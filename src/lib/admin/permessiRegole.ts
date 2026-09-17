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
