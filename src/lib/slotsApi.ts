import { DateTime } from "luxon";
import { calcolaSlotGiorno } from "./slots";
import { fusoDi } from "./fuso";
import { configRitiro } from "./schedule";
import { leggiConfig } from "./admin/sede";
import { giorniAvanti } from "./ordiniGiorniRegole";
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
  const fuso = await fusoDi(ambito);
  const primo = DateTime.fromObject({ year: anno, month: m, day: 1 }, { zone: fuso });
  const closed: string[] = [];
  if (primo.isValid) {
    const nGiorni = primo.daysInMonth ?? 31;
    for (let d = 1; d <= nGiorni; d++) {
      const giorno = primo.set({ day: d });
      const cfg = await configRitiro(giorno, ambito);
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
  const fuso = await fusoDi(ambito);
  const adesso = DateTime.now().setZone(fuso);

  // Oggi = si filtrano gli slot gia' passati; un giorno FUTURO = inizio
  // giornata. Date passate o non valide ripiegano su oggi.
  let ora = adesso;
  if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
    const d = DateTime.fromISO(data, { zone: fuso });
    if (d.isValid && d.startOf("day") >= adesso.startOf("day")) {
      ora = d.hasSame(adesso, "day") ? adesso : d.startOf("day");
    }
  }

  const config = await configRitiro(ora, ambito);
  // Niente ripiego: se il database non risponde o la riga manca, lo si dice.
  if (!config) return { errore: "err.hoursConfig" };

  const { lunch, dinner } = calcolaSlotGiorno(ora, config, fuso);

  // Giorno CHIUSO: ne' pranzo ne' cena attivi. Diverso da «aperto ma slot
  // gia' passati», dove `closed` e' falso e le liste possono essere vuote.
  const closed = !(
    (config.lunch_active && config.lunch_open && config.lunch_close) ||
    (config.dinner_active && config.dinner_open && config.dinner_close)
  );
  return { lunch, dinner, closed };
}

/** Fino a quanti giorni dopo oggi si puo' ordinare da asporto (0 = solo oggi).
 *  Lettura muta → 0: meglio solo oggi che aprire un calendario per sbaglio. */
export async function giorniAvantiDi(ambito: Ambito): Promise<number> {
  try {
    const { valori } = await leggiConfig(ambito, ["orders_future_days"]);
    return giorniAvanti(valori.get("orders_future_days"));
  } catch {
    return 0;
  }
}

/**
 * I GIORNI IN CUI IL CLIENTE PUO' RITIRARE: oggi e i prossimi
 * `orders_future_days`, solo quelli con almeno un orario libero.
 *
 * ⚠️ Con la finestra a 0 rende solo oggi, e il sito si comporta come prima:
 * nessuna scelta del giorno. ⚠️ «Almeno un orario» e non «aperto»: oggi
 * aperto ma con gli orari gia' passati non e' un giorno in cui si puo'
 * ordinare, e proporlo farebbe scegliere un giorno vuoto.
 */
export async function giorniOrdinabili(
  ambito: Ambito,
): Promise<{ avanti: number; oggi: string; giorni: string[] }> {
  const fuso = await fusoDi(ambito);
  const adesso = DateTime.now().setZone(fuso);
  const avanti = await giorniAvantiDi(ambito);
  const giorni: string[] = [];
  for (let d = 0; d <= avanti; d++) {
    const ora = d === 0 ? adesso : adesso.plus({ days: d }).startOf("day");
    const cfg = await configRitiro(ora, ambito);
    if (!cfg) continue;
    const { lunch, dinner } = calcolaSlotGiorno(ora, cfg, fuso);
    if (lunch.length || dinner.length) giorni.push(ora.toFormat("yyyy-MM-dd"));
  }
  // `oggi` nel fuso del RISTORANTE: il sito scrive «Oggi»/«Domani» da qui, non
  // dall'orologio del telefono (un cliente all'estero vedrebbe il giorno sbagliato).
  return { avanti, oggi: adesso.toFormat("yyyy-MM-dd"), giorni };
}

/**
 * Il giorno chiesto dal SITO PUBBLICO e' dentro la finestra? (Oggi … oggi +
 * `orders_future_days`.) ⚠️ L'admin non passa di qui: un ordine a mano per
 * fra un mese lo puo' prendere chi sta al telefono, il sito no.
 */
export async function giornoAmmesso(data: string | null, ambito: Ambito): Promise<boolean> {
  if (!data) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const fuso = await fusoDi(ambito);
  const oggi = DateTime.now().setZone(fuso).startOf("day");
  const d = DateTime.fromISO(data, { zone: fuso }).startOf("day");
  if (!d.isValid) return false;
  const diff = Math.round(d.diff(oggi, "days").days);
  return diff >= 0 && diff <= (await giorniAvantiDi(ambito));
}

