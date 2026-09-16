/**
 * I POP-UP — le regole, pure, senza database e senza orologio.
 *
 * Stesso patto di `sedeRegole.ts` e compagnia: qui dentro non si legge
 * niente e non si chiede che ore sono, quindi i test girano sulla funzione
 * vera. `popups.ts` resta il pezzo che va a prendere le righe e guarda
 * l'orologio; la SCELTA — quale pop-up vince, e se ne vince uno — sta qui.
 *
 * ⚠️ IL POP-UP E' «MISTO»: `location_id` NULL = di tutto il gruppo, un id =
 * di quel punto. Il default quando si crea e' «tutte le sedi», ed e' una
 * scelta sulla DIREZIONE DELL'ERRORE: un annuncio del gruppo che compare
 * ovunque e' quello che ci si aspetta; uno di un punto solo che per
 * sbaglio compare ovunque si vede subito e si corregge. Il filtro non e'
 * qui — e' in `leggi("popups", ambito)` — ma la conseguenza si legge qui:
 * a queste regole arrivano gia' solo i pop-up che quel punto puo' vedere.
 */

export interface RigaPopup {
  id: string;
  title: string | null;
  title_en: string | null;
  title_i18n: Record<string, string> | null;
  pages: string[];
  schedule_kind: string;
  date_start: string | null;
  date_end: string | null;
  days: number[] | null;
  hour_start: string | null;
  hour_end: string | null;
}

export interface Adesso {
  /** Pagina del sito: "home", "menu", … */
  slug: string;
  lang: string;
  /** AAAA-MM-GG nel fuso del ristorante. */
  oggi: string;
  /** "HH:mm" nel fuso del ristorante. */
  hhmm: string;
  /** 0 = domenica … 6 = sabato (come li salva l'admin). */
  giorno: number;
}

/**
 * Il TITOLO nella lingua chiesta, o stringa vuota.
 *
 * ⚠️ Un pop-up senza titolo in quella lingua NON si mostra. E' deliberato:
 * il titolo e' l'unica parte che il visitatore legge di sicuro, e mostrarlo
 * vuoto (o in francese a un cliente inglese) e' peggio che non mostrarlo.
 * `title_i18n` e' la forma nuova; `title`/`title_en` sono le colonne
 * storiche, tenute per i pop-up scritti prima di #70.
 */
export function titoloPopup(p: RigaPopup, lang: string): string {
  const storico = lang === "en" ? p.title_en : lang === "fr" ? p.title : null;
  return String(p.title_i18n?.[lang] ?? storico ?? "").trim();
}

/** La programmazione di questo pop-up copre questo momento? */
export function popupInOrario(p: RigaPopup, ora: Adesso): boolean {
  if (p.schedule_kind === "dates") {
    // ⚠️ Una programmazione a date SENZA date non vale «sempre»: vale MAI.
    // Chi ha scelto «fra due date» e poi le ha lasciate vuote non ha detto
    // «tutti i giorni», ha lasciato il lavoro a meta'.
    if (!p.date_start || !p.date_end) return false;
    return ora.oggi >= p.date_start && ora.oggi <= p.date_end;
  }
  if (p.schedule_kind === "weekly") {
    if (!Array.isArray(p.days) || !p.days.includes(ora.giorno)) return false;
    const da = String(p.hour_start ?? "").slice(0, 5);
    const a = String(p.hour_end ?? "").slice(0, 5);
    if (!da || !a) return false;
    return ora.hhmm >= da && ora.hhmm <= a;
  }
  return true; // "always"
}

/**
 * QUALE POP-UP VINCE.
 *
 * Le righe arrivano gia' filtrate per sede e per `active`, e gia' ordinate
 * dal piu' recente: vince il primo che passa tutte le prove. Uno solo —
 * due pop-up contemporanei su una pagina sono due finestre da chiudere.
 *
 * ⚠️ Generica di proposito: rende la riga COM'E' ARRIVATA, con addosso tutto
 * quello che serve a disegnare il pop-up (testo, immagine, bottoni). Con un
 * `RigaPopup` secco chi chiama si ritroverebbe in mano solo i campi delle
 * regole e dovrebbe rimettersi a cercare la riga giusta nell'elenco — cioe'
 * riscrivere qui fuori un pezzo di quello che questa funzione ha gia' fatto.
 */
export function scegliPopup<T extends RigaPopup>(righe: T[], ora: Adesso): T | null {
  for (const p of righe) {
    if (!Array.isArray(p.pages) || !p.pages.includes(ora.slug)) continue;
    if (!titoloPopup(p, ora.lang)) continue;
    if (!popupInOrario(p, ora)) continue;
    return p;
  }
  return null;
}
