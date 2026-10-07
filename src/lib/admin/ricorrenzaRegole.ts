import { DateTime } from "luxon";

/**
 * LA PROSSIMA VOLTA — quando torna una nota ricorrente.
 *
 * Regole pure, nessuna rete e nessun database: si provano a parte
 * (`tests/ricorrenza.test.mjs`) perche' qui dentro gli sbagli non si vedono.
 * Una ricorrenza sbagliata non da' errore: da' una nota che torna il giorno
 * dopo quello giusto, e nessuno collega le due cose.
 */

export type Ricorrenza =
  | { ogni: "giorno"; ora: string }
  | { ogni: "settimana"; ora: string; dow: number }
  | { ogni: "mese"; ora: string; dom: number }
  | { ogni: "anno"; ora: string; mese: number; dom: number };

export const OGNI = ["giorno", "settimana", "mese", "anno"] as const;

/** «09:30» → { h: 9, m: 30 }. Fuori dall'orologio o illeggibile → mezzogiorno.
 *  ⚠️ Mezzogiorno e non mezzanotte: una nota «di oggi» che nasce alle 00:00 e'
 *  gia' in ritardo appena la si scrive, e si colora di rosso da sola. */
function oraDi(v: unknown): { h: number; m: number } {
  const x = String(v ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!x) return { h: 12, m: 0 };
  const h = Number(x[1]);
  const m = Number(x[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return { h: 12, m: 0 };
  return { h, m };
}

/**
 * La regola, ripulita — o `null` se non e' una regola.
 *
 * ⚠️ Qui passa tutto cio' che arriva dal browser. Un `dom: 47` scritto a mano
 * non deve diventare una data che luxon "aggiusta" scivolando al mese dopo:
 * si rifiuta la regola, e la nota resta una nota normale.
 */
export function leggiRicorrenza(v: unknown): Ricorrenza | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const ogni = String(r.ogni ?? "");
  const { h, m } = oraDi(r.ora);
  const ora = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  if (ogni === "giorno") return { ogni, ora };
  if (ogni === "settimana") {
    const dow = Number(r.dow);
    if (!Number.isInteger(dow) || dow < 1 || dow > 7) return null;
    return { ogni, ora, dow };
  }
  if (ogni === "mese") {
    const dom = Number(r.dom);
    if (!Number.isInteger(dom) || dom < 1 || dom > 31) return null;
    return { ogni, ora, dom };
  }
  if (ogni === "anno") {
    const mese = Number(r.mese);
    const dom = Number(r.dom);
    if (!Number.isInteger(mese) || mese < 1 || mese > 12) return null;
    if (!Number.isInteger(dom) || dom < 1 || dom > 31) return null;
    return { ogni, ora, mese, dom };
  }
  return null;
}

/**
 * La prossima scadenza DOPO `da`, nel fuso del locale.
 *
 * ⚠️ Strettamente dopo. Spuntando alle 09:00 una nota che scade ogni giorno
 * alle 09:00, «al primo momento valido» renderebbe lo stesso istante: la nota
 * tornerebbe da fare all'istante, e chi l'ha spuntata la vedrebbe riaccendersi
 * sotto il dito.
 *
 * ⚠️ Il giorno 31 nei mesi che non ce l'hanno — e il 29 febbraio — si
 * APPOGGIANO all'ultimo giorno del mese, non scivolano al primo del mese dopo.
 * «Ogni 31» vuol dire «a fine mese»: a marzo il 31, ad aprile il 30. Luxon da
 * solo, con `{ day: 31 }` su aprile, va al 1° maggio — un giorno di ritardo
 * che si presenta quattro volte l'anno.
 */
export function prossima(regola: Ricorrenza, daISO: string, fuso: string): string | null {
  const da = DateTime.fromISO(String(daISO || ""), { zone: fuso });
  if (!da.isValid) return null;
  const { h, m } = oraDi(regola.ora);

  const conGiorno = (base: DateTime, giorno: number): DateTime =>
    base.set({ day: Math.min(giorno, base.daysInMonth ?? 28), hour: h, minute: m, second: 0, millisecond: 0 });

  if (regola.ogni === "giorno") {
    const oggi = da.set({ hour: h, minute: m, second: 0, millisecond: 0 });
    return (oggi > da ? oggi : oggi.plus({ days: 1 })).toISO();
  }

  if (regola.ogni === "settimana") {
    // Luxon conta i giorni come la regola: 1 = lunedi', 7 = domenica.
    let d = da.set({ weekday: regola.dow as 1, hour: h, minute: m, second: 0, millisecond: 0 });
    if (d <= da) d = d.plus({ weeks: 1 });
    return d.toISO();
  }

  if (regola.ogni === "mese") {
    let d = conGiorno(da, regola.dom);
    if (d <= da) d = conGiorno(da.plus({ months: 1 }).startOf("month"), regola.dom);
    return d.toISO();
  }

  // anno
  let d = conGiorno(da.set({ month: regola.mese }).startOf("month"), regola.dom);
  if (d <= da) d = conGiorno(da.plus({ years: 1 }).set({ month: regola.mese }).startOf("month"), regola.dom);
  return d.toISO();
}

/**
 * LA REGOLA IN PAROLE: «chaque lundi à 09:00».
 *
 * ⚠️ La FRASE sta qui, i NOMI arrivano da fuori. Il browser sa fare i nomi dei
 * giorni con `Intl`, il server con luxon: chiedendo il nome a chi chiama, la
 * forma della frase resta una sola e nessuno dei due si porta dietro la
 * libreria dell'altro. Scritta due volte, il bigliettino nella colonna e
 * l'email alla persona avrebbero detto la stessa ricorrenza in due modi — e
 * uno dei due sarebbe rimasto indietro.
 */
export function descrivi(
  r: Ricorrenza | null | undefined,
  opz: { t: (k: string) => string; giorno: (dow: number) => string; mese: (m: number) => string },
): string {
  if (!r || !r.ogni) return "";
  const CHIAVI: Record<string, string> = {
    giorno: "home.repDay", settimana: "home.repWeek", mese: "home.repMonth", anno: "home.repYear",
  };
  const chiave = CHIAVI[r.ogni];
  if (!chiave) return "";
  return opz
    .t(chiave)
    .replace("{h}", String(r.ora ?? "09:00"))
    .replace("{g}", "dow" in r && r.dow ? opz.giorno(r.dow) : "")
    .replace("{n}", "dom" in r && r.dom ? String(r.dom) : "")
    .replace("{m}", "mese" in r && r.mese ? opz.mese(r.mese) : "");
}
