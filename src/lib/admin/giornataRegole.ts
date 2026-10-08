/**
 * LA GIORNATA DEL LOCALE — quando si apre, e il righello dell'affluenza.
 *
 * Qui dentro c'e' tutto il conto della colonna «Aujourd'hui»: le fasce di
 * oggi, le ore in cui si e' aperti, e la geometria del grafico (finestra,
 * soffitto, altezza delle barre, ora di punta).
 *
 * ⚠️ PERCHE' FUORI DALLA PAGINA. Era venti righe di aritmetica dentro un
 * `<script>` di `admin/index.astro`, in mezzo al disegno: non si poteva
 * provare senza un browser, e un grafico sbagliato non si vede — le barre
 * escono comunque, solo con l'altezza che non vuol dire niente. Le due volte
 * che un conto qui ha sbagliato (un'ora a una cifra letta come NaN, una
 * prenotazione fuori orario tagliata via) se n'e' accorto qualcuno guardando.
 *
 * ⚠️ NESSUN IMPORT, di proposito: `db.ts` lancia all'import senza le variabili
 * di Supabase e in vitest mancano — un file di prova che ci arrivi non parte
 * affatto, e vitest lo conta come «0 test». Verde a colpo d'occhio, nessuna
 * prova eseguita (ENGINE.md).
 */

/* ⚠️ L'unico import, e di proposito: `minutiDa` sta in `resaStato.ts`, che e'
   puro quanto questo file (nessun database, nessun luxon). Riscriverla qui
   sarebbe la seconda copia della stessa riga di aritmetica in due moduli che
   la stessa pagina importa insieme. */
import { minutiDa } from "./resaStato";

export interface ConfigOre {
  lunch_active?: boolean | null;
  lunch_open?: string | null;
  lunch_close?: string | null;
  dinner_active?: boolean | null;
  dinner_open?: string | null;
  dinner_close?: string | null;
}

/** «11:00:00» → «11:00». Il database salva i `time` con i secondi. */
const hhmm = (t: unknown): string => String(t ?? "").slice(0, 5);

/**
 * Le fasce di apertura di OGGI, gia' scritte.
 *
 * ⚠️ La configurazione che arriva qui e' quella EFFETTIVA del giorno (l'API
 * `today` applica gia' i giorni speciali): se oggi c'e' una chiusura
 * eccezionale, l'elenco torna vuoto da solo. Ricalcolarla qui vorrebbe dire
 * un secondo parere sugli orari, e il giorno che i due non vanno d'accordo il
 * pannello direbbe «aperto» a chi ha chiuso.
 */
export function fasce(cfg: ConfigOre | null | undefined): string[] {
  if (!cfg) return [];
  const b: string[] = [];
  if (cfg.lunch_active && cfg.lunch_open && cfg.lunch_close) b.push(`${hhmm(cfg.lunch_open)} – ${hhmm(cfg.lunch_close)}`);
  if (cfg.dinner_active && cfg.dinner_open && cfg.dinner_close) b.push(`${hhmm(cfg.dinner_open)} – ${hhmm(cfg.dinner_close)}`);
  return b;
}

/** Lo stato del giorno. ⚠️ `ignoto` NON e' `chiuso`: il primo dice che la
 *  configurazione non e' arrivata, il secondo che oggi non si apre. Confonderli
 *  manda a cercare un guasto dove non c'e', o fa credere chiuso un giorno di
 *  servizio. */
export type StatoGiorno = "aperto" | "chiuso" | "ignoto";

export function statoGiorno(cfg: ConfigOre | null | undefined): StatoGiorno {
  if (!cfg) return "ignoto";
  return fasce(cfg).length > 0 ? "aperto" : "chiuso";
}

/**
 * Le ore in cui il locale e' aperto oggi, come numeri (0–23).
 *
 * ⚠️ L'ultima ora si conta solo se la chiusura cade DOPO il suo inizio:
 * chiudendo alle 22:00, le 22 non sono un'ora di servizio — e una colonna
 * vuota in fondo al grafico fa sembrare che la sera sia andata male.
 */
export function oreAperte(cfg: ConfigOre | null | undefined): number[] {
  const out = new Set<number>();
  const apri = (on: unknown, da: unknown, a: unknown) => {
    if (!on || !da || !a) return;
    const h0 = Number(hhmm(da).slice(0, 2));
    const h1 = Number(hhmm(a).slice(0, 2));
    const m1 = Number(hhmm(a).slice(3, 5));
    if (!Number.isFinite(h0) || !Number.isFinite(h1)) return;
    for (let h = h0; h <= (m1 > 0 ? h1 : h1 - 1); h++) if (h >= 0 && h <= 23) out.add(h);
  };
  apri(cfg?.lunch_active, cfg?.lunch_open, cfg?.lunch_close);
  apri(cfg?.dinner_active, cfg?.dinner_open, cfg?.dinner_close);
  return [...out].sort((a, b) => a - b);
}

/** Una serie del grafico: le quantita' per ora, con la classe con cui si
 *  disegna. Le chiavi sono ore («19»), e arrivano sia dal server sia da qui. */
export interface Serie {
  ore: Record<string, number> | Record<number, number>;
  classe: string;
}

export const quanto = (s: Serie, h: number): number =>
  Number((s.ore as Record<string, number>)[String(h)] ?? 0);

export interface Grafico {
  /** Prima e ultima ora disegnate (comprese). */
  da: number;
  a: number;
  /** Il soffitto del grafico: il massimo arrotondato in su. */
  cima: number;
  /** La linea di mezzo, scritta solo se e' un numero intero. */
  meta: number;
  metaScritta: boolean;
  ore: number[];
}

/**
 * La geometria del grafico, oppure `null` quando non c'e' niente da disegnare.
 *
 * ⚠️ LA FINESTRA non e' solo l'orario di apertura: sono le ore aperte PIU'
 * quelle che hanno un numero. Una prenotazione fuori orario esiste, e un
 * grafico che la taglia via fa sparire proprio il caso che varrebbe la pena
 * di guardare.
 *
 * ⚠️ `null` quando il massimo e' zero: barre tutte a zero su un asse disegnato
 * sono un grafico che dice «guardami» e non dice niente. Meglio il blocco con
 * i soli orari.
 */
export function grafico(serie: Serie[], aperte: number[]): Grafico | null {
  if (!serie.length) return null;
  const ore = new Set<number>(aperte.filter((h) => Number.isFinite(h)));
  for (const s of serie) {
    for (const k of Object.keys(s.ore)) {
      const h = Number(k);
      if (Number.isFinite(h) && quanto(s, h) > 0) ore.add(h);
    }
  }
  if (!ore.size) return null;
  const lista = [...ore].sort((a, b) => a - b);
  const max = Math.max(0, ...lista.map((h) => Math.max(...serie.map((s) => quanto(s, h)), 0)));
  if (max <= 0) return null;
  // ⚠️ Il soffitto e' il massimo ARROTONDATO IN SU all'intero: le barre si
  // misurano su un numero tondo, e il numero tondo si puo' scrivere accanto
  // alla linea. Sul massimo esatto, la riga in cima direbbe «7,3».
  const cima = Math.max(1, Math.ceil(max));
  const meta = cima / 2;
  return {
    da: lista[0],
    a: lista[lista.length - 1],
    cima,
    meta,
    // «3,5 coperti» non e' una quantita' che qualcuno conta.
    metaScritta: Number.isInteger(meta),
    // Tutte le ore fra la prima e l'ultima, buchi compresi: un'ora senza
    // nessuno e' un'informazione, e saltarla accorcerebbe la giornata.
    ore: Array.from({ length: lista[lista.length - 1] - lista[0] + 1 }, (_, i) => lista[0] + i),
  };
}

/** L'altezza di una barra, in percentuale del riquadro.
 *  ⚠️ 96 e non 100: la barra piu' alta non deve toccare il soffitto. */
export const altezza = (v: number, cima: number): number =>
  cima > 0 ? Math.round((Math.max(0, v) / cima) * 96) : 0;

/**
 * L'ora piu' piena, o `null` se non c'e' niente.
 * ⚠️ A parita' vince la PRIMA: l'ora di punta e' quando comincia la spinta,
 * non l'ultima volta che si e' toccato quel numero.
 */
export function picco(ore: Record<string, number> | Record<number, number>): number | null {
  let migliore: number | null = null;
  let piu = 0;
  for (const [k, v] of Object.entries(ore)) {
    const h = Number(k);
    const q = Number(v) || 0;
    if (!Number.isFinite(h) || q <= 0) continue;
    if (q > piu) { piu = q; migliore = h; }
  }
  return migliore;
}

/**
 * L'ora di una prenotazione: «20:00:00» → 20. `-1` se non si legge.
 *
 * ⚠️ Non `slice(0, 2)`: su «9:30» darebbe «9:» e quindi NaN, e quella
 * prenotazione sparirebbe dal grafico senza che niente lo dica. Le ore di una
 * cifra esistono — e' il pranzo.
 *
 * ⚠️ VIVE QUI, e non in `affluenzaRegole.ts` dov'e' nata, per una ragione che
 * non si vede: quel file importa luxon, e la colonna gira nel BROWSER. Per una
 * riga di aritmetica si sarebbe portata dentro il pacchetto delle date, su
 * ogni apertura della Accueil. `affluenzaRegole` la riprende da qui, cosi' chi
 * disegna le barre e chi calcola le medie leggono l'ora allo stesso modo —
 * altrimenti sono due grafici che non si parlano.
 */
export function oraDi(heure: unknown): number {
  const m = /^(\d{1,2})(?::|$)/.exec(String(heure ?? ""));
  if (!m) return -1;
  const h = Number(m[1]);
  return h >= 0 && h <= 23 ? h : -1;
}

/* ============================================================
   I SERVIZI DI UN GIORNO
   ============================================================ */

export interface ServizioCfg {
  key: string;
  from?: string | null;
  to?: string | null;
  /** I giorni della settimana in cui vale (0 = domenica). Vuoto = tutti. */
  days?: number[] | null;
  hold?: number | null;
}

/**
 * Un servizio e' attivo in un GIORNO SPECIALE «aperto»?
 *
 * La riga del giorno speciale porta la lista dei servizi che apre, scritta
 * `chiave|dalle-alle` (o la sola chiave, per le righe vecchie). `null` = apre
 * tutto.
 */
export function attivoNelGiornoSpeciale(
  key: string,
  da: string,
  a: string,
  lista: string[] | null | undefined,
): boolean {
  if (lista === null || lista === undefined) return true;
  return lista.includes(`${key}|${da}-${a}`) || lista.includes(key);
}

/**
 * I SERVIZI DI OGGI, in ordine di orario.
 *
 * ⚠️ IL GUASTO CHE QUESTA FUNZIONE CHIUDE. Un giorno speciale «aperto»
 * SCAVALCA i giorni della settimana: un lunedi' di chiusura aperto per
 * un'occasione apre i servizi scritti nella sua riga. La pagina Réservations
 * lo sapeva; la colonna della Accueil no — filtrava solo per `days`, e quel
 * lunedi' mostrava la scatola dei servizi VUOTA mentre il sito prendeva
 * prenotazioni. E dentro quella scatola c'e' l'interruttore per chiudere un
 * servizio: niente scatola, niente comando, e nessun errore da nessuna parte.
 * Al contrario (giorno speciale che apre la sola sera) la colonna elencava
 * anche il pranzo, con un interruttore che chiudeva un servizio inesistente.
 *
 * ⚠️ IN ORDINE DI ORARIO, e non nell'ordine della configurazione: li' e'
 * l'ordine in cui il ristoratore ha creato le fasce — «Dinner» prima di
 * «Lunch» se ha cominciato dalla sera — e la giornata non si legge cosi'.
 * In MINUTI e non per lettere: «9:00» e «12:00» ordinati come testo mettono
 * le nove dopo mezzogiorno.
 */
export function serviziDelGiorno(
  servizi: ServizioCfg[] | null | undefined,
  opz: { dow: number; speciale?: boolean; serviziSpeciali?: string[] | null },
): ServizioCfg[] {
  const { dow, speciale = false, serviziSpeciali = null } = opz;
  return (servizi ?? [])
    .filter((sv) => sv && sv.key && sv.from && sv.to)
    .filter((sv) =>
      speciale
        ? attivoNelGiornoSpeciale(String(sv.key), String(sv.from), String(sv.to), serviziSpeciali)
        // `days` vuoto = TUTTI i giorni. ⚠️ Letto come «nessuno», un locale con
        // un servizio solo e senza giorni scelti risulterebbe chiuso sempre.
        : !Array.isArray(sv.days) || sv.days.length === 0 || sv.days.includes(dow),
    )
    .sort((x, y) => minutiDa(x.from) - minutiDa(y.from));
}

