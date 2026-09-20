import { DateTime } from "luxon";
import { calcolaSlotGiorno, TIMEZONE } from "./slots";
import { configGiornoEffettiva } from "./schedule";
import type { Ambito } from "./admin/sede";

/**
 * La RISPOSTA degli slot, calcolata una volta sola.
 *
 * ⚠️ Esiste perche' ci sono DUE porte sulla stessa domanda, e cambiano solo
 * per come trovano la sede:
 *   - `/api/slots`        → pubblica, la sede e' quella del sito (`ambitoPubblico`)
 *   - `/api/admin/slots`  → admin,    la sede e' quella scelta nell'header
 *
 * Il modale «nuovo ordine» dell'admin chiamava quella PUBBLICA, e quindi
 * mostrava sempre gli orari del PRIMO punto qualunque sede fosse selezionata:
 * il ristoratore di Jourdan vedeva i turni di Stockel. Nessun errore, solo
 * orari di qualcun altro.
 *
 * Due copie del calcolo sarebbero state peggio: il sito e l'admin devono
 * essere d'accordo su quando si puo' ordinare, o il cliente prende uno slot
 * che il checkout rifiuta.
 */

export async function slotsDelMese(
  mese: string,
  ambito: Ambito,
): Promise<{ closed: string[] } | { errore: string }> {
  if (!/^\d{4}-\d{2}$/.test(mese)) return { errore: "err.month" };
  const [anno, m] = mese.split("-").map(Number);
  const primo = DateTime.fromObject({ year: anno, month: m, day: 1 }, { zone: TIMEZONE });
  const closed: string[] = [];
  if (primo.isValid) {
    const nGiorni = primo.daysInMonth ?? 31;
    for (let d = 1; d <= nGiorni; d++) {
      const giorno = primo.set({ day: d });
      const cfg = await configGiornoEffettiva(giorno, ambito);
      const pranzo = !!(cfg && cfg.lunch_active && cfg.lunch_open && cfg.lunch_close);
      const cena = !!(cfg && cfg.dinner_active && cfg.dinner_open && cfg.dinner_close);
      if (!pranzo && !cena) closed.push(giorno.toFormat("yyyy-MM-dd"));
    }
  }
  return { closed };
}

export async function slotsDelGiorno(
  data: string | null,
  ambito: Ambito,
): Promise<{ lunch: string[]; dinner: string[]; closed: boolean } | { errore: string }> {
  const adesso = DateTime.now().setZone(TIMEZONE);

  // Oggi = si filtrano gli slot gia' passati; un giorno FUTURO = inizio
  // giornata. Date passate o non valide ripiegano su oggi.
  let ora = adesso;
  if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
    const d = DateTime.fromISO(data, { zone: TIMEZONE });
    if (d.isValid && d.startOf("day") >= adesso.startOf("day")) {
      ora = d.hasSame(adesso, "day") ? adesso : d.startOf("day");
    }
  }

  const config = await configGiornoEffettiva(ora, ambito);
  // Niente ripiego: se il database non risponde o la riga manca, lo si dice.
  if (!config) return { errore: "err.hoursConfig" };

  const { lunch, dinner } = calcolaSlotGiorno(ora, config);

  // Giorno CHIUSO: ne' pranzo ne' cena attivi. Diverso da «aperto ma slot
  // gia' passati», dove `closed` e' falso e le liste possono essere vuote.
  const closed = !(
    (config.lunch_active && config.lunch_open && config.lunch_close) ||
    (config.dinner_active && config.dinner_open && config.dinner_close)
  );
  return { lunch, dinner, closed };
}
