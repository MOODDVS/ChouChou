/**
 * GLI STATI DEI TAVOLI SULLA MAPPA DEL PALMARE (deciso con Enzo, 25/10/2026).
 *
 * Il COLORE dice cosa succede adesso, il BORDO BIANCO cosa sta per arrivare,
 * le ICONE come si paga:
 *  1. libero ............ nessun colore, nessun bordo;
 *  2. prenotato entro 60 min ... bordo bianco spesso + conto alla rovescia
 *     (anche su un tavolo occupato: va liberato nell'ora);
 *  3. conto aperto (QR) . ARANCIONE da convalidare, poi VERDE; icona QR;
 *  4. QR, ognuno paga subito ... VERDE con QR + carta;
 *     seduto dal cameriere ...... VERDE, senza icone;
 *  5. ROSSO: tempo al tavolo finito e una prenotazione sugli stessi tavoli
 *     inizia entro 15 minuti (o e' gia' in ritardo); minuti di sforamento e
 *     ora della prossima;
 *  6. BLU: il tavolo ha chiesto il conto (icona dell'addizione).
 * Piu' stati insieme: blu > rosso > arancione > verde > libero. Il bordo si
 * somma a tutti tranne il rosso (che lo contiene gia').
 *
 * ⚠️ Regole pure, nessun import: si provano in vitest (tests/statoTavoli).
 * ⚠️ «Occupato» segue la stessa finestra di `tavoliNonDisponibili`: chi e'
 * seduto da piu' del suo tempo + 20 minuti di margine non conta piu' (l'admin
 * lo segna «Fini» da solo), un conto aperto conta sempre.
 */

export type ColoreTavolo = "libero" | "arancio" | "verde" | "rosso" | "blu";
export type IconaTavolo = "qr" | "carta" | "addizione";

export interface StatoTavolo {
  colore: ColoreTavolo;
  /** Bordo bianco: una prenotazione arriva entro `FINESTRA_ARRIVO_MINUTI`. */
  bordo: boolean;
  icone: IconaTavolo[];
  /** «20:30»: l'ora della prossima prenotazione (il conto alla rovescia). */
  arrivo: string | null;
  /** Solo col rosso: quando e' finito il tempo, e chi arriva. */
  sforo: { fine: string; prossima: string } | null;
}

export const FINESTRA_ARRIVO_MINUTI = 60;
/** Il rosso: la prossima prenotazione inizia entro questi minuti. */
export const SOGLIA_ROSSO_MINUTI = 15;
/** Una prenotazione in ritardo resta «in arrivo» per questi minuti. */
export const RITARDO_ATTESO_MINUTI = 30;
const MARGINE_FINE_MINUTI = 20; // lo stesso di salaInstallaRegole

export interface RigaStato {
  id: string;
  heure?: unknown;
  status?: unknown;
  tables?: unknown;
  tab_status?: unknown;
  tab_table_id?: unknown;
  service_key?: unknown;
  extra_minutes?: unknown;
}
export interface ContoStato {
  id: string;
  tab_status?: unknown;
  tab_table_id?: unknown;
  tables?: unknown;
}

function minuti(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function hhmm(m: number): string {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}
function tavoliDi(r: { tables?: unknown; tab_table_id?: unknown }): string[] {
  let t: unknown = r.tables;
  if (typeof t === "string") {
    try { t = JSON.parse(t); } catch { t = []; }
  }
  const ids = Array.isArray(t) ? t.map(String).filter(Boolean) : [];
  const conto = String(r.tab_table_id ?? "");
  return [...new Set(conto ? [conto, ...ids] : ids)];
}
const apertoConto = (s: unknown) => s === "pending" || s === "open";

interface Sessione {
  id: string;
  tavoli: string[];
  conto: "pending" | "open" | null;
  /** Fine del tempo al tavolo in minuti (anche oltre le 24), o null. */
  fine: number | null;
  inizio: number | null;
}

export function statiTavoli(opz: {
  tavoli: string[];
  /** Le prenotazioni di oggi: pending, confirmed, seated. */
  righe: RigaStato[];
  /** I conti aperti (anche di ieri). */
  conti: ContoStato[];
  /** Le chiamate aperte: `reason = 'bill'` = ha chiesto il conto. */
  chiamate: { table_id: string | null; reason: string | null }[];
  /** Le sedute (id prenotazione) con ordini dal QR pagati subito online. */
  qrDiretti: Set<string>;
  adessoHHmm: string;
  durate: { perServizio: Record<string, number>; ripiego: number };
}): Map<string, StatoTavolo> {
  const out = new Map<string, StatoTavolo>();
  const adesso = minuti(opz.adessoHHmm);
  const vuoto = (): StatoTavolo => ({ colore: "libero", bordo: false, icone: [], arrivo: null, sforo: null });
  for (const id of opz.tavoli) out.set(id, vuoto());
  if (adesso === null) return out;

  const durata = (r: RigaStato) => (opz.durate.perServizio[String(r.service_key ?? "")] ?? opz.durate.ripiego)
    + Math.max(0, Math.floor(Number(r.extra_minutes)) || 0);

  // 1. Chi e' seduto adesso (le sedute di oggi e i conti, anche di ieri).
  const sessioni: Sessione[] = [];
  const viste = new Set<string>();
  for (const r of opz.righe) {
    if (r.status !== "seated") continue;
    const tavoli = tavoliDi(r);
    if (!tavoli.length) continue;
    const inizio = minuti(r.heure);
    const conto = apertoConto(r.tab_status) ? (r.tab_status as "pending" | "open") : null;
    // La cena dopo mezzanotte: arrivati alle 23:30, all'01:00 sono ancora li'.
    const fine = inizio === null ? null : inizio + durata(r);
    const ora = inizio !== null && adesso < inizio ? adesso + 1440 : adesso;
    if (!conto && fine !== null && ora >= fine + MARGINE_FINE_MINUTI) continue;
    sessioni.push({ id: r.id, tavoli, conto, fine, inizio });
    viste.add(r.id);
  }
  for (const c of opz.conti) {
    if (viste.has(c.id) || !apertoConto(c.tab_status)) continue;
    const tavoli = tavoliDi(c);
    if (!tavoli.length) continue;
    sessioni.push({ id: c.id, tavoli, conto: c.tab_status as "pending" | "open", fine: null, inizio: null });
  }

  // 2. Chi deve arrivare: l'inizio di ogni prenotazione non ancora seduta.
  const attese = opz.righe
    .filter((r) => r.status === "pending" || r.status === "confirmed")
    .map((r) => ({ inizio: minuti(r.heure), tavoli: tavoliDi(r) }))
    .filter((r): r is { inizio: number; tavoli: string[] } => r.inizio !== null && r.tavoli.length > 0);

  const conto = new Set(opz.chiamate.filter((c) => c.reason === "bill").map((c) => String(c.table_id ?? "")));

  for (const id of opz.tavoli) {
    const st = out.get(id)!;
    // La prossima su QUESTO tavolo, entro l'ora (o in ritardo da poco).
    const prossima = attese
      .filter((a) => a.tavoli.includes(id) && a.inizio <= adesso + FINESTRA_ARRIVO_MINUTI && a.inizio >= adesso - RITARDO_ATTESO_MINUTI)
      .sort((a, b) => a.inizio - b.inizio)[0];
    if (prossima) {
      st.bordo = true;
      st.arrivo = hhmm(prossima.inizio);
    }

    const s = sessioni.find((x) => x.tavoli.includes(id));
    if (!s) continue;
    // Colore di base e icone.
    if (s.conto === "pending") st.colore = "arancio";
    else st.colore = "verde";
    if (s.conto) st.icone.push("qr");
    else if (opz.qrDiretti.has(s.id)) st.icone.push("qr", "carta");

    // Rosso: tempo finito e la prossima (sugli stessi tavoli) entro 15 minuti.
    if (s.fine !== null && s.inizio !== null) {
      const ora = adesso < s.inizio ? adesso + 1440 : adesso;
      const dopo = attese
        .filter((a) => a.tavoli.some((t) => s.tavoli.includes(t)) && a.inizio >= s.inizio! && a.inizio <= ora + SOGLIA_ROSSO_MINUTI)
        .sort((a, b) => a.inizio - b.inizio)[0];
      if (ora >= s.fine && dopo) {
        st.colore = "rosso";
        st.bordo = false;
        st.sforo = { fine: hhmm(s.fine), prossima: hhmm(dopo.inizio) };
      }
    }
    // Blu: un tavolo della tavolata ha chiesto il conto. Vince su tutto.
    if (s.tavoli.some((t) => conto.has(t))) {
      st.colore = "blu";
      st.icone.push("addizione");
    }
  }
  return out;
}
