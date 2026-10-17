/**
 * QUANDO SI PUO' RITIRARE — regole pure (nessun database).
 *
 * Due scelte del ristoratore, in Réglages → Cuisine → Commandes en ligne:
 *
 *   1. DA DOVE VENGONO GLI ORARI DI RITIRO (`orders_slot_source`)
 *        "hours"     gli orari d'apertura (pranzo e cena, tabella settings) —
 *                    com'e' sempre stato;
 *        "services"  i service delle prenotazioni (Midi 12:00–14:00, Soir…),
 *                    con le loro chiusure: un service chiuso perche' pieno
 *                    chiude anche il ritiro di quel service.
 *
 *   2. FINO A QUANTI GIORNI IN ANTICIPO (`orders_future_days`)
 *        0           solo oggi — com'e' sempre stato;
 *        2·7·14·30   il cliente sceglie il giorno nel checkout.
 *
 * ⚠️ Le stesse risposte servono al sito (gli orari che propone), al checkout
 * (che li ricontrolla) e agli ordini presi a mano in admin: per questo
 * passano tutti da UN punto, `configRitiro` in `schedule.ts`. Non da
 * `configGiornoEffettiva`, che resta l'orario d'APERTURA: la sala, la home
 * dell'admin e gli orari pubblici non devono cambiare perche' il ritiro
 * segue i service.
 */
import { SERVIZI_WIDGET } from "./reservationI18n";

export const FONTI_ORARI = ["hours", "services"] as const;
export type FonteOrari = (typeof FONTI_ORARI)[number];

/** Valore illeggibile o vuoto → gli orari d'apertura, come prima. */
export function fonteOrari(v: unknown): FonteOrari {
  return String(v ?? "").trim() === "services" ? "services" : "hours";
}

/** Le finestre fra cui si sceglie in admin. 0 = solo oggi. */
export const GIORNI_AVANTI = [2, 7, 14, 30] as const;

/** Valore fuori elenco → 0 (solo oggi): un numero qualunque arrivato dal
 *  browser non deve aprire gli ordini per l'anno prossimo. */
export function giorniAvanti(v: unknown): number {
  const n = Math.floor(Number(String(v ?? "").trim()));
  return (GIORNI_AVANTI as readonly number[]).includes(n) ? n : 0;
}

/** La chiave di un service come la usa il widget (`midi`, `soir`…), dalla
 *  chiave o dall'etichetta francese. `null` = service non riconosciuto. */
export function chiaveServizio(sv: { key?: unknown; label?: unknown }): string | null {
  const k = String(sv.key ?? "");
  if (k && SERVIZI_WIDGET[k]) return k;
  const lab = String(sv.label ?? "").trim().toLowerCase();
  if (!lab) return null;
  const hit = Object.entries(SERVIZI_WIDGET).find(([, vv]) => vv.fr.toLowerCase() === lab);
  return hit ? hit[0] : null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Un service della configurazione prenotazioni, come serve qui. */
export interface ServizioOrari {
  key: string;
  from: string;
  to: string;
  /** 0 = domenica … 6 = sabato; vuoto = tutti i giorni. */
  days: number[];
}

/** Dal JSON di `reservation_services` ai service leggibili. */
export function serviziDaConfig(grezzo: unknown): ServizioOrari[] {
  let arr: unknown;
  try {
    arr = typeof grezzo === "string" ? JSON.parse(grezzo || "[]") : grezzo;
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: ServizioOrari[] = [];
  for (const sv of arr as Record<string, unknown>[]) {
    const key = chiaveServizio(sv ?? {});
    const from = String(sv?.from ?? "");
    const to = String(sv?.to ?? "");
    if (!key || !HHMM.test(from) || !HHMM.test(to) || to <= from) continue;
    const days = Array.isArray(sv.days)
      ? (sv.days as unknown[]).map((d) => Math.floor(Number(d))).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    out.push({ key, from, to, days });
  }
  return out;
}

/**
 * Le FINESTRE DI RITIRO di un giorno, dai service delle prenotazioni.
 *
 * Riportate a due — pranzo e cena — perche' e' la forma che tutto il resto
 * del motore conosce (`ConfigGiorno`): un service che comincia prima delle
 * 16:00 sta col pranzo, gli altri con la cena; piu' service dalla stessa
 * parte diventano una finestra sola, dal primo inizio all'ultima fine.
 *
 * @param speciale  il giorno speciale «ouvert» di quel giorno, se c'e', con
 *                  la sua lista di service (`null` = tutti, `[]` = nessuno);
 *                  `undefined` = giorno normale.
 * @param chiusi    i service chiusi quel giorno (anche quelli chiusi «fino a
 *                  riapertura»): non si ritira in un service chiuso.
 */
export function finestreDaServizi(
  servizi: ServizioOrari[],
  dow: number,
  speciale: { services: string[] | null } | undefined,
  chiusi: Set<string>,
): { lunch: [string, string] | null; dinner: [string, string] | null } {
  const attivi = servizi.filter((sv) => {
    if (chiusi.has(sv.key)) return false;
    if (speciale) {
      const lista = speciale.services;
      return lista === null || lista.includes(`${sv.key}|${sv.from}-${sv.to}`) || lista.includes(sv.key);
    }
    return sv.days.length === 0 || sv.days.includes(dow);
  });
  const unisci = (xs: ServizioOrari[]): [string, string] | null =>
    xs.length
      ? [xs.reduce((m, s) => (s.from < m ? s.from : m), xs[0].from), xs.reduce((m, s) => (s.to > m ? s.to : m), xs[0].to)]
      : null;
  return {
    lunch: unisci(attivi.filter((s) => s.from < "16:00")),
    dinner: unisci(attivi.filter((s) => s.from >= "16:00")),
  };
}
