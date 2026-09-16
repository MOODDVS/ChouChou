/**
 * LA NEWSLETTER — segmenti e rubrica, puri.
 *
 * Erano dentro `newsletterSend.ts`, che importa Resend, Supabase, il tema e
 * la configurazione: per provare «chi finisce nel segmento fr:top50»
 * bisognava avere un database e una chiave d'invio. Cosi' non si provava,
 * e infatti non era mai stato provato.
 *
 * ------------------------------------------------------------------
 * ⚠️ LA RUBRICA E' DEL MARCHIO, di proposito.
 *
 * Il cliente e' del gruppo (`clients: "marchio"`), e la newsletter e' UNA
 * rubrica sola: chi ha ordinato a Stockel e prenotato a Jourdan e' una
 * persona, non due. Per questo `rubrica()` legge con `tutteLeSedi()` e non
 * con la sede selezionata — e la disiscrizione vale per tutto il gruppo,
 * perche' il consenso segue la persona e non il punto vendita.
 *
 * L'errore, qui, sarebbe silenzioso in tutte e due le direzioni: con la
 * sede selezionata, un invio «a tutti» partirebbe a un terzo della rubrica
 * e il conteggio direbbe un numero plausibile; una disiscrizione per sede
 * farebbe riarrivare la newsletter a chi l'aveva rifiutata, dall'altra
 * pizzeria dello stesso marchio.
 * ------------------------------------------------------------------
 */

// Una FR va al pubblico francofono (in tutti i gruppi: nouveaux/top50/…),
// una EN al pubblico EN. fr = lingua del sito fr o SCONOSCIUTA (default del
// sito); en = tutte le altre (en, nl, it, …).
export type LinguaNews = "tous" | "fr" | "en";
export const LINGUE: LinguaNews[] = ["tous", "fr", "en"];
export type GruppoNews = "tous" | "nouveaux" | "top50" | "resa" | "commande";
export const GRUPPI: GruppoNews[] = ["tous", "nouveaux", "top50", "resa", "commande"];

/** Quanti giorni dura il badge «nuovo». Stesso valore della pagina Clienti:
 *  due definizioni di «nuovo» nella stessa applicazione sono due numeri che
 *  prima o poi non coincidono piu'. */
export const GIORNI_NUOVO = 14;

/** Quante persone stanno nel «top». */
export const TOP = 50;

/** Segment salvato/trasmesso come "lingua:gruppo" (es. "fr:top50"). */
export function parseSegment(s: string): { lang: LinguaNews; group: GruppoNews } {
  const [a, b] = String(s ?? "").split(":");
  let lang: LinguaNews = (LINGUE as string[]).includes(a) ? (a as LinguaNews) : "tous";
  let group: GruppoNews = (GRUPPI as string[]).includes(b ?? "") ? (b as GruppoNews) : "tous";
  // ⚠️ Valori vecchi senza ":" (es. "top50"), salvati prima che il segmento
  // avesse una lingua. Letti come gruppo, non come lingua: altrimenti un
  // invio programmato l'anno scorso partirebbe oggi a tutta la rubrica.
  if (!b && a && (GRUPPI as string[]).includes(a)) {
    group = a as GruppoNews;
    lang = "tous";
  }
  return { lang, group };
}

export interface Profilo {
  /** Prima attivita' (come il badge «nuovo» della pagina Clienti). */
  first: string | null;
  /** Ordini pagati + addizioni delle prenotazioni, in centesimi. */
  spesa: number;
  ordini: boolean;
  rese: boolean;
  /** Lingua dell'ULTIMA prenotazione. */
  lang: string;
  langAt: string;
}

/**
 * CHI RICEVE questo segmento.
 *
 * `adesso` si passa: una funzione che chiede l'ora da sola non si puo'
 * provare su «nuovo da 13 giorni» senza aspettare domani.
 */
export function filtraRubrica(
  profili: Map<string, Profilo>,
  lang: LinguaNews,
  group: GruppoNews,
  adesso: number = Date.now(),
): string[] {
  let tutti = [...profili.entries()];

  // 1) LINGUA (primaria). ⚠️ Chi non ha mai detto in che lingua parla
  // finisce fra i francofoni, perche' il francese e' la lingua del sito:
  // meglio una mail nella lingua di casa che nessuna mail.
  if (lang === "fr") tutti = tutti.filter(([, p]) => !p.lang || p.lang === "fr");
  else if (lang === "en") tutti = tutti.filter(([, p]) => Boolean(p.lang) && p.lang !== "fr");

  // 2) GRUPPO, dentro la lingua scelta: il top 50 e' il top 50 DI QUELLA
  // lingua, non i francofoni presi dal top 50 generale.
  switch (group) {
    case "nouveaux": {
      const soglia = adesso - GIORNI_NUOVO * 86400000;
      return tutti.filter(([, p]) => p.first && Date.parse(p.first) > soglia).map(([e]) => e);
    }
    case "top50":
      return tutti
        .filter(([, p]) => p.spesa > 0)
        .sort((a, b) => b[1].spesa - a[1].spesa)
        .slice(0, TOP)
        .map(([e]) => e);
    case "resa":
      return tutti.filter(([, p]) => p.rese).map(([e]) => e);
    case "commande":
      return tutti.filter(([, p]) => p.ordini).map(([e]) => e);
    default:
      return tutti.map(([e]) => e);
  }
}
