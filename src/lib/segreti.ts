/**
 * SEGRETI A RIPOSO — cifratura dei valori di `location_secrets`.
 *
 * Le chiavi Stripe di ogni sede non stanno piu' nel `.env` ma nel database:
 * tre societa', tre conti, un solo deploy — nel file non ci stanno. Ma un
 * database NON e' un posto piu' sicuro di un file: e' replicato, finisce nei
 * backup, si esporta dal pannello Supabase e lo legge chiunque abbia la
 * service key. Il bersaglio e' PIU' LARGO, non piu' stretto.
 *
 * Quindi i valori si cifrano con una chiave che resta nel `.env`
 * (`SECRETS_KEY`): il database da solo non basta piu' a leggerli. Non stiamo
 * aggiungendo un posto dove tenere un segreto — `SUPABASE_SERVICE_KEY` e
 * `CRON_SECRET` devono stare fuori dal database comunque — stiamo spostando
 * tutto il resto dentro l'unico che rimane.
 *
 * ⚠️ AES-256-GCM, non AES-CBC: GCM autentica anche il testo cifrato. Con CBC
 * chi puo' scrivere nella tabella puo' modificare il contenuto senza che la
 * decifratura se ne accorga — e qui il contenuto e' la chiave con cui si
 * incassa.
 *
 * ⚠️ Un valore SENZA il prefisso di versione si rende com'e'. Non e' una
 * comodita': nelle installazioni di oggi i segreti sono gia' scritti in
 * chiaro, e rifiutarli vorrebbe dire rompere i pagamenti nel momento esatto
 * in cui si lancia questa versione. Si rileggono, e alla prima riscrittura
 * diventano cifrati.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFISSO = "v1.";

/** Chiave madre: 32 byte in base64 nel `.env`. Assente = non si cifra. */
function chiaveMadre(): Buffer | null {
  const raw = String(import.meta.env.SECRETS_KEY ?? process.env.SECRETS_KEY ?? "").trim();
  if (!raw) return null;
  try {
    const b = Buffer.from(raw, "base64");
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

/** C'e' una chiave madre valida? Lo chiede l'API prima di accettare un segreto. */
export function cifraturaPronta(): boolean {
  return chiaveMadre() !== null;
}

/**
 * Cifra un valore. Lancia se la chiave madre manca o e' malformata: un
 * segreto scritto in chiaro «perche' la configurazione non c'era» e' proprio
 * il guasto silenzioso da cui questo file esiste per difendere.
 */
export function cifra(valore: string): string {
  const k = chiaveMadre();
  if (!k) throw new Error("SECRETS_KEY mancante o non valida (32 byte in base64)");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(valore, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFISSO + [iv, tag, ct].map((b) => b.toString("base64")).join(".");
}

/**
 * Decifra un valore. Rende `""` se il testo e' stato manomesso o la chiave
 * madre non e' quella con cui era stato cifrato — mai un valore parziale:
 * una chiave Stripe a meta' fallirebbe da Stripe con un errore che non dice
 * niente, mentre un valore vuoto lo si riconosce e si ripiega sul `.env`.
 */
export function decifra(valore: string): string {
  const v = String(valore ?? "");
  if (!v.startsWith(PREFISSO)) return v; // scritto prima della cifratura
  const k = chiaveMadre();
  if (!k) return "";
  const [iv, tag, ct] = v.slice(PREFISSO.length).split(".");
  if (!iv || !tag || !ct) return "";
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}
