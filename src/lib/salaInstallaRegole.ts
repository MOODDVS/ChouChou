/**
 * INSTALLARE DEI CLIENTI A UN TAVOLO LIBERO — le regole, senza database.
 * (23/10/2026, palmare: vedi `claude/palmare.md` nel progetto.)
 *
 * ⚠️ Nessun import: queste funzioni girano ANCHE nel browser del palmare (le
 * proposte si ricalcolano a ogni tocco sul numero di persone, senza chiedere
 * niente al server) e in vitest. Una dipendenza di server qui dentro finirebbe
 * nel bundle della pagina.
 *
 * Il cameriere tocca un tavolo libero, dice quanti sono. Se il tavolo basta,
 * si propone lui. Se non basta, si propongono i tavoli COLLEGATI (le liaisons
 * del piano: Réglages → Réservations), cioe' le stesse catene con cui il
 * motore assegna i tavoli alle prenotazioni (`scegliCombinazione`): un pezzo
 * di catena, contiguo, che contiene il tavolo toccato.
 */

export interface TavoloPosti {
  id: string;
  name: string;
  seats: number;
}

export interface Proposta {
  ids: string[];
  nomi: string[];
  posti: number;
  /** Posti in piu' rispetto alle persone: 0 = perfetta, −1 = una sedia in piu' (stretti). */
  spreco: number;
}

/**
 * STRETTI (Enzo, 23/10/2026): «se scelgo un tavolo da 2 ma sono 3 deve
 * comunque darmi la possibilita'». Si propone sempre anche un tavolo (o una
 * combinazione) con UN posto in meno delle persone: si aggiunge una sedia.
 */
export const TOLLERANZA_POSTI = 1;

/**
 * L'ordine delle proposte: prima quelle che sprecano meno, e «stretti di
 * una sedia» vale come uno spreco di 1,5 — dopo chi ha un posto libero in
 * piu', prima di chi ne ha due. A parita', meno tavoli.
 */
export function pesoProposta(p: { spreco: number }): number {
  return p.spreco < 0 ? 1.5 : p.spreco;
}

/** Le catene di una section, da `reservation_plan_links` ({ zona: [[id…]] }). */
export function catenaDiZona(legami: unknown, zona: string): string[][] {
  let m: unknown = legami;
  if (typeof m === "string") {
    try { m = JSON.parse(m || "{}"); } catch { m = {}; }
  }
  const gruppi = m && typeof m === "object" ? (m as Record<string, unknown>)[zona] : null;
  if (!Array.isArray(gruppi)) return [];
  return gruppi
    .filter(Array.isArray)
    .map((g) => (g as unknown[]).map(String).filter(Boolean))
    .filter((g) => g.length >= 2);
}

/**
 * LE PROPOSTE, dalla piu' plausibile.
 *
 * - Il tavolo toccato da solo, se basta.
 * - Ogni pezzo CONTIGUO di una catena che contiene il tavolo toccato, con tutti
 *   i tavoli liberi e abbastanza posti. Contiguo perche' una catena e' una fila
 *   di tavoli che si avvicinano: T1+T2+T3 si uniscono, T1+T3 senza T2 no.
 * - Ordine: meno posti sprecati, poi meno tavoli da spostare.
 *
 * ⚠️ Il tavolo toccato e' SEMPRE dentro: il cameriere ha scelto dove far
 * sedere, il sistema non lo manda dall'altra parte della sala.
 */
export function proposteInstallazione(opz: {
  tavoli: TavoloPosti[];
  catene: string[][];
  occupati: Iterable<string>;
  tavoloId: string;
  persone: number;
  max?: number;
}): Proposta[] {
  const perId = new Map(opz.tavoli.map((t) => [t.id, t]));
  const occupati = new Set(opz.occupati);
  const persone = Math.max(1, Math.floor(Number(opz.persone) || 1));
  if (!perId.has(opz.tavoloId) || occupati.has(opz.tavoloId)) return [];

  const viste = new Set<string>();
  const out: Proposta[] = [];
  const prova = (ids: string[]) => {
    const chiave = [...ids].sort().join("|");
    if (viste.has(chiave)) return;
    viste.add(chiave);
    if (ids.some((id) => !perId.has(id) || occupati.has(id))) return;
    const posti = ids.reduce((s, id) => s + (perId.get(id)?.seats ?? 0), 0);
    if (posti < Math.max(1, persone - TOLLERANZA_POSTI)) return;
    // I nomi in ordine naturale («T1 + T2»): la catena puo' essere disegnata
    // al contrario, il cameriere legge i numeri. Gli id restano come sono.
    const nomi = ids.map((id) => perId.get(id)?.name ?? "?").sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    out.push({ ids, nomi, posti, spreco: posti - persone });
  };

  prova([opz.tavoloId]);
  for (const catena of opz.catene) {
    const qui = catena.indexOf(opz.tavoloId);
    if (qui === -1) continue;
    for (let da = 0; da <= qui; da++) {
      for (let a = qui + 1; a <= catena.length; a++) {
        if (a - da >= 2) prova(catena.slice(da, a));
      }
    }
  }
  return out
    .sort((x, y) => pesoProposta(x) - pesoProposta(y) || x.ids.length - y.ids.length)
    .slice(0, opz.max ?? 4);
}

/** "HH:MM" → minuti, o null. */
function minuti(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Le prenotazioni di oggi, come servono qui. */
export interface RigaGiorno {
  heure?: unknown;
  status?: unknown;
  tables?: unknown;
  service_key?: unknown;
  extra_minutes?: unknown;
  tab_status?: unknown;
}

function tavoliDi(r: RigaGiorno): string[] {
  let t: unknown = r.tables;
  if (typeof t === "string") {
    try { t = JSON.parse(t); } catch { t = []; }
  }
  return Array.isArray(t) ? t.map(String) : [];
}

/**
 * I minuti di margine dopo la fine del tempo al tavolo: gli stessi 20 con cui
 * `caricaResaGiorno` porta a «Fini» una prenotazione seduta e dimenticata.
 */
export const MARGINE_FINE_MINUTI = 20;

/**
 * QUALI TAVOLI NON SI POSSONO PROPORRE ADESSO.
 *
 * - `occupati`: chi e' SEDUTO (`seated`) e non ha ancora finito: dall'ora
 *   d'arrivo per la durata del servizio, piu' i minuti aggiunti, piu' il
 *   margine di `caricaResaGiorno` — la stessa finestra dopo la quale l'admin
 *   lo segna «Fini» da solo. ⚠️ Un CONTO APERTO occupa sempre: non si chiude
 *   da solo (conto-aperto.md), e chi non ha ancora pagato e' ancora li'.
 * - `prenotati`: chi deve arrivare (`confirmed` / `pending`) e si sovrappone
 *   a un'installazione che parte adesso e dura `durataNuova` minuti. Far
 *   sedere qualcuno li' vuol dire lasciare in piedi la prenotazione.
 * - `gruppi`: i tavoli UNITI di chi e' seduto (una tavolata su T1+T2), per
 *   disegnare il legame sulla piantina.
 * Le prenotazioni SENZA tavoli assegnati non bloccano niente qui: il motore le
 * siede «virtualmente» quando assegna, ma al palmare servono fatti, non stime.
 */
export function tavoliNonDisponibili(opz: {
  righe: RigaGiorno[];
  adessoHHmm: string;
  durataNuova: number;
  durate: { perServizio: Record<string, number>; ripiego: number };
}): { occupati: Set<string>; prenotati: Set<string>; gruppi: string[][] } {
  const occupati = new Set<string>();
  const prenotati = new Set<string>();
  const gruppi: string[][] = [];
  const adesso = minuti(opz.adessoHHmm);
  if (adesso === null) return { occupati, prenotati, gruppi };
  for (const r of opz.righe) {
    const ids = tavoliDi(r);
    if (!ids.length) continue;
    const inizio = minuti(r.heure);
    const durata = (opz.durate.perServizio[String(r.service_key ?? "")] ?? opz.durate.ripiego)
      + Math.max(0, Math.floor(Number(r.extra_minutes)) || 0);
    if (r.status === "seated") {
      const contoAperto = r.tab_status === "pending" || r.tab_status === "open";
      // La cena dopo mezzanotte: arrivati alle 23:30, all'01:00 sono ancora li'.
      const ora = inizio !== null && adesso < inizio ? adesso + 1440 : adesso;
      if (contoAperto || inizio === null || ora < inizio + durata + MARGINE_FINE_MINUTI) {
        ids.forEach((id) => occupati.add(id));
        // Piu' tavoli per una sola tavolata: sulla piantina si legano.
        if (ids.length > 1) gruppi.push(ids);
      }
      continue;
    }
    if (r.status !== "confirmed" && r.status !== "pending") continue;
    if (inizio === null) continue;
    if (inizio < adesso + opz.durataNuova && inizio + durata > adesso) ids.forEach((id) => prenotati.add(id));
  }
  return { occupati, prenotati, gruppi };
}

/* =====================================================================
 * SPOSTARE UNA TAVOLATA GIA' SEDUTA (23/10/2026) — «Déplacer», dal modale
 * dell'isola del tavolo. Tre casi, deciso con Enzo:
 *  1. CAMBIARE TAVOLO: T1 → E2 (anche in un'altra sala);
 *  2. AGGIUNGERE un tavolo: arrivano altri due, + T3;
 *  3. LIBERARE un tavolo: tre se ne vanno prima, − T3.
 * Sempre regole pure: girano nel modale, a ogni tocco.
 * ===================================================================== */

export interface ZonaSala {
  zona: string;
  tavoli: TavoloPosti[];
  catene: string[][];
}

const chiaveIds = (ids: string[]) => [...ids].sort().join("|");
const perNome = (x: string, y: string) => x.localeCompare(y, undefined, { numeric: true });

/**
 * 1. DOVE PORTARLI: in ogni sala le combinazioni libere che bastano per
 * `persone`, dalla piu' plausibile (meno posti sprecati, poi meno tavoli) —
 * le stesse regole di «Installer», provando ogni tavolo libero.
 *
 * ⚠️ Mai un tavolo di adesso: per allargarsi c'e' «Aggiungere». Cosi'
 * «Cambiare» vuol dire davvero andare altrove.
 * ⚠️ `occupati` NON deve contenere i tavoli della tavolata stessa (chi chiama
 * li toglie): se no la sala sembrerebbe piu' piena di quanto e'.
 */
export function proposteCambio(opz: {
  zone: ZonaSala[];
  occupati: Iterable<string>;
  attuali: string[];
  persone: number;
  maxPerZona?: number;
}): { zona: string; proposte: Proposta[] }[] {
  const occupati = new Set(opz.occupati);
  const miei = new Set(opz.attuali);
  const out: { zona: string; proposte: Proposta[] }[] = [];
  for (const z of opz.zone) {
    const viste = new Set<string>();
    const tutte: Proposta[] = [];
    for (const t of z.tavoli) {
      if (occupati.has(t.id) || miei.has(t.id)) continue;
      for (const p of proposteInstallazione({ tavoli: z.tavoli, catene: z.catene, occupati: [...occupati, ...miei], tavoloId: t.id, persone: opz.persone, max: 99 })) {
        const k = chiaveIds(p.ids);
        if (viste.has(k)) continue;
        viste.add(k);
        tutte.push(p);
      }
    }
    tutte.sort((x, y) => pesoProposta(x) - pesoProposta(y) || x.ids.length - y.ids.length || perNome(x.nomi.join("+"), y.nomi.join("+")));
    const proposte = tutte.slice(0, opz.maxPerZona ?? 4);
    if (proposte.length) out.push({ zona: z.zona, proposte });
  }
  return out;
}

export interface Ritocco {
  /** Il tavolo che si aggiunge o si toglie. */
  tavolo: TavoloPosti;
  /** I tavoli dopo il ritocco. */
  ids: string[];
  nomi: string[];
  posti: number;
}

function ritocco(perId: Map<string, TavoloPosti>, tavolo: TavoloPosti, ids: string[]): Ritocco {
  return {
    tavolo,
    ids,
    nomi: ids.map((id) => perId.get(id)?.name ?? "?").sort(perNome),
    posti: ids.reduce((s, id) => s + (perId.get(id)?.seats ?? 0), 0),
  };
}

/**
 * 2. QUALE TAVOLO AGGIUNGERE: i tavoli LIBERI accanto alla tavolata in una
 * catena del piano (le liaisons), cioe' quelli che si possono avvicinare.
 * Un tavolo lontano no: la tavolata non si allunga dall'altra parte della sala.
 */
export function tavoliDaAggiungere(opz: {
  tavoli: TavoloPosti[];
  catene: string[][];
  occupati: Iterable<string>;
  attuali: string[];
}): Ritocco[] {
  const perId = new Map(opz.tavoli.map((t) => [t.id, t]));
  const occupati = new Set(opz.occupati);
  const miei = new Set(opz.attuali);
  const vicini = new Set<string>();
  for (const catena of opz.catene) {
    catena.forEach((id, i) => {
      if (!miei.has(id)) return;
      for (const v of [catena[i - 1], catena[i + 1]]) {
        if (v && !miei.has(v) && !occupati.has(v) && perId.has(v)) vicini.add(v);
      }
    });
  }
  return [...vicini]
    .map((id) => ritocco(perId, perId.get(id) as TavoloPosti, [...opz.attuali, id]))
    .sort((x, y) => perNome(x.tavolo.name, y.tavolo.name));
}

/**
 * 3. QUALE TAVOLO LIBERARE: ne resta sempre almeno uno. Se la tavolata e' un
 * pezzo di catena, solo le due PUNTE: togliere quello in mezzo lascerebbe due
 * tavoli staccati per un gruppo solo.
 */
export function tavoliDaLiberare(opz: {
  tavoli: TavoloPosti[];
  catene: string[][];
  attuali: string[];
}): Ritocco[] {
  const perId = new Map(opz.tavoli.map((t) => [t.id, t]));
  const attuali = opz.attuali.filter((id) => perId.has(id));
  if (attuali.length < 2) return [];
  let candidati = attuali;
  for (const catena of opz.catene) {
    const pos = attuali.map((id) => catena.indexOf(id));
    if (pos.some((p) => p === -1)) continue;
    const da = Math.min(...pos);
    const a = Math.max(...pos);
    if (a - da + 1 === attuali.length) {
      candidati = [catena[da], catena[a]];
      break;
    }
  }
  return candidati
    .map((id) => ritocco(perId, perId.get(id) as TavoloPosti, attuali.filter((x) => x !== id)))
    .sort((x, y) => perNome(x.tavolo.name, y.tavolo.name));
}

/* =====================================================================
 * PIU' TEMPO AL TAVOLO (23/10/2026) — «+15 / +30 / +45 min» nel modale,
 * come nel dettaglio di una prenotazione. Si aggiungono `extra_minutes`
 * alla sessione seduta: la piantina, le proposte e le prenotazioni la
 * considerano occupata piu' a lungo.
 * ===================================================================== */

/** Quando finisce il tempo al tavolo (minuti dalla mezzanotte), o null. */
export function fineSeduta(
  r: RigaGiorno,
  durate: { perServizio: Record<string, number>; ripiego: number },
): number | null {
  const inizio = minuti(r.heure);
  if (inizio === null) return null;
  return inizio + (durate.perServizio[String(r.service_key ?? "")] ?? durate.ripiego)
    + Math.max(0, Math.floor(Number(r.extra_minutes)) || 0);
}

/** «20:15» da minuti dalla mezzanotte (anche oltre le 24). */
export function oraDaMinuti(m: number): string {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}

/**
 * Allungare il tempo di `minutiPiu` scavalca una prenotazione? La prima che
 * INIZIA dentro i minuti aggiunti su uno dei tavoli della tavolata (la
 * stessa regola di Réservations, `conflittoEstensione`). null = via libera.
 */
export function conflittoEstensione(opz: {
  seduta: RigaGiorno & { id?: unknown };
  righe: (RigaGiorno & { id?: unknown; first_name?: unknown; last_name?: unknown })[];
  minutiPiu: number;
  durate: { perServizio: Record<string, number>; ripiego: number };
}): { heure: string; nome: string; tavoli: string[] } | null {
  const fine = fineSeduta(opz.seduta, opz.durate);
  if (fine === null || opz.minutiPiu <= 0) return null;
  const nuovaFine = fine + opz.minutiPiu;
  const miei = new Set(tavoliDi(opz.seduta));
  let primo: { m: number; heure: string; nome: string; tavoli: string[] } | null = null;
  for (const r of opz.righe) {
    if (r.id === opz.seduta.id) continue;
    if (r.status !== "confirmed" && r.status !== "pending") continue;
    const comuni = tavoliDi(r).filter((t) => miei.has(t));
    if (!comuni.length) continue;
    const m = minuti(r.heure);
    if (m === null || m < fine || m >= nuovaFine) continue;
    if (!primo || m < primo.m) {
      primo = {
        m,
        heure: String(r.heure ?? "").slice(0, 5),
        nome: [r.first_name, r.last_name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" "),
        tavoli: comuni,
      };
    }
  }
  return primo ? { heure: primo.heure, nome: primo.nome, tavoli: primo.tavoli } : null;
}
