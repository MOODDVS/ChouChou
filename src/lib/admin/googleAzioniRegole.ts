/**
 * I BOTTONI DELLA SCHEDA GOOGLE — regole pure (6/11/2026).
 *
 * Il bottone blu «Prenota» / «Ordina» di Google non e' un attributo: e' un
 * «link d'azione» (My Business Place Actions API). Ce ne possono essere tanti
 * per tipo — i nostri e quelli dei fornitori (TheFork, Zenchef, Resto-Genius…)
 * — e UNO per tipo puo' essere «preferito dall'attivita'». Google dice solo
 * che il preferito sta IN CIMA: non promette che il bottone blu sia lui, e
 * non lascia togliere da qui i link dei fornitori (si tolgono da
 * business.google.com → Prenotazioni → «Rimuovi fornitore»).
 *
 * Qui niente rete e niente env: si provano dai test.
 */

/** I tipi che contano per un ristorante, nell'ordine in cui si mostrano. */
export const TIPI_AZIONE = ["DINING_RESERVATION", "FOOD_ORDERING", "FOOD_TAKEOUT", "FOOD_DELIVERY"] as const;
export type TipoAzione = (typeof TIPI_AZIONE)[number];

export const BASE_AZIONI = "https://mybusinessplaceactions.googleapis.com/v1";

export interface AzioneG {
  /** `locations/{id}/placeActionLinks/{id}` */
  name: string;
  tipo: string;
  uri: string;
  preferito: boolean;
  /** Messo dall'attivita' (noi o il ristoratore), non da un fornitore. */
  nostro: boolean;
  /** Google lascia cambiarlo/toglierlo da qui. */
  modificabile: boolean;
}

/** `accounts/1/locations/2` (percorso v4 salvato) → `locations/2`. */
export function locationDi(path: string): string {
  const m = /(?:^|\/)(locations\/[^/]+)$/.exec(String(path ?? "").trim());
  return m ? m[1] : "";
}

export function tipoValido(t: unknown): t is TipoAzione {
  return (TIPI_AZIONE as readonly string[]).includes(String(t));
}

/** Solo https: Google rifiuta il resto, e un http sarebbe un bottone che avvisa «non sicuro». */
export function uriValido(u: unknown): boolean {
  const s = String(u ?? "").trim();
  if (s.length > 2000) return false;
  try {
    const x = new URL(s);
    return x.protocol === "https:" && !!x.hostname && !x.username && !x.password;
  } catch {
    return false;
  }
}

/** Un nome di link che appartiene a QUESTA scheda (l'id arriva dal browser). */
export function nomeDellaScheda(name: unknown, location: string): boolean {
  const s = String(name ?? "");
  return !!location && s.startsWith(`${location}/placeActionLinks/`) && !s.slice(location.length + 18).includes("/");
}

type Grezzo = {
  name?: unknown; placeActionType?: unknown; uri?: unknown;
  isPreferred?: unknown; providerType?: unknown; isEditable?: unknown;
};

export function normalizza(r: Grezzo): AzioneG {
  return {
    name: String(r.name ?? ""),
    tipo: String(r.placeActionType ?? ""),
    uri: String(r.uri ?? ""),
    preferito: r.isPreferred === true,
    nostro: String(r.providerType ?? "") === "MERCHANT",
    modificabile: r.isEditable === true,
  };
}

/**
 * Il dominio di un link, senza `www.`: Google accetta UN SOLO link per
 * dominio per ogni tipo di bottone (errore SCALABLE_DEEP_LINK_INVALID_MULTIPLICITY,
 * «there is a limit of one link per domain for each PlaceActionType»).
 */
export function dominioDi(uri: string): string {
  try {
    return new URL(String(uri ?? "").trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Il link gia' sulla scheda che un link nuovo andrebbe a scontrare: stesso
 * tipo, stesso dominio. Se e' nostro (modificabile) si AGGIORNA quello invece
 * di crearne un secondo che Google rifiuterebbe.
 */
export function linkDaAggiornare(lista: AzioneG[], tipo: string, uri: string): AzioneG | null {
  const d = dominioDi(uri);
  if (!d) return null;
  return lista.find((a) => a.tipo === tipo && a.modificabile && dominioDi(a.uri) === d) ?? null;
}

/** Per tipo (nell'ordine di TIPI_AZIONE, gli altri in fondo), il preferito per primo. */
export function ordina(lista: AzioneG[]): AzioneG[] {
  const pos = (t: string) => { const i = (TIPI_AZIONE as readonly string[]).indexOf(t); return i < 0 ? 99 : i; };
  return [...lista].sort((a, b) => pos(a.tipo) - pos(b.tipo) || Number(b.preferito) - Number(a.preferito) || Number(b.nostro) - Number(a.nostro));
}

/**
 * Chi sta in cima per un tipo:
 *  - "nostro"    : il preferito e' un link nostro → il meglio che si puo' fare;
 *  - "fornitore" : il preferito e' di un fornitore;
 *  - "conteso"   : nessun preferito, e ci sono link di fornitori: decide Google;
 *  - "solo-nostri": nessun preferito, solo link nostri;
 *  - "vuoto"     : niente.
 */
export type Cima = "nostro" | "fornitore" | "conteso" | "solo-nostri" | "vuoto";
export function cimaDi(lista: AzioneG[], tipo: string): Cima {
  const qui = lista.filter((a) => a.tipo === tipo);
  if (!qui.length) return "vuoto";
  const pref = qui.find((a) => a.preferito);
  if (pref) return pref.nostro ? "nostro" : "fornitore";
  return qui.some((a) => !a.nostro) ? "conteso" : "solo-nostri";
}

/**
 * Il motivo vero di un rifiuto. Google risponde «Request contains an invalid
 * argument» e mette il perche' nei `details` (ErrorCode della Place Actions
 * API): senza leggerli, lo schermo dice solo «argomento non valido».
 */
export const CODICI_ERRORE = [
  "UNVERIFIED_LOCATION", "INVALID_LOCATION_CATEGORY", "INVALID_URL", "URL_PROVIDER_NOT_ALLOWED",
  "TOO_MANY_VALUES", "DELETED_LINK", "LINK_ALREADY_EXISTS", "SCALABLE_DEEP_LINK_INVALID_MULTIPLICITY", "LINK_DOES_NOT_EXIST",
] as const;
export function codiceErrore(risposta: string): string {
  const m = new RegExp(`\\b(${CODICI_ERRORE.join("|")})\\b`).exec(String(risposta ?? ""));
  return m ? m[1] : "";
}

/** L'API non e' attivata nel progetto Google Cloud (errore 403 di Google). */
export function apiSpenta(messaggio: string): boolean {
  return /has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(String(messaggio ?? ""));
}

/**
 * Il link da proporre per «Prenota»: la pagina prenotazioni del sito, se il
 * sito ce l'ha, altrimenti il modulo nudo. Con `?ref=google`, cosi' la
 * prenotazione si conta come arrivata da Google.
 */
export function linkPrenotaSuggerito(origine: string, haPagina: boolean): string {
  let o = "";
  try {
    const u = new URL(String(origine ?? "").trim());
    if (u.protocol === "https:") o = u.origin;
  } catch { /* niente */ }
  return o ? `${o}${haPagina ? "/reservation" : "/reservation-embed"}?ref=google` : "";
}
