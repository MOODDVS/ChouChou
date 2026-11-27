/**
 * QUANDO SI ANNUNCIA UN ORDINE IN CUCINA — regole pure (27/11/2026, Enzo).
 *
 * Un ordine preso a locale CHIUSO per un altro giorno (stanotte per domani
 * sera, o stamattina prima dell'apertura) non fa uscire il ticket e non fa
 * suonare RestoHub quando arriva: lo fa ALL'APERTURA DEL GIORNO DEL RITIRO
 * («apertura del giorno»: la prima fascia di quel giorno, anche per un
 * ritiro della sera). Fino ad allora l'ordine e' «in attesa d'annuncio»
 * (`orders.announce_at`, migrazione #101).
 *
 * Partono SUBITO, come sempre: l'email di conferma al cliente e l'email
 * «Nouvelle commande» al ristorante (traccia scritta, silenziosa). Si
 * spostano all'apertura: il ticket, il suono e il toast di RestoHub, la
 * notifica sul telefono.
 *
 * ⚠️ Perche': un ticket stampato giovedi' notte con «RITIRO 19:30» finiva
 * sul ferma-comande insieme a quelli di venerdi' mattina (la fascia nera del
 * giorno aiuta, ma il foglio c'era), e se la stampante era spenta andava in
 * errore dopo mezz'ora di tentativi: venerdi' non usciva niente. Un suono a
 * mezzanotte non lo sente nessuno; a mezzogiorno si'.
 *
 * Nessun import dal database: si prova in vitest.
 */
import { DateTime } from "luxon";
import { alTavolo, type OrariDelGiorno } from "./ordiniRegole";

/** Se quel giorno non ha nessuna apertura leggibile (chiuso, orari storti),
 *  l'ordine si annuncia comunque: questi minuti prima del ritiro. */
export const RIPIEGO_PRIMA_DEL_RITIRO_MIN = 120;

/** "HH:MM" (anche "HH:MM:SS", le colonne `time` di Postgres) → minuti. */
function minuti(hhmm: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

/**
 * LA PRIMA APERTURA DEL GIORNO: la fascia accesa che apre prima (pranzo o
 * cena), «HH:mm». `null` = quel giorno non apre (o non si sa).
 * ⚠️ Una fascia senza chiusura leggibile non conta, come in
 * `prossimaApertura`: meglio il ripiego che un orario inventato.
 */
export function primaApertura(cfg: OrariDelGiorno | null | undefined): string | null {
  if (!cfg) return null;
  const aperture: number[] = [];
  const fascia = (attiva: boolean | null | undefined, apre: unknown, chiude: unknown) => {
    if (attiva === false) return;
    const a = minuti(apre);
    if (a === null || minuti(chiude) === null) return;
    aperture.push(a);
  };
  fascia(cfg.lunch_active, cfg.lunch_open, cfg.lunch_close);
  fascia(cfg.dinner_active, cfg.dinner_open, cfg.dinner_close);
  if (!aperture.length) return null;
  const m = Math.min(...aperture);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * QUANDO ANNUNCIARE questo ordine. `null` = SUBITO (com'e' sempre stato);
 * altrimenti l'istante ISO (UTC) dell'apertura del giorno del ritiro.
 *
 * Una regola sola copre tutti i casi:
 *   annuncio = apertura del giorno del ritiro; se e' gia' passata → subito.
 *   · stanotte per domani 19:30      → domani all'apertura (12:00);
 *   · stamattina alle 9 per le 12:30 → oggi alle 12:00;
 *   · alle 15 (fra pranzo e cena) per le 19:30 → subito: l'apertura di oggi
 *     e' passata, in cucina c'e' gia' qualcuno.
 *
 * ⚠️ Al tavolo MAI: chi ordina dal QR e' seduto, e mangia adesso.
 * ⚠️ Mai dopo il ritiro: un ordine non si annuncia quando il cliente e' gia'
 * al banco. Senza apertura leggibile: `RIPIEGO_PRIMA_DEL_RITIRO_MIN` prima.
 */
export function momentoAnnuncio(o: {
  ritiro: unknown;
  adesso: unknown;
  fuso: string;
  apertura: string | null;
  servizio?: unknown;
}): string | null {
  if (alTavolo(o.servizio)) return null;
  const ritiro = DateTime.fromISO(String(o.ritiro ?? ""), { zone: o.fuso });
  const adesso = DateTime.fromISO(String(o.adesso ?? ""), { zone: o.fuso });
  if (!ritiro.isValid || !adesso.isValid) return null;
  const a = minuti(o.apertura);
  let quando = a !== null
    ? ritiro.startOf("day").set({ hour: Math.floor(a / 60), minute: a % 60 })
    : ritiro.minus({ minutes: RIPIEGO_PRIMA_DEL_RITIRO_MIN });
  if (quando > ritiro) quando = ritiro;
  if (quando <= adesso) return null;
  return quando.toUTC().toISO();
}

/** Questo ordine aspetta ancora il suo annuncio? (`announce_at` nel futuro) */
export function inAttesaDiAnnuncio(announceAt: unknown, adessoMs: number = Date.now()): boolean {
  if (announceAt === null || announceAt === undefined || announceAt === "") return false;
  const t = new Date(String(announceAt)).getTime();
  return Number.isFinite(t) && t > adessoMs;
}

/** L'annuncio rimandato e' gia' scaduto (lo deve fare il giro adesso)? */
export function annuncioScaduto(announceAt: unknown, adessoMs: number = Date.now()): boolean {
  if (announceAt === null || announceAt === undefined || announceAt === "") return false;
  const t = new Date(String(announceAt)).getTime();
  return Number.isFinite(t) && t <= adessoMs;
}
