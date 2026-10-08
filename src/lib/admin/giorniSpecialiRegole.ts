/**
 * I GIORNI SPECIALI DELLA COLONNA — una linea del tempo, non due elenchi.
 *
 * ⚠️ IL GUASTO CHE QUESTO FILE CHIUDE. La tile «Jours spéciaux» mostrava due
 * liste staccate: sopra i giorni speciali del ristoratore, sotto le prossime
 * feste del calendario. Natale compariva DUE VOLTE — una come chiusura sua e
 * una come festa — e sono la stessa riga. Chi guardava doveva capire da solo
 * che parlavano dello stesso giorno, e una delle due poteva dire «fermé»
 * mentre l'altra diceva ancora «ouvert».
 *
 * Qui le due fonti si fondono per DATA: se una festa cade dentro un giorno
 * speciale, il giorno speciale vince e la festa gli presta il nome.
 *
 * ⚠️ UNA FESTA NON CHIUDE NIENTE. Sta scritto in `festivitaRegole.ts` e vale
 * anche qui: una pizzeria lavora il 1° maggio. Una festa senza giorno speciale
 * NON e' un errore da segnalare — e' una riga che dice cosa fara' il sito quel
 * giorno (`deciso: false`), e chi vuole decidere apre il modulo. Trattarla
 * come un allarme vorrebbe dire spingere a chiudere giorni di lavoro.
 *
 * ⚠️ UN SOLO IMPORT, e puro: `db.ts` lancia all'import senza le variabili di
 * Supabase e in vitest mancano — un file di prova che ci arrivi non parte e
 * vitest lo conta come «0 test». Le feste arrivano gia' calcolate da chi
 * chiama, che le ha gia' in mano per il calendario.
 */

import { giorniPassati, piuGiorni } from "../giorni";

export type TipoRiga = "closed" | "open" | "fete";

export interface GiornoSpeciale {
  id?: string | null;
  type?: string | null;
  date_from: string;
  date_to?: string | null;
  lunch_open?: string | null;
  lunch_close?: string | null;
  dinner_open?: string | null;
  dinner_close?: string | null;
  note?: string | null;
  services?: string[] | null;
}

export interface Festa {
  iso: string;
  nome: string;
  /** Evento del locale (non una festa del paese): si disegna diverso. */
  locale?: boolean;
}

export interface RigaSpeciale {
  /** Il giorno da cui parte: e' quello che si vede sul calendarietto. */
  iso: string;
  /** L'ultimo giorno, solo se e' un periodo (altrimenti `null`). */
  fine: string | null;
  tipo: TipoRiga;
  /** Il nome: la festa se c'e', altrimenti la nota del giorno speciale. */
  titolo: string;
  nota: string | null;
  /** Le due fasce, se il giorno speciale le porta. */
  pranzo: [string, string] | null;
  cena: [string, string] | null;
  servizi: string[] | null;
  /** `true` = esiste in `special_days` (qualcuno l'ha scritto). */
  deciso: boolean;
  /** `true` = oggi cade dentro questa riga. */
  oggi: boolean;
  /** `true` = evento del locale, non festa del paese. */
  locale: boolean;
  /** Quanti giorni dura (1 per un giorno solo). */
  giorni: number;
  /**
   * I giorni di questa riga che cadono DENTRO la finestra mostrata
   * (da oggi a `fino`), estremi compresi.
   *
   * ⚠️ Non e' `giorni`, e il piede della colonna vuole questo: una chiusura
   * di tre settimane cominciata la settimana scorsa ne ha ancora quattordici
   * davanti, e la riga «chiusure · 21 giorni» sotto l'etichetta «90 giorni»
   * contava anche i sette giorni passati — e quelli di una chiusura che
   * sborda oltre il novantesimo giorno, che nella colonna non ci sono.
   * Sulla RIGA resta `giorni`, che e' la durata vera di quella chiusura.
   */
  giorniInFinestra: number;
  id: string | null;
}

/** Giorni fra due date ISO, estremi compresi. Solo aritmetica: nessun fuso,
 *  perche' due date ISO non hanno un'ora da sbagliare. */
export function giorniTra(da: string, a: string): number {
  // ⚠️ `+ 1`, ed e' tutta la differenza con `giorniPassati`: una chiusura dal
  // 3 al 5 dura TRE giorni, perche' il 3 e il 5 sono chiusi. Erano due
  // funzioni con lo stesso corpo in due moduli, e quel `+ 1` era l'unica cosa
  // che le distingueva — scritto una volta per sbaglio nella copia sbagliata,
  // nessuno se ne accorgeva: «chiuso 2 giorni» invece di 3 e' una frase che
  // non sembra un errore.
  const g = giorniPassati(da, a);
  return g < 0 ? 1 : g + 1;
}

/* `piuGiorni` sta in `lib/giorni.ts` con l'altra aritmetica delle
   chiavi-giorno. ⚠️ Si RIESPORTA il nome importato, e non con
   `export { x } from "..."`: quella forma non lo porta dentro al modulo, e le
   due funzioni qui sotto che la chiamano morivano con un `ReferenceError` —
   ma solo nel ramo che la usa, cioe' un periodo di chiusura. */
export { piuGiorni };

const ora = (v: unknown): string => String(v ?? "").slice(0, 5);

function fascia(da: unknown, a: unknown): [string, string] | null {
  const x = ora(da), y = ora(a);
  return x && y ? [x, y] : null;
}

/**
 * Le righe della colonna, in ordine: oggi in cima, poi per data.
 *
 * ⚠️ `oggi` in cima e non in mezzo: un giorno speciale che e' OGGI non e' un
 * promemoria, e' un'informazione di servizio — «stasera si apre alle 18:30».
 * In ordine di data finirebbe dopo quelli passati a meta' e si leggerebbe
 * come futuro.
 */
export function fondi(opz: {
  speciali: GiornoSpeciale[];
  feste: Festa[];
  oggi: string;
  /** Ultimo giorno da mostrare (compreso). */
  fino: string;
  /** Le date in cui il sito e' chiuso comunque (orari settimanali compresi):
   *  serve a dire cosa fara' il sito in una festa non decisa. */
  chiusi?: Set<string> | null;
}): RigaSpeciale[] {
  const { oggi, fino } = opz;
  const righe: RigaSpeciale[] = [];
  const coperte = new Set<string>();

  for (const s of opz.speciali ?? []) {
    const da = String(s?.date_from ?? "");
    if (!da) continue;
    const a = String(s?.date_to ?? "") || da;
    // Fuori finestra: finito prima di oggi, o comincia dopo il limite.
    if (a < oggi || da > fino) continue;
    // ⚠️ Le date COPERTE sono tutte quelle del periodo, non solo la prima:
    // una festa in mezzo a un congiunto di due settimane e' decisa anche lei,
    // e stampata a parte direbbe «ouvert» dentro una chiusura.
    for (let d = da; d <= a; d = piuGiorni(d, 1)) {
      coperte.add(d);
      if (d === fino) break;
    }
    righe.push({
      iso: da,
      fine: a !== da ? a : null,
      tipo: String(s?.type ?? "") === "open" ? "open" : "closed",
      titolo: "",
      nota: String(s?.note ?? "").trim() || null,
      pranzo: fascia(s?.lunch_open, s?.lunch_close),
      cena: fascia(s?.dinner_open, s?.dinner_close),
      servizi: Array.isArray(s?.services) ? s!.services!.map(String) : null,
      deciso: true,
      oggi: da <= oggi && oggi <= a,
      locale: false,
      giorni: giorniTra(da, a),
      giorniInFinestra: giorniTra(da < oggi ? oggi : da, a > fino ? fino : a),
      id: s?.id ? String(s.id) : null,
    });
  }

  // Le feste: una riga solo se quel giorno non e' gia' deciso. Il nome di
  // quelle coperte va alla riga del giorno speciale, che e' senza titolo.
  const nomi = new Map<string, Festa>();
  for (const f of opz.feste ?? []) {
    const iso = String(f?.iso ?? "");
    if (!iso || iso < oggi || iso > fino) continue;
    // ⚠️ La PRIMA vince: chi chiama mette le feste legali prima delle
    // ricorrenze, cosi' il giorno che cadono insieme (in Germania la festa
    // del papa' E' l'Ascensione) resta una riga sola con il nome che pesa.
    if (!nomi.has(iso)) nomi.set(iso, { iso, nome: String(f?.nome ?? ""), locale: Boolean(f?.locale) });
  }

  for (const r of righe) {
    if (r.titolo) continue;
    const f = nomi.get(r.iso);
    if (f) r.titolo = f.nome;
  }

  for (const [iso, f] of nomi) {
    if (coperte.has(iso)) continue;
    righe.push({
      iso,
      fine: null,
      tipo: "fete",
      titolo: f.nome,
      nota: null,
      pranzo: null,
      cena: null,
      servizi: null,
      deciso: false,
      oggi: iso === oggi,
      locale: Boolean(f.locale),
      giorni: 1,
      giorniInFinestra: 1,
      id: null,
    });
  }

  righe.sort((a, b) => {
    if (a.oggi !== b.oggi) return a.oggi ? -1 : 1;
    if (a.iso !== b.iso) return a.iso < b.iso ? -1 : 1;
    // Stessa data: prima la decisione, poi la festa non decisa.
    return Number(b.deciso) - Number(a.deciso);
  });
  return righe;
}

/** Il sito sara' chiuso quel giorno anche senza giorno speciale? */
export function chiusoComunque(iso: string, chiusi?: Set<string> | null): boolean {
  return Boolean(chiusi && chiusi.has(iso));
}

/** I numeri del piede: chiusure, orari modificati, prossima chiusura. */
export function conti(righe: RigaSpeciale[]): {
  chiusure: number;
  giorniChiusi: number;
  orari: number;
  prossimaChiusura: string | null;
  chiusuraInCorso: boolean;
} {
  const chiuse = righe.filter((r) => r.deciso && r.tipo === "closed");
  return {
    chiusure: chiuse.length,
    // ⚠️ I giorni DENTRO LA FINESTRA, non la durata intera delle chiusure:
    // sotto c'e' scritto «90 giorni», e questo numero contava anche i giorni
    // gia' passati di una chiusura in corso e quelli di una che sborda oltre
    // il novantesimo. Un numero piu' grande della finestra che lo contiene.
    giorniChiusi: chiuse.reduce((n, r) => n + r.giorniInFinestra, 0),
    orari: righe.filter((r) => r.deciso && r.tipo === "open").length,
    // ⚠️ «Prossima» vuol dire NON ANCORA COMINCIATA. Si prendeva la prima
    // data in ordine, e una chiusura in corso da ieri si leggeva «prossima
    // chiusura: ieri» — una data passata, sotto un'etichetta che dice futuro.
    // Quella in corso sta gia' in cima all'elenco, con la sua pastiglia.
    prossimaChiusura: chiuse.filter((r) => !r.oggi).map((r) => r.iso).sort()[0] ?? null,
    chiusuraInCorso: chiuse.some((r) => r.oggi),
  };
}

/** Le etichette dei filtri: solo quelle che hanno davvero delle righe. */
export function filtriUtili(righe: RigaSpeciale[]): TipoRiga[] {
  const out: TipoRiga[] = [];
  for (const t of ["closed", "open", "fete"] as TipoRiga[]) {
    if (righe.some((r) => r.tipo === t)) out.push(t);
  }
  return out;
}
