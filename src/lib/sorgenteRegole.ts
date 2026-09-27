/**
 * SORGENTE della prenotazione — da dove arriva il cliente.
 *
 * Questo file non importa niente: e' un elenco e un filtro.
 *
 * ⚠️ IL `ref` DELL'URL E' SCRITTO DALL'UTENTE, NON DA GOOGLE.
 * `?ref=google` lo puo' mettere chiunque, e quindi qui non si "legge" un
 * parametro: si controlla se somiglia a una voce di un elenco chiuso. Tutto
 * cio' che non e' nell'elenco diventa `web`, mai un errore e mai il valore
 * grezzo. E' una DICHIARAZIONE utile alle statistiche, non una prova: va
 * bene per sapere se la scheda Google porta gente, non per fatturarci sopra.
 *
 * ⚠️ L'ELENCO DEVE COMBACIARE CON IL `check` DI `reservations_source.sql`.
 * La colonna ha un vincolo in SQL: un valore fuori elenco non fa una riga
 * sbagliata, fa fallire l'inserimento — cioe' una prenotazione persa, con il
 * cliente che vede un errore e il tavolo che resta libero. C'e' una prova che
 * confronta questo file con quel .sql, apposta.
 */

/** Tutti i valori che la colonna `reservations.source` accetta. */
export const SORGENTI = ["web", "walkin", "phone", "google", "instagram", "qr"] as const;
export type Sorgente = (typeof SORGENTI)[number];

/**
 * Le sole che il PUBBLICO puo' dichiarare da un link.
 * `walkin` e `phone` no: quelle le scrive il ristoratore dall'admin, e se un
 * link potesse dichiararle si vedrebbero prenotazioni «al telefono» arrivate
 * dal sito di notte.
 */
export const SORGENTI_DA_LINK: Sorgente[] = ["google", "instagram", "qr"];

/** Sorgente di default quando non c'e' un `ref`, o non si riconosce. */
export const SORGENTE_DEFAULT: Sorgente = "web";

/**
 * Dal `ref` dell'URL alla sorgente da salvare.
 * Qualunque cosa non riconosciuta → `web`: mai un errore, mai il grezzo.
 */
export function sorgenteDaRef(grezzo: unknown): Sorgente {
  const s = String(grezzo ?? "").trim().toLowerCase();
  if (!s) return SORGENTE_DEFAULT;
  return (SORGENTI_DA_LINK as string[]).includes(s) ? (s as Sorgente) : SORGENTE_DEFAULT;
}

/**
 * Icona da mostrare per una sorgente. Le icone sono CINQUE, i valori sei:
 * `qr` porta quella del sito. Per chi guarda la lista prenotazioni sono la
 * stessa cosa — il cliente ha usato il sito — ma restano due canali diversi
 * per chi deve decidere se ristampare i volantini.
 */
export function iconaDiSorgente(s: string): string {
  return s === "qr" ? "web" : s;
}

/** Chiave di sessionStorage: il `ref` va ricordato per tutta la visita. */
export const CHIAVE_REF = "mdd_ref";
