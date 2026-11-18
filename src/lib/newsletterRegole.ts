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

// ⚠️ LE LINGUE SONO QUELLE DEL SITO (18/11/2026, Mare e Monti fr/en/it).
// Prima erano scritte qui, fr ed en: l'italiano di Mare e Monti non c'era e
// chi parlava italiano finiva fra gli «EN». Ogni persona sta in UNA lingua:
//  • una lingua del sito → quella;
//  • nessuna lingua nota → la lingua predefinita del sito;
//  • una lingua che il sito non ha (de, ja…) → l'inglese se il sito ce l'ha,
//    se no la predefinita: meglio una mail capita a meta' che nessuna.
export type LinguaNews = string; // "tous" o il codice di una lingua del sito
export interface LingueSito { langs: string[]; def: string }
/** Il comportamento di sempre: sito fr + en, francese predefinito. */
export const SITO_FR_EN: LingueSito = { langs: ["fr", "en"], def: "fr" };

/** Le pillole della lingua: «tutte» e poi le lingue del sito, nel suo ordine. */
export function lingueNewsletter(sito: LingueSito): LinguaNews[] {
  return ["tous", ...sito.langs];
}

/** In quale lingua del sito si scrive a questa persona. */
export function linguaDelProfilo(lang: string, sito: LingueSito): string {
  const l = String(lang ?? "").trim().toLowerCase().slice(0, 2);
  if (!l) return sito.def;
  if (sito.langs.includes(l)) return l;
  return sito.langs.includes("en") ? "en" : sito.def;
}
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
  // Un codice di lingua qualsiasi: se il sito non ce l'ha (piu'), il
  // segmento risulta vuoto — un invio programmato non parte a tutti.
  let lang: LinguaNews = /^[a-z]{2}$/.test(a ?? "") ? a : "tous";
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
  sito: LingueSito = SITO_FR_EN,
): string[] {
  let tutti = [...profili.entries()];

  // 1) LINGUA (primaria). ⚠️ Chi non ha mai detto in che lingua parla
  // finisce nella lingua predefinita del sito: meglio una mail nella lingua
  // di casa che nessuna mail. Le regole sono in `linguaDelProfilo`.
  if (lang !== "tous") tutti = tutti.filter(([, p]) => linguaDelProfilo(p.lang, sito) === lang);

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
