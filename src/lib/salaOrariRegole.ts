/**
 * GLI ORARI DELLA SALA — quando si puo' ordinare dal tavolo (e chiamare il
 * cameriere). Regole pure: le legge `configSala` (schedule.ts).
 *
 * Due fonti, scelte nei Réglages (`orders_table_hours`):
 *   · `hours`    — gli orari d'apertura: finche' la cucina e' aperta. E' quello
 *                  che c'era prima, e resta il ripiego.
 *   · `services` — solo i service delle prenotazioni scelti
 *                  (`orders_table_services`), piu' un margine dopo la fine
 *                  (`orders_table_extend`). Educazione: solo «Déjeuner».
 *
 * ⚠️ LE CHIUSURE DEI SERVICE NON FERMANO LA SALA. Un «Soir» chiuso alle
 * prenotazioni perche' COMPLET non deve fermare chi e' gia' seduto: per questo
 * qui le chiusure per data e «fino a riapertura» non contano. I GIORNI chiusi
 * del calendario (`special_days`) invece si': quelli li applica `configSala`.
 *
 * ⚠️ LA FINE DI UN SERVICE E' L'ULTIMO ARRIVO, non l'ora in cui ci si alza:
 * chi e' seduto alle 14:00 vuole ancora il dolce. Il margine (0–90 min)
 * allunga la fine di ogni finestra.
 */
import { finestreDaServizi, type ServizioOrari } from "./ordiniGiorniRegole";

export const FONTI_SALA = ["hours", "services"] as const;
export type FonteSala = (typeof FONTI_SALA)[number];

/** Qualunque cosa che non sia `services` → gli orari d'apertura, come prima. */
export function fonteSala(v: unknown): FonteSala {
  return String(v ?? "").trim() === "services" ? "services" : "hours";
}

export const PROLUNGHE_SALA = [0, 30, 60, 90] as const;

/** Minuti dopo la fine del service. Fuori elenco → 0. */
export function prolungaSala(v: unknown): number {
  const n = Math.floor(Number(String(v ?? "").trim()));
  return (PROLUNGHE_SALA as readonly number[]).includes(n) ? n : 0;
}

/** I service scelti, per chiave. `null` = TUTTI (anche quelli aggiunti
 *  domani): valore vuoto, illeggibile o lista vuota. */
export function serviziSalaDaConfig(v: unknown): string[] | null {
  let arr: unknown = v;
  if (typeof v === "string") {
    if (!v.trim()) return null;
    try {
      arr = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const out: string[] = [];
  for (const x of arr) {
    const k = typeof x === "string" ? x.trim().slice(0, 40) : "";
    if (k && !out.includes(k)) out.push(k);
  }
  return out.length > 0 ? out : null;
}

/**
 * I service che valgono per la sala.
 *
 * ⚠️ Se NESSUNO dei scelti esiste piu' (rinominato, cancellato) si prendono
 * TUTTI e `orfana` lo dice ai Réglages: una sala che si spegne in silenzio
 * e' un QR sul tavolo che dice «fermé» a pranzo, e nessuno capisce perche'.
 */
export function serviziDellaSala(
  servizi: ServizioOrari[],
  scelta: string[] | null,
): { servizi: ServizioOrari[]; orfana: boolean } {
  if (!scelta) return { servizi, orfana: false };
  const scelti = servizi.filter((s) => scelta.includes(s.key));
  if (scelti.length === 0 && servizi.length > 0) return { servizi, orfana: true };
  return { servizi: scelti, orfana: false };
}

/** «HH:mm» + minuti, sull'orologio di 24 ore: «23:30» + 60 = «00:30».
 *  ⚠️ Una fine prima dell'inizio e' una finestra che scavalca la mezzanotte,
 *  e `servizioInCorso` la legge gia' cosi'. */
export function allungaOra(hhmm: string, minuti: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (((h * 60 + m + minuti) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Le finestre della sala di un giorno, dai service scelti: pranzo e cena come
 * per il ritiro (`finestreDaServizi`), MA senza le chiusure dei service, e
 * con il margine dopo la fine.
 */
export function finestreSala(
  servizi: ServizioOrari[],
  dow: number,
  speciale: { services: string[] | null } | undefined,
  scelta: string[] | null,
  prolunga: number,
): { lunch: [string, string] | null; dinner: [string, string] | null } {
  const f = finestreDaServizi(serviziDellaSala(servizi, scelta).servizi, dow, speciale, new Set());
  const allunga = (w: [string, string] | null): [string, string] | null =>
    w ? [w[0], prolunga > 0 ? allungaOra(w[1], prolunga) : w[1]] : null;
  return { lunch: allunga(f.lunch), dinner: allunga(f.dinner) };
}
