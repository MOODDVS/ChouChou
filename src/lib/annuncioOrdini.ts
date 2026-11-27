/**
 * L'ANNUNCIO RIMANDATO DEGLI ORDINI — la parte che parla col database.
 * Le regole (quando, per chi) stanno in `annuncioRegole.ts`, che si prova.
 *
 * Tre momenti:
 *   1. ALL'ORDINE (checkout, ordine a mano dell'admin): `momentoAnnuncioOrdine`
 *      dice se annunciarlo subito o all'apertura del giorno del ritiro, e chi
 *      inserisce scrive `announce_at` solo nel secondo caso.
 *   2. NEL FRATTEMPO: `accodaTicket` non stampa e la notifica sul telefono
 *      non parte (`ordineInAttesa`); `/api/admin/orders?recent_paid` non lo
 *      mostra, quindi RestoHub non suona.
 *   3. ALL'APERTURA: `rilasciaAnnunci` (il job `annuncia-ordini`, ogni 5
 *      minuti, e di riserva ogni giro di RestoHub aperto) toglie l'attesa,
 *      stampa il ticket e manda la notifica. Il toast col suono arriva da
 *      solo: l'ordine compare in `recent_paid` come nuovo.
 *
 * ⚠️ Senza la migrazione #101 la colonna non c'e': chi inserisce riprova
 * senza (l'ordine si annuncia subito, com'era), e chi legge tratta l'errore
 * come «nessuna attesa». Niente si ferma per una colonna mancante.
 */
import { DateTime } from "luxon";
import { leggi, aggiorna, ambitoDiRiga, type Ambito } from "./admin/sede";
import { configRitiro } from "./schedule";
import { fusoDi } from "./fuso";
import { momentoAnnuncio, primaApertura, inAttesaDiAnnuncio } from "./annuncioRegole";
import { daStampare } from "./stampaRegole";
import { accodaTicket } from "./stampaCoda";
import { inviaPushOrdine } from "./push";

/** La colonna (migrazione #101). */
export const COLONNA_ANNUNCIO = "announce_at";

/** L'errore di Postgres dice che la #101 manca? */
export function manca101(errore: unknown): boolean {
  return String((errore as { message?: unknown } | null)?.message ?? errore ?? "").includes(COLONNA_ANNUNCIO);
}

/**
 * Quando annunciare un ordine con questo ritiro: `null` = subito, altrimenti
 * l'apertura del giorno del ritiro (ISO). Gli orari sono quelli del RITIRO
 * (`configRitiro`: orari d'apertura o service, giorni speciali compresi).
 * ⚠️ Un errore qui non deve fermare un ordine: si annuncia subito, com'era.
 */
export async function momentoAnnuncioOrdine(ambito: Ambito, ritiro: DateTime, servizio: string): Promise<string | null> {
  try {
    const fuso = await fusoDi(ambito);
    const cfg = await configRitiro(ritiro.setZone(fuso), ambito);
    return momentoAnnuncio({
      ritiro: ritiro.toISO(),
      adesso: DateTime.now().toISO(),
      fuso,
      apertura: primaApertura(cfg),
      servizio,
    });
  } catch (e) {
    console.error("[annuncio] momento:", String((e as Error)?.message ?? e));
    return null;
  }
}

/** Questo ordine aspetta ancora l'apertura? Lettura muta (o #101 assente) → no. */
export async function ordineInAttesa(id: string, location_id: string | null | undefined): Promise<boolean> {
  try {
    const { data, error } = await leggi("orders", ambitoDiRiga(location_id ?? null), COLONNA_ANNUNCIO)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return false;
    return inAttesaDiAnnuncio((data as Record<string, unknown>)[COLONNA_ANNUNCIO]);
  } catch {
    return false;
  }
}

interface RigaDaAnnunciare {
  id: string;
  status: string | null;
  payment_method: string | null;
  location_id: string | null;
  customer_name: string | null;
  total_cents: number | null;
}

/**
 * GLI ANNUNCI SCADUTI, adesso: ticket in cucina e notifica sul telefono.
 * Rende quanti ordini ha annunciato.
 *
 * ⚠️ OGNI ORDINE SI PRENDE PRIMA DI ANNUNCIARLO: `announce_at` torna `null`
 * con un update che vale solo se era ancora pieno. Il job e RestoHub aperto
 * su due tablet possono girare nello stesso secondo: uno solo vince, e la
 * cucina riceve un ticket, non tre.
 * ⚠️ Un ordine annullato (o abbandonato) nel frattempo si prende e basta:
 * niente ticket, niente suono.
 */
export async function rilasciaAnnunci(ambito: Ambito, limite = 50): Promise<number> {
  const adesso = new Date().toISOString();
  const { data, error } = await leggi(
    "orders",
    ambito,
    "id, status, payment_method, location_id, customer_name, total_cents",
  )
    .not(COLONNA_ANNUNCIO, "is", null)
    .lte(COLONNA_ANNUNCIO, adesso)
    .order(COLONNA_ANNUNCIO, { ascending: true })
    .limit(limite);
  if (error || !data?.length) return 0;

  let annunciati = 0;
  for (const r of data as unknown as RigaDaAnnunciare[]) {
    const { data: presa, error: ePresa } = await aggiorna("orders", ambitoDiRiga(r.location_id), { [COLONNA_ANNUNCIO]: null })
      .eq("id", r.id)
      .not(COLONNA_ANNUNCIO, "is", null)
      .select("id");
    if (ePresa || !presa?.length) continue; // l'ha preso un altro giro
    if (!daStampare(r.status, r.payment_method)) continue; // annullato o mai pagato
    await accodaTicket({ id: r.id, status: r.status, payment_method: r.payment_method, location_id: r.location_id });
    void inviaPushOrdine(
      { numero: String(r.id).slice(0, 8), customer_name: r.customer_name ?? "", total_cents: Number(r.total_cents) || 0 },
      ambitoDiRiga(r.location_id),
    );
    annunciati++;
  }
  return annunciati;
}
