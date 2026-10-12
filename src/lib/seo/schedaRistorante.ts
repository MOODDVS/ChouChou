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
  immagine?: string;
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
  /** Indirizzo della pagina di prenotazione. */
  prenotazioni?: string;
  indirizzo?: IndirizzoScheda;
  mappa?: string;
  /** `openingHoursSpecification` gia' pronto (vedi `orariSchema()`). */
  orari?: unknown[];
  /** I profili veri, dal pannello: non i ripieghi del config. */
  social?: string[];
  geo?: { lat?: number | null; lng?: number | null };
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

const conBarra = (u: string) => (u.endsWith("/") ? u : u + "/");

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
    "@context": "https://schema.org",
    "@type": d.tipo || "Restaurant",
    "@id": `${radice}#restaurant`,
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
