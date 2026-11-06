/**
 * IL RITORNO UNICO DA GOOGLE (6/11/2026).
 *
 * Prima ogni sito mandava Google a tornare su se' stesso
 * (`<sito>/api/google/callback`), e ogni sito nuovo era un indirizzo in piu'
 * da registrare a mano nella console Google — piu' uno per localhost.
 *
 * Adesso Google torna sempre su UN indirizzo (`app.restohub.cloud`), che
 * rimanda subito al sito giusto. Il sito giusto e' scritto nello `state`, e
 * lo `state` porta DUE firme:
 *  - quella del sito (la sua service key): la controlla il sito al ritorno,
 *    come prima — anti-CSRF, e nessun altro sito la puo' fare al suo posto;
 *  - quella dell'app Google di MOODD (`GOOGLE_CLIENT_SECRET`, che ogni sito
 *    ha gia'): la controlla il passaggio, che senza non rimanda da nessuna
 *    parte. Nessuno puo' usarlo per dirottare un codice verso un sito suo.
 *
 * Il passaggio non scambia il codice e non tiene niente: inoltra e basta.
 * Il token finisce, come prima, nel database del sito che l'ha chiesto.
 *
 * Qui solo regole pure (niente env, niente rete): si provano dai test.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** L'unico indirizzo da registrare su Google Cloud → Credenziali → URI di reindirizzamento. */
export const RITORNO_UNICO = "https://app.restohub.cloud/api/google/ritorno";
/** Dove il passaggio rimanda, sul sito che ha chiesto il collegamento. */
export const PERCORSO_CALLBACK = "/api/google/callback";

const LOCALI = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * L'origine di un sito a cui si puo' tornare, o "" se non va.
 * Solo https; http solo per localhost (le prove sul Mac). Niente utente e
 * password nell'indirizzo, niente percorso: si torna sempre al callback.
 */
export function origineValida(o: unknown): string {
  let u: URL;
  try {
    u = new URL(String(o ?? "").trim());
  } catch {
    return "";
  }
  if (u.username || u.password) return "";
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && LOCALI.has(u.hostname)) return u.origin;
  return "";
}

export function firmaCon(segreto: string, payload: string): string {
  return createHmac("sha256", segreto).update(payload).digest("base64url");
}

export function firmaGiusta(segreto: string, payload: string, mac: string): boolean {
  if (!segreto || !payload || !mac) return false;
  const atteso = Buffer.from(firmaCon(segreto, payload));
  const dato = Buffer.from(mac);
  return atteso.length === dato.length && timingSafeEqual(atteso, dato);
}

export interface DatiState { n: string; exp: number; r: string }

export function leggiPayload(payload: string): DatiState | null {
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<DatiState>;
    if (typeof d.exp !== "number" || typeof d.n !== "string") return null;
    return { n: d.n, exp: d.exp, r: typeof d.r === "string" ? d.r : "" };
  } catch {
    return null;
  }
}

/**
 * Lo `state`: `payload.firmaSito.firmaApp`.
 * `segretoSito` = service key del sito; `segretoApp` = GOOGLE_CLIENT_SECRET.
 */
export function componiState(dati: DatiState, segretoSito: string, segretoApp: string): string {
  const payload = Buffer.from(JSON.stringify(dati)).toString("base64url");
  return `${payload}.${firmaCon(segretoSito, payload)}.${firmaCon(segretoApp, payload)}`;
}

/**
 * Il passaggio: a quale callback rimandare, o `null` se lo `state` non e'
 * firmato dall'app MOODD, e' scaduto o non dice un sito valido.
 */
export function destinazione(state: string, segretoApp: string, ora = Date.now()): string | null {
  const [payload, , macApp] = String(state ?? "").split(".");
  if (!firmaGiusta(segretoApp, payload, macApp)) return null;
  const d = leggiPayload(payload);
  if (!d || ora >= d.exp) return null;
  const r = origineValida(d.r);
  return r ? r + PERCORSO_CALLBACK : null;
}

/**
 * Il sito a cui tornare: il sito pubblico; ma se l'admin e' aperto da
 * localhost, localhost (il `.env` del Mac ha l'indirizzo del sito vero, e
 * il token deve finire nel database da cui si e' premuto «Connetti» — che e'
 * lo stesso, ma la pagina di ritorno e' quella aperta).
 */
export function sitoDiRitorno(origineRichiesta: string | null, sitoPubblico: string): string {
  const o = origineValida(origineRichiesta);
  if (o && LOCALI.has(new URL(o).hostname)) return o;
  return origineValida(sitoPubblico) || o;
}
