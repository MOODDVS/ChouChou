/**
 * IL TOKEN DELLA STAMPA DI PROVA — una serratura che si apre da sola.
 *
 * ⚠️ PERCHE' FIRMATO E NON SALVATO. La pagina del ticket la legge un servizio
 * di stampa che non sa fare login: l'indirizzo E' l'autorizzazione, come per
 * il link di annullo del cliente. Per un ordine vero il token sta nella riga
 * di `print_tickets`, e li' e' giusto. Ma una PROVA non ha un ordine, e
 * `print_tickets.order_id` non puo' essere vuoto: o si allarga la tabella per
 * una cosa che vive dieci minuti, o si firma un biglietto che scade da solo.
 *
 * ⚠️ VALIDITA' CORTA, e scritta DENTRO il biglietto. Un token di prova che
 * non scade e' un indirizzo pubblico che stampa su una stampante vera, per
 * sempre: chiunque lo ritrovi in una cronologia puo' far uscire carta in una
 * cucina. Dieci minuti sono il tempo di premere il bottone e guardare il
 * foglio.
 *
 * Nessun import del motore: solo `node:crypto`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Quanto vive un biglietto di prova. */
export const VALIDITA_PROVA_S = 600;

/** ⚠️ Il separatore e' `~`, NON un punto. Un indirizzo come
 *  `/api/print/p.XXX.YYY` sembra un file con un'estensione, e fra un proxy,
 *  un server statico e una regola di cache c'e' sempre qualcuno disposto a
 *  trattarlo come tale invece di passarlo alla rotta. `~` e' valido in un URL
 *  e non compare in base64url, quindi puo' fare da separatore senza ambiguita'
 *  — ed e' anche il segno che distingue questo biglietto dal token di una
 *  riga della coda, che non ne contiene mai. */
const PREFISSO = "~";
const SEP = "~";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const deB64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

function firma(dati: string, segreto: string): string {
  return createHmac("sha256", String(segreto)).update(dati).digest("base64url");
}

/** Un biglietto per la sede indicata (stringa vuota = installazione a sede
 *  unica), valido `VALIDITA_PROVA_S` secondi. */
export function firmaProva(sede: string, segreto: string, adessoMs = Date.now()): string {
  const scadenza = Math.floor(adessoMs / 1000) + VALIDITA_PROVA_S;
  const dati = b64(`${String(sede ?? "")}|${scadenza}`);
  return `${PREFISSO}${dati}${SEP}${firma(dati, segreto)}`;
}

/** La sede del biglietto, o `null` se non e' nostro, e' stato ritoccato o e'
 *  scaduto. ⚠️ Un confronto a tempo costante: la firma si verifica, non si
 *  confronta con `===`. */
export function leggiProva(token: string, segreto: string, adessoMs = Date.now()): { sede: string } | null {
  const t = String(token ?? "");
  if (!t.startsWith(PREFISSO) || !segreto) return null;
  const [dati, dato] = t.slice(PREFISSO.length).split(SEP);
  if (!dati || !dato) return null;
  const attesa = Buffer.from(firma(dati, segreto), "utf8");
  const avuta = Buffer.from(dato, "utf8");
  if (attesa.length !== avuta.length || !timingSafeEqual(attesa, avuta)) return null;
  const chiaro = deB64(dati);
  // ⚠️ Un biglietto di CHIAMATA (JSON, vedi sotto) non e' una prova.
  if (chiaro.startsWith("{")) return null;
  const [sede, scadenza] = chiaro.split("|");
  if (!Number.isFinite(Number(scadenza)) || Number(scadenza) * 1000 < adessoMs) return null;
  return { sede: sede ?? "" };
}

/** `true` se il token e' un biglietto di prova (nostro o no): serve alla rotta
 *  per sapere da che parte guardare, prima ancora di verificarlo. */
export const sembraProva = (token: string) => String(token ?? "").startsWith(PREFISSO);

/* ==========================================================================
   IL BIGLIETTO DI UNA CHIAMATA DAL TAVOLO (22/10/2026).

   Stessa serratura della prova, per la stessa ragione: una chiamata non e'
   un ordine, e `print_tickets.order_id` non puo' essere vuoto. Il biglietto
   porta DENTRO quello che il ticket deve dire — tavolo o nome, se e' una
   richiesta d'addizione, l'ora — firmato, quindi nessuno puo' cambiarlo, e
   la rotta non deve leggere niente dal database.
   ⚠️ JSON e non `|`: il nome lo scrive il cliente, e una barra dentro
   «Marc|Anna» spezzerebbe i campi.
   ========================================================================== */

export interface DatiChiamata {
  /** La sede (stringa vuota = sede unica). */
  sede: string;
  /** Il nome del tavolo, o "" in una sala senza piano. */
  tavolo: string;
  /** Il nome di chi chiama, quando non c'e' il tavolo. */
  nome: string;
  /** «Demander l'addition» invece di «Appeler le serveur». */
  conto: boolean;
  /** L'istante della chiamata, in secondi. */
  ora: number;
}

export function firmaChiamata(d: Omit<DatiChiamata, "ora">, segreto: string, adessoMs = Date.now()): string {
  const ora = Math.floor(adessoMs / 1000);
  const dati = b64(JSON.stringify({
    k: "c",
    s: String(d.sede ?? ""),
    t: String(d.tavolo ?? "").slice(0, 40),
    n: String(d.nome ?? "").slice(0, 40),
    b: d.conto ? 1 : 0,
    o: ora,
    x: ora + VALIDITA_PROVA_S,
  }));
  return `${PREFISSO}${dati}${SEP}${firma(dati, segreto)}`;
}

/** I dati della chiamata, o `null` se il biglietto non e' una chiamata, e'
 *  stato ritoccato o e' scaduto. */
export function leggiChiamata(token: string, segreto: string, adessoMs = Date.now()): DatiChiamata | null {
  const t = String(token ?? "");
  if (!t.startsWith(PREFISSO) || !segreto) return null;
  const [dati, dato] = t.slice(PREFISSO.length).split(SEP);
  if (!dati || !dato) return null;
  const attesa = Buffer.from(firma(dati, segreto), "utf8");
  const avuta = Buffer.from(dato, "utf8");
  if (attesa.length !== avuta.length || !timingSafeEqual(attesa, avuta)) return null;
  let j: { k?: unknown; s?: unknown; t?: unknown; n?: unknown; b?: unknown; o?: unknown; x?: unknown };
  try {
    j = JSON.parse(deB64(dati));
  } catch {
    return null;
  }
  if (!j || j.k !== "c") return null;
  if (!Number.isFinite(Number(j.x)) || Number(j.x) * 1000 < adessoMs) return null;
  return {
    sede: String(j.s ?? ""),
    tavolo: String(j.t ?? ""),
    nome: String(j.n ?? ""),
    conto: j.b === 1,
    ora: Number(j.o) || 0,
  };
}

/* ==========================================================================
   IL BIGLIETTO D'ANNULLO PER LA CUCINA (25/10/2026, il palmare).

   Un ordine annullato (o dei piatti tolti con la matita) DOPO che la comanda
   e' uscita: la cucina sta gia' preparando, e deve saperlo su carta. Stessa
   serratura della chiamata: dentro c'e' quello che il ticket deve dire —
   tavolo, chi, ora, i piatti tolti — perche' i piatti tolti non stanno piu'
   nell'ordine. ⚠️ Piu' lungo della chiamata (la rotta accetta fino a 2000
   segni): al massimo `MAX_RIGHE_ANNULLO` righe, nomi tagliati.
   ⚠️ Vive 30 minuti: il servizio di stampa puo' riprovare se la stampante
   era spenta un attimo, ma un annullo di stamattina stasera non serve.
   ========================================================================== */

export const VALIDITA_ANNULLO_S = 1800;
export const MAX_RIGHE_ANNULLO = 20;

export interface DatiAnnullo {
  sede: string;
  tavolo: string;
  /** Chi ha annullato (il cameriere). */
  chi: string;
  ora: number;
  righe: { qty: number; nome: string; variante: string | null }[];
}

export function firmaAnnullo(d: Omit<DatiAnnullo, "ora">, segreto: string, adessoMs = Date.now()): string {
  const ora = Math.floor(adessoMs / 1000);
  const dati = b64(JSON.stringify({
    k: "a",
    s: String(d.sede ?? ""),
    t: String(d.tavolo ?? "").slice(0, 40),
    c: String(d.chi ?? "").slice(0, 30),
    o: ora,
    x: ora + VALIDITA_ANNULLO_S,
    r: d.righe.slice(0, MAX_RIGHE_ANNULLO).map((r) => [
      Math.max(1, Math.floor(Number(r.qty) || 1)),
      String(r.nome ?? "").slice(0, 32),
      String(r.variante ?? "").slice(0, 20),
    ]),
  }));
  return `${PREFISSO}${dati}${SEP}${firma(dati, segreto)}`;
}

export function leggiAnnullo(token: string, segreto: string, adessoMs = Date.now()): DatiAnnullo | null {
  const t = String(token ?? "");
  if (!t.startsWith(PREFISSO) || !segreto) return null;
  const [dati, dato] = t.slice(PREFISSO.length).split(SEP);
  if (!dati || !dato) return null;
  const attesa = Buffer.from(firma(dati, segreto), "utf8");
  const avuta = Buffer.from(dato, "utf8");
  if (attesa.length !== avuta.length || !timingSafeEqual(attesa, avuta)) return null;
  let j: { k?: unknown; s?: unknown; t?: unknown; c?: unknown; o?: unknown; x?: unknown; r?: unknown };
  try {
    j = JSON.parse(deB64(dati));
  } catch {
    return null;
  }
  if (!j || j.k !== "a") return null;
  if (!Number.isFinite(Number(j.x)) || Number(j.x) * 1000 < adessoMs) return null;
  const righe = (Array.isArray(j.r) ? j.r : []).flatMap((r) => {
    if (!Array.isArray(r)) return [];
    return [{ qty: Math.max(1, Math.floor(Number(r[0]) || 1)), nome: String(r[1] ?? ""), variante: String(r[2] ?? "") || null }];
  });
  return { sede: String(j.s ?? ""), tavolo: String(j.t ?? ""), chi: String(j.c ?? ""), ora: Number(j.o) || 0, righe };
}
