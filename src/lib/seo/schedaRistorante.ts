/**
 * LA SCHEDA DEL RISTORANTE PER I MOTORI DI RICERCA (JSON-LD), UNA VOLTA SOLA.
 *
 * ⚠️ Perche' sta qui e non in sette telai: fino a oggi ogni cliente si
 * scriveva la propria. Sei l'avevano, con sei forme diverse; 450 Gradi non
 * l'aveva affatto. Una correzione — come quella di ieri su `url` che su
 * /carte diceva che il ristorante «si trova» a /carte — andava rifatta sette
 * volte, e sei volte si dimentica.
 *
 * ⚠️ REGOLE PURE, NESSUN IMPORT. Niente `CLIENT`, niente `Astro`, niente
 * database: entra un oggetto GIA' RISOLTO, esce un oggetto. Due motivi, e il
 * secondo e' quello che conta:
 *  1. si prova con node e basta, senza montare una pagina;
 *  2. il giorno che UN'APP SOLA servira' tutti i clienti, «chi siamo» arriva
 *     dalla richiesta e non dal modulo importato. Una funzione che legge una
 *     costante al momento dell'import e' esattamente il pezzo che quel
 *     giorno va riscritto. Questa no.
 *
 * ⚠️ E' la scheda DI UN PUNTO. Chi la costruisce ha gia' chiesto a
 * `datiRistorante(ambito)` di quale punto si parla: tre pizzerie a tre
 * indirizzi hanno tre schede, non una con l'indirizzo della prima.
 */

/** L'indirizzo A PEZZI, come lo rende `datiRistorante` leggendo Général. */
export interface IndirizzoScheda {
  via: string;
  cap: string;
  comune: string;
  /** Provincia o regione: Général non la chiede, arriva dal config cliente. */
  regione?: string;
  /** Paese ISO (`BE`, `IT`...). */
  paese?: string;
}

export interface DatiScheda {
  /** La RADICE del sito (`https://dominio/`), non l'indirizzo della pagina. */
  radice: string;
  nome: string;
  /** Una sola descrizione per il locale: vedi il commento su `@id` sotto. */
  descrizione?: string;
  /** Una fotografia, o piu' d'una: Google ne sceglie la migliore. */
  immagine?: string | string[];
  /** Il tipo schema.org: `Restaurant`, `CafeOrCoffeeShop`, `Bakery`... */
  tipo?: string;
  cucina?: string | string[];
  fasciaPrezzo?: string;
  valuta?: string;
  pagamenti?: string;
  telefono?: string;
  email?: string;
  /** Indirizzo della pagina della carta. */
  carta?: string;
  /**
   * Indirizzo della pagina di prenotazione, oppure `true` per dire
   * soltanto «si prenota» (e `false` per dire che non si prenota: anche
   * quello e' un'informazione, e vale la pena darla).
   */
  prenotazioni?: string | boolean;
  indirizzo?: IndirizzoScheda;
  mappa?: string;
  /** `openingHoursSpecification` gia' pronto (vedi `orariSchema()`). */
  orari?: unknown[];
  /** I profili veri, dal pannello: non i ripieghi del config. */
  social?: string[];
  geo?: { lat?: number | null; lng?: number | null };
  /**
   * L'ancora dell'`@id` (`#restaurant` se non si dice niente).
   *
   * ⚠️ Un `@id` e' una promessa fatta a Google: «questo nodo e' questo
   * locale». Un sito che ne usa gia' un altro (BROS dice `#ristorante`)
   * passa il suo invece di cambiarlo, perche' la coerenza di un nome nel
   * nostro codice non vale la rottura di un identificativo pubblicato.
   */
  ancora?: string;
  /**
   * `true` quando il nodo entra in un `@graph`: il contesto esce.
   *
   * ⚠️ In un `@graph` il `@context` sta IN CIMA, una volta. Ripeterlo su
   * ogni nodo non e' piu' JSON-LD valido allo stesso modo, e i validatori lo
   * segnalano.
   */
  dentroGrafo?: boolean;
  /**
   * CAMPI CHE IL MOTORE NON CONOSCE, aggiunti in coda (`areaServed`,
   * `founder`, quello che serve a un cliente e a nessun altro).
   *
   * ⚠️ E' una valvola, non una porta di servizio: un campo che hanno in
   * due o piu' clienti diventa un campo di `DatiScheda`, altrimenti fra sei
   * mesi le regole comuni sono tornate in sette posti.
   */
  extra?: Record<string, unknown>;
}

/** Via i campi vuoti: in JSON-LD un `telephone: ""` e' peggio che niente —
 *  Google lo legge come un dato, e il dato e' sbagliato. */
function pulisci(o: Record<string, unknown>): Record<string, unknown> {
  const fuori: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    fuori[k] = typeof v === "string" ? v.trim() : v;
  }
  return fuori;
}

/**
 * L'indirizzo del locale, normalizzato.
 *
 * ⚠️ LA RADICE DI UN SITO FINISCE CON LA BARRA, una pagina interna NO.
 * `https://sito.be` e `https://sito.be/` sono lo stesso posto e devono dare
 * lo stesso `@id`, altrimenti lo stesso locale diventa due nodi. Ma un
 * marchio con piu' locali ha un nodo per pagina (`/schaerbeek`), e li' la
 * barra in piu' non e' uguale a niente: va lasciata la forma che usano il
 * canonico e i collegamenti interni.
 */
const conBarra = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname === "/" ? x.origin + "/" : u.replace(/\/+$/, "");
  } catch {
    return u.endsWith("/") ? u : u + "/";
  }
};

/**
 * LA SCHEDA DEL LOCALE.
 *
 * ⚠️ `@id` e `url` puntano alla RADICE su OGNI pagina, non alla pagina
 * corrente. Difetto vero, corretto l'11/10/2026: con `url` = canonico, su
 * /carte la scheda diceva che il ristorante si trova a /carte, e Google si
 * ritrovava sei locali con lo stesso nome a sei indirizzi diversi. Lo stesso
 * vale per la descrizione: UNA, quella del locale, non quella della pagina.
 */
export function schedaRistorante(d: DatiScheda): Record<string, unknown> {
  const radice = conBarra(d.radice);
  const scheda = pulisci({
    "@context": d.dentroGrafo ? undefined : "https://schema.org",
    "@type": d.tipo || "Restaurant",
    "@id": `${radice}#${d.ancora || "restaurant"}`,
    name: d.nome,
    description: d.descrizione,
    image: d.immagine,
    url: radice,
    servesCuisine: d.cucina,
    priceRange: d.fasciaPrezzo,
    currenciesAccepted: d.valuta,
    paymentAccepted: d.pagamenti,
    telephone: d.telefono,
    email: d.email,
    hasMenu: d.carta,
    acceptsReservations: d.prenotazioni,
    hasMap: d.mappa,
    openingHoursSpecification: d.orari,
    sameAs: d.social,
  });

  /**
   * ⚠️ L'INDIRIZZO O INTERO O NIENTE. Se Général non e' compilato, `via` e
   * `comune` arrivano vuoti: una `PostalAddress` con dentro solo il paese
   * dice a Google «questo locale sta in Belgio», che come indirizzo di un
   * ristorante non vale niente e sporca la scheda. Meglio nessun campo:
   * l'indirizzo resta nella pagina, dove lo legge una persona.
   */
  const i = d.indirizzo;
  if (i && i.via.trim() !== "" && i.comune.trim() !== "") {
    scheda.address = pulisci({
      "@type": "PostalAddress",
      streetAddress: i.via,
      postalCode: i.cap,
      addressLocality: i.comune,
      addressRegion: i.regione,
      addressCountry: i.paese,
    });
  }

  /**
   * ⚠️ `geo` SOLO con due numeri veri. Due coordinate inventate mettono il
   * ristorante in mezzo a una strada che non e' la sua, e la mappa e' una
   * delle prime cose che Google mostra. Senza coordinate la scheda esce
   * senza `geo`, ed e' esattamente quello che deve succedere.
   */
  if (typeof d.geo?.lat === "number" && typeof d.geo?.lng === "number") {
    scheda.geo = { "@type": "GeoCoordinates", latitude: d.geo.lat, longitude: d.geo.lng };
  }

  /* I campi del cliente per ultimi, puliti come gli altri. */
  if (d.extra) {
    for (const [k, v] of Object.entries(pulisci(d.extra))) scheda[k] = v;
  }

  return scheda;
}

/**
 * LE BRICIOLE (`BreadcrumbList`): «Nome ristorante › Questa pagina».
 *
 * ⚠️ `casa` e' la home NELLA LINGUA DI QUESTA PAGINA: su /en le briciole che
 * rimandano alla home francese dicono a Google che le due lingue sono un
 * unico percorso.
 * ⚠️ Rende `null` in home (le briciole di una sola voce non sono briciole) e
 * quando la pagina non ha un nome da mostrare.
 */
export function briciole(d: {
  casa: string;
  nomeSito: string;
  pagina?: { nome: string; url: string } | null;
}): Record<string, unknown> | null {
  const p = d.pagina;
  if (!p || p.nome.trim() === "" || p.url.trim() === "") return null;
  const nudo = (u: string) => u.replace(/\/+$/, "");
  if (nudo(p.url) === nudo(d.casa)) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: d.nomeSito, item: d.casa },
      { "@type": "ListItem", position: 2, name: p.nome, item: p.url },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* GLI ORARI, DA RIGHE A `openingHoursSpecification`                  */
/* ------------------------------------------------------------------ */

/** Una riga di `settings` / `location_settings` (vedi `leggiOrari`). */
export interface RigaOrario {
  /** 0 = domenica, come nel database. */
  day_of_week: number;
  lunch_active?: boolean | null;
  lunch_open?: string | null;
  lunch_close?: string | null;
  dinner_active?: boolean | null;
  dinner_open?: string | null;
  dinner_close?: string | null;
}

const GIORNI_SCHEMA = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** `18:30:00` → `18:30`: schema.org vuole l'ora, non i secondi. */
const ora = (t: unknown) => String(t ?? "").slice(0, 5);

/**
 * GLI ORARI PER LA SCHEDA, dalle righe che rende `leggiOrari(ambito)`.
 *
 * ⚠️ DUE SERVIZI = DUE RIGHE, non una fascia dal mezzogiorno a mezzanotte.
 * Unire pranzo e cena in un intervallo solo dice a Google che alle 16 si
 * mangia: il risultato non e' un errore in un file, e' qualcuno che arriva e
 * trova chiuso — e lo ha letto sulla scheda del ristorante.
 *
 * ⚠️ Un servizio senza orario (`active` ma `open` o `close` vuoti) si salta:
 * meglio un giorno in meno che un giorno con un'ora inventata.
 *
 * ⚠️ Regole pure: le righe le legge chi chiama, CON L'AMBITO. Tre pizzerie
 * hanno tre orari, e `leggiOrari` sovrappone quelli della sede; una funzione
 * che interrogasse `settings` da se' pubblicherebbe gli orari della prima.
 */
export function orariSpecifica(righe: RigaOrario[]): Record<string, string>[] {
  const fuori: Record<string, string>[] = [];
  for (const r of righe ?? []) {
    const giorno = GIORNI_SCHEMA[Number(r.day_of_week)];
    if (!giorno) continue;
    const servizi: [unknown, unknown, unknown][] = [
      [r.lunch_active, r.lunch_open, r.lunch_close],
      [r.dinner_active, r.dinner_open, r.dinner_close],
    ];
    for (const [attivo, apre, chiude] of servizi) {
      if (!attivo || !apre || !chiude) continue;
      fuori.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: giorno,
        opens: ora(apre),
        closes: ora(chiude),
      });
    }
  }
  return fuori;
}
