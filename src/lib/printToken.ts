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

/** Il prefisso dice subito che non e' il token di una riga della coda: chi
 *  legge la rotta non deve indovinare di che tipo e' il biglietto. */
const PREFISSO = "p.";

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
  return `${PREFISSO}${dati}.${firma(dati, segreto)}`;
}

/** La sede del biglietto, o `null` se non e' nostro, e' stato ritoccato o e'
 *  scaduto. ⚠️ Un confronto a tempo costante: la firma si verifica, non si
 *  confronta con `===`. */
export function leggiProva(token: string, segreto: string, adessoMs = Date.now()): { sede: string } | null {
  const t = String(token ?? "");
  if (!t.startsWith(PREFISSO) || !segreto) return null;
  const [dati, dato] = t.slice(PREFISSO.length).split(".");
  if (!dati || !dato) return null;
  const attesa = Buffer.from(firma(dati, segreto), "utf8");
  const avuta = Buffer.from(dato, "utf8");
  if (attesa.length !== avuta.length || !timingSafeEqual(attesa, avuta)) return null;
  const [sede, scadenza] = deB64(dati).split("|");
  if (!Number.isFinite(Number(scadenza)) || Number(scadenza) * 1000 < adessoMs) return null;
  return { sede: sede ?? "" };
}

/** `true` se il token e' un biglietto di prova (nostro o no): serve alla rotta
 *  per sapere da che parte guardare, prima ancora di verificarlo. */
export const sembraProva = (token: string) => String(token ?? "").startsWith(PREFISSO);
