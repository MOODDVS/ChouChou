/**
 * DALLE RIGHE AI COMANDI — il ticket che esce davvero dalla stampante.
 *
 * ⚠️ PERCHE' NON UNA PAGINA. Provato su carta il 05/10/2026: il servizio di
 * stampa passa il contenuto alla stampante SENZA TOCCARLO, e una termica in
 * ESC/POS stampa come testo tutto quello che le arriva. Mandato un HTML e'
 * uscito il sorgente; mandato un PDF sono usciti i suoi byte, un foglio
 * intero. La stampante non riceve un documento: riceve dei COMANDI.
 *
 * ⚠️ UTF-8, e NIENTE `ESC t`. Le quattro tabelle di caratteri della stampante
 * (cp437, cp850, cp858, cp1252) sono uscite tutte sbagliate; il testo in UTF-8
 * senza nessuna selezione di tabella e' uscito perfetto, euro compreso. In
 * mezzo c'e' un'app che legge il file come testo e converte lei: scrivere nei
 * byte di una code page vuol dire darle qualcosa che non e' UTF-8 valido, e
 * farselo rovinare prima della testina.
 *
 * ⚠️ NESSUN IMPORT che arrivi a `db.ts` — solo il TIPO delle righe, che
 * sparisce nel build. `db.ts` lancia all'import se mancano le variabili di
 * Supabase, e in vitest mancano: un file di prova che ci arrivi non parte
 * affatto, e vitest lo conta come «0 test». Verde a colpo d'occhio, nessuna
 * prova eseguita. E' gia' successo due volte.
 */
import type { RigaTicket } from "./stampaRegole";

const ESC = 0x1b, GS = 0x1d;
const b = (...n: number[]) => Uint8Array.from(n);

/** I comandi, scritti UNA volta e con un nome. Un `0x1d` battuto a mano in
 *  mezzo al testo e' un ticket che esce storto solo il sabato sera. */
const C = {
  init: b(ESC, 0x40),
  centro: b(ESC, 0x61, 1),
  sinistra: b(ESC, 0x61, 0),
  grassOn: b(ESC, 0x45, 1),
  grassOff: b(ESC, 0x45, 0),
  invOn: b(GS, 0x42, 1),
  invOff: b(GS, 0x42, 0),
  /** Avanza la carta e taglia: senza questo il ticket resta attaccato al
   *  prossimo, e in cucina arrivano due ordini su un nastro solo. */
  taglio: b(GS, 0x56, 0x42, 0x00),
};

/**
 * ⚠️ LA MISURA E' LA COLONNA, NON IL PIXEL — e cambia con la taglia.
 *
 * Misurato sul foglio: carta da 80 mm, font A, **48 colonne**. Ma la doppia
 * larghezza ne consuma due per carattere: una riga `gigante` ne ha 24, non 48.
 * Scritto in un posto solo perche' chi spezza il testo e chi lo stampa devono
 * contare allo stesso modo: se contassero diverso, i nomi lunghi uscirebbero
 * tagliati dalla stampante invece che andare a capo — e si vedrebbe solo sul
 * piatto col nome piu' lungo del menu, cioe' qualche settimana dopo.
 */
export const COLONNE = 48;

const TAGLIE = {
  /** L'ora: doppia altezza E larghezza. */
  gigante: { cmd: b(GS, 0x21, 0x11), pre: b(), post: b(), colonne: 24 },
  /** I piatti: doppia altezza, larghezza normale. Restano 48 colonne. */
  grande: { cmd: b(GS, 0x21, 0x01), pre: b(), post: b(), colonne: COLONNE },
  normale: { cmd: b(GS, 0x21, 0x00), pre: b(), post: b(), colonne: COLONNE },
  /** Font B: piu' piccolo e piu' stretto, 64 colonne. Per le righe di
   *  servizio (l'ora di stampa), mai per le note di un piatto. */
  piccolo: { cmd: b(GS, 0x21, 0x00), pre: b(ESC, 0x4d, 1), post: b(ESC, 0x4d, 0), colonne: 64 },
} as const;

export type Taglia = keyof typeof TAGLIE;

const taglieDi = (t: RigaTicket["taglia"]) => TAGLIE[(t ?? "normale") as Taglia] ?? TAGLIE.normale;

/**
 * Spezza un testo troppo lungo, sulle PAROLE, e rientra le continuazioni.
 *
 * ⚠️ Il rientro non e' estetica: senza, la seconda riga di «Tagliatelle alla
 * bolognese» sembra un piatto in piu' e in cucina se ne prepara uno di troppo.
 * Una parola piu' lunga della riga (un indirizzo, un codice) si taglia e basta:
 * meglio spezzata che sparita.
 */
export function aCapo(testo: string, colonne: number, rientro = 0): string[] {
  const parole = String(testo ?? "").split(/\s+/).filter(Boolean);
  if (!parole.length) return [""];
  const sp = " ".repeat(rientro);
  const out: string[] = [];
  let riga = "";
  for (let parola of parole) {
    const max = out.length === 0 ? colonne : colonne - rientro;
    while (parola.length > max) {
      if (riga) { out.push((out.length ? sp : "") + riga); riga = ""; }
      out.push((out.length ? sp : "") + parola.slice(0, max));
      parola = parola.slice(max);
    }
    const prova = riga ? `${riga} ${parola}` : parola;
    if (prova.length > max) { out.push((out.length ? sp : "") + riga); riga = parola; }
    else riga = prova;
  }
  if (riga) out.push((out.length ? sp : "") + riga);
  return out;
}

/** Etichetta a sinistra, importo a destra, sulla STESSA riga: cede
 *  l'etichetta, mai l'importo. Un importo andato a capo si legge male, e
 *  quello e' il numero che qualcuno deve chiedere al cliente. */
export function due(sinistra: string, destra: string, colonne = COLONNE): string {
  const d = String(destra ?? "");
  const spazio = Math.max(1, colonne - d.length - 1);
  let s = String(sinistra ?? "");
  if (s.length > spazio) s = s.slice(0, Math.max(0, spazio - 1)) + "…";
  return s + " ".repeat(Math.max(1, colonne - s.length - d.length)) + d;
}

/** Una riga di separazione, larga quanto la carta. */
export const linea = (ch = "-", colonne = COLONNE) => ch.repeat(colonne);

/** Riga fisica, gia' spezzata e pronta da stampare. */
export interface RigaFisica {
  testo: string;
  taglia: Taglia;
  grassetto: boolean;
  centrato: boolean;
  inverso: boolean;
}

/**
 * Da righe logiche a righe fisiche. ⚠️ Questa funzione e' l'UNICO posto che
 * decide dove un testo va a capo: la stampa e l'anteprima la chiamano tutte e
 * due. Se l'anteprima impaginasse per conto suo, mostrerebbe un ticket che
 * non e' quello che esce — cioe' peggio di nessuna anteprima.
 */
export function impagina(righe: RigaTicket[]): RigaFisica[] {
  const out: RigaFisica[] = [];
  for (const r of righe ?? []) {
    const t = taglieDi(r.taglia);
    const nome = ((r.taglia ?? "normale") as Taglia) in TAGLIE ? ((r.taglia ?? "normale") as Taglia) : "normale";
    const inverso = Boolean((r as RigaTicket & { inverso?: boolean }).inverso);
    const testo = String(r.testo ?? "");
    /* ⚠️ Il rientro di partenza si conserva, NON si passa dentro `aCapo`.
       Le righe di servizio arrivano scritte come «   33 cm», e `aCapo` spezza
       sugli spazi: mangiava i tre davanti, cosi' «sans ail» finiva incolonnato
       coi piatti e in cucina sembrava un piatto in piu'. E' il difetto che il
       rientro esisteva per evitare, nato dal rientro stesso. */
    const pad = testo.match(/^ +/)?.[0].length ?? 0;
    const nudo = testo.trimStart();
    const pezzi = nudo === ""
      ? [""]
      : aCapo(nudo, Math.max(8, t.colonne - pad), 3).map((x) => " ".repeat(pad) + x);
    for (const p of pezzi) {
      out.push({ testo: p, taglia: nome, grassetto: Boolean(r.grassetto), centrato: Boolean(r.centrato), inverso });
    }
    if (r.linea) out.push({ testo: linea("-", TAGLIE.normale.colonne), taglia: "normale", grassetto: false, centrato: false, inverso: false });
  }
  return out;
}

/** Il testo del ticket come si vedrebbe su carta. Serve ai test e
 *  all'anteprima nel pannello: nessuno sa leggere dei byte. */
export function anteprima(righe: RigaTicket[]): string {
  /* ⚠️ Le righe non hanno tutte la stessa griglia: 24 colonne in gigante, 64
     in piccolo, 48 nelle altre. Il rientro si riporta sulla CARTA, se no
     l'anteprima mostra l'ora appiccicata a sinistra e il codice spostato a
     destra — due cose che sulla carta vera non succedono, e si passerebbe la
     serata a sistemare un difetto che esiste solo nell'anteprima. */
  return impagina(righe)
    .map((r) => {
      const col = TAGLIE[r.taglia].colonne;
      const scala = COLONNE / col;
      const vuoto = r.centrato ? Math.max(0, Math.floor(((col - r.testo.length) / 2) * scala)) : 0;
      const t = " ".repeat(vuoto) + r.testo;
      return r.inverso ? `[${t}]` : t;
    })
    .join("\n");
}

/**
 * Il ticket pronto per la stampante.
 *
 * ⚠️ La fascia in negativo si riempie di SPAZI fino al bordo. Il nero lo fa la
 * carta bruciata sotto i caratteri: senza gli spazi resta un rettangolino
 * intorno alle lettere, e «DA INCASSARE» smette di essere una fascia che si
 * vede attraversando la cucina.
 */
/**
 * Lo stesso ticket come TESTO.
 *
 * ⚠️ Non e' una scorciatoia: e' quello che viaggia davvero. Il servizio di
 * stampa legge il corpo della risposta COME TESTO — e' per questo che l'UTF-8
 * passa e le tabelle di caratteri no. Tutti i comandi ESC/POS stanno sotto
 * 128, quindi i byte e il testo sono la stessa cosa, e `componi` resta la
 * sola che li costruisce. Un test prova l'andata e ritorno: il giorno che un
 * comando nuovo portasse un byte fuori da UTF-8, si scoprirebbe li' e non
 * su un ticket illeggibile.
 */
export function componiTesto(righe: RigaTicket[]): string {
  return new TextDecoder().decode(componi(righe));
}

export function componi(righe: RigaTicket[]): Uint8Array {
  const enc = new TextEncoder();
  const parti: Uint8Array[] = [C.init];
  let taglia: Taglia | null = null;
  let grass = false, centro = false, inv = false;

  for (const r of impagina(righe)) {
    if (taglia !== r.taglia) {
      if (taglia) parti.push(TAGLIE[taglia].post);
      parti.push(TAGLIE[r.taglia].cmd, TAGLIE[r.taglia].pre);
      taglia = r.taglia;
    }
    if (grass !== r.grassetto) { parti.push(r.grassetto ? C.grassOn : C.grassOff); grass = r.grassetto; }
    if (centro !== r.centrato) { parti.push(r.centrato ? C.centro : C.sinistra); centro = r.centrato; }
    if (inv !== r.inverso) { parti.push(r.inverso ? C.invOn : C.invOff); inv = r.inverso; }
    const col = TAGLIE[r.taglia].colonne;
    const testo = r.inverso ? r.testo.padEnd(col, " ").slice(0, col) : r.testo;
    parti.push(enc.encode(testo + "\n"));
  }

  if (taglia) parti.push(TAGLIE[taglia].post);
  if (inv) parti.push(C.invOff);
  if (grass) parti.push(C.grassOff);
  parti.push(TAGLIE.normale.cmd, C.sinistra);
  // Tre righe vuote: la lama sta qualche millimetro sopra la testina, e senza
  // questo avanzamento il taglio cadrebbe dentro l'ultima riga scritta.
  parti.push(enc.encode("\n\n\n"), C.taglio);

  const totale = parti.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(totale);
  let i = 0;
  for (const p of parti) { out.set(p, i); i += p.length; }
  return out;
}
