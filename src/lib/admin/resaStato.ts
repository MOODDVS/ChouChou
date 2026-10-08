/**
 * LO STATO CHE SI VEDE — una regola, un posto solo.
 *
 * ⚠️ IL GUASTO CHE QUESTO FILE CHIUDE (07/10/2026, visto su Educazione
 * Napoletana). La stessa prenotazione diceva due cose in due schermi: la
 * pagina Réservations «En cours», la colonna della Accueil «Confirmée». Non
 * erano due dati diversi — era lo stesso `status = confirmed` letto da due
 * codici che non la pensavano uguale.
 *
 * Perche' succedeva: lo stato di una prenotazione NON e' solo la colonna
 * `status`. Nessuno in sala va a premere «à table» quando il cliente si
 * siede, e nessuno preme «fini» quando esce: la pagina Réservations lo
 * sapeva, e per le CONFERMATE faceva seguire lo stato all'OROLOGIO — entrata
 * nella sua finestra = «En cours», finestra passata = «Fini ?». La colonna
 * della Accueil no: stampava `status` cosi' com'era. Due verita' per la stessa
 * riga, e quella sbagliata era sullo schermo che resta aperto tutta la sera.
 *
 * ⚠️ PERCHE' UN FILE PURO, SENZA NESSUN IMPORT. `admin/sede.ts` arriva a
 * `db.ts`, che LANCIA all'import se mancano le variabili di Supabase — e in
 * vitest mancano. Un file di prova che ci arrivi, anche per tre livelli, non
 * parte affatto e vitest lo conta come «0 test»: verde a colpo d'occhio,
 * nessuna prova eseguita. E' gia' successo due volte (ENGINE.md).
 *
 * ⚠️ L'ORA LA PORTA CHI CHIAMA. Qui dentro non si guarda l'orologio: il fuso
 * e' quello del RISTORANTE, non del browser, e chiederlo qui vorrebbe dire
 * portarsi dentro la configurazione — cioe' il database. Chi chiama passa
 * `{ oggi, minuti }` gia' nel fuso giusto, e la stessa funzione si prova con
 * un'ora finta senza orologi di mezzo.
 */

export type Fase = "future" | "encours" | "passe";

/** Lo stato da MOSTRARE. ⚠️ `fini` non e' `done`: `done` l'ha deciso qualcuno,
 *  `fini` e' una DOMANDA dell'orologio («la finestra e' passata, era finita?»)
 *  e si disegna come tale. Confonderli vorrebbe dire chiudere da soli una
 *  prenotazione che nessuno ha chiuso. */
export type StatoMostrato =
  | "pending" | "confirmed" | "seated" | "fini" | "done" | "noshow" | "cancelled";

export interface ResaTempo {
  date: string;
  heure: string;
  status?: string | null;
  service_key?: string | null;
  extra_minutes?: number | null;
}

/** Adesso, nel fuso del ristorante: il giorno in ISO e i minuti da mezzanotte. */
export interface Adesso {
  oggi: string;
  minuti: number;
}

export interface ServizioHold {
  key: string;
  hold?: number | null;
}

/** La durata di un tavolo quando il servizio non ne dichiara una. */
export const HOLD_RIPIEGO = 90;

/** Minuti da mezzanotte di un «hh:mm». `-1` se non e' un'ora. */
export function minutiDa(hhmm: unknown): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/**
 * Quanto dura il tavolo di QUEL servizio.
 *
 * ⚠️ I limiti (15 minuti, 6 ore) non sono gusto: `hold` arriva dalla
 * configurazione, e una configurazione vecchia o scritta male darebbe una
 * finestra di zero minuti — cioe' ogni prenotazione «finita» appena creata.
 */
export function holdDi(
  serviceKey: unknown,
  servizi: ServizioHold[] | null | undefined,
  ripiego = HOLD_RIPIEGO,
): number {
  const sv = (servizi ?? []).find((x) => x && x.key === serviceKey);
  const n = Math.floor(Number(sv?.hold));
  return Number.isFinite(n) && n >= 15 && n <= 360 ? n : ripiego;
}

/** La finestra vera di QUESTA prenotazione: durata del servizio + prolungo. */
export function holdR(
  r: Pick<ResaTempo, "service_key" | "extra_minutes">,
  servizi: ServizioHold[] | null | undefined,
  ripiego = HOLD_RIPIEGO,
): number {
  return holdDi(r.service_key, servizi, ripiego) + (Number(r.extra_minutes) || 0);
}

/**
 * Dov'e' questa prenotazione rispetto all'orologio.
 *
 * ⚠️ Un'ora illeggibile vale «future», non «passe». Il verso sbagliato
 * chiuderebbe da sola una prenotazione per un dato storto — e la riga
 * sparirebbe dalla colonna senza che nessuno l'abbia toccata.
 */
export function fase(
  r: ResaTempo,
  ora: Adesso,
  servizi?: ServizioHold[] | null,
  ripiego = HOLD_RIPIEGO,
): Fase {
  if (String(r.date ?? "") > ora.oggi) return "future";
  if (String(r.date ?? "") < ora.oggi) return "passe";
  const inizio = minutiDa(r.heure);
  if (inizio < 0) return "future";
  if (ora.minuti >= inizio + holdR(r, servizi, ripiego)) return "passe";
  if (ora.minuti >= inizio) return "encours";
  return "future";
}

/**
 * Lo stato da scrivere sulla pastiglia.
 *
 * `null` = stato che non conosciamo. ⚠️ Chi chiama scrive la parola grezza, e
 * non una a caso: qui c'era un ripiego che per OGNI stato ignoto scriveva
 * «Confirmée». Un'etichetta inventata e' peggio di un'etichetta brutta —
 * «annulée» letta «confirmée» e' un tavolo tenuto per nessuno.
 */
export function statoMostrato(status: unknown, f: Fase): StatoMostrato | null {
  const s = String(status ?? "");
  if (s === "pending" || s === "done" || s === "noshow" || s === "cancelled") return s;
  // ⚠️ L'arrivo messo A MANO non lo tocca l'orologio: resta «En cours»
  // qualunque sia l'ora, e a finestra passata diventa la domanda «Fini ?».
  if (s === "seated") return f === "passe" ? "fini" : "seated";
  if (s === "confirmed") {
    if (f === "passe") return "fini";
    if (f === "encours") return "seated";
    return "confirmed";
  }
  return null;
}

/** Comodita': la fase e lo stato in un colpo, come la usano le due pagine. */
export function statoDi(
  r: ResaTempo,
  ora: Adesso,
  servizi?: ServizioHold[] | null,
  ripiego = HOLD_RIPIEGO,
): StatoMostrato | null {
  return statoMostrato(r.status, fase(r, ora, servizi, ripiego));
}

/**
 * LA VOCE DEL MENU corrispondente allo stato mostrato.
 *
 * ⚠️ «Fini ?» diventa `done`: nel menu si deve poter SEGNARE la voce dove si
 * trova la prenotazione, e «Fini ?» non e' una voce — e' la domanda che la
 * pastiglia fa prima che qualcuno risponda.
 *
 * ⚠️ IL GUASTO CHE CHIUDE. La colonna della Accueil segnava la voce corrente
 * col `status` GREZZO: una confermata il cui tavolo e' in corso mostrava
 * «En cours» sulla pastiglia e il pallino su «Confirmée» nel menu. Chi apriva
 * il menu per metterla a tavola vedeva che quello era gia' lo stato scelto, e
 * non toccava niente. La pagina Réservations lo faceva bene, con la sua copia
 * della regola: due codici, due risposte, sulla stessa riga.
 *
 * Uno stato ignoto torna la sua parola grezza: nessuna voce si accende, che e'
 * la verita' — non sappiamo dove sia.
 */
export function voceStato(status: unknown, f: Fase): string {
  const sm = statoMostrato(status, f);
  return sm === "fini" ? "done" : (sm ?? String(status ?? ""));
}

/** Comodita': la fase e la voce in un colpo (come `statoDi`). */
export function voceStatoDi(
  r: ResaTempo,
  ora: Adesso,
  servizi?: ServizioHold[] | null,
  ripiego = HOLD_RIPIEGO,
): string {
  return voceStato(r.status, fase(r, ora, servizi, ripiego));
}
