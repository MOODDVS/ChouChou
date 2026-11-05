/**
 * LA CASELLA RESEND DI INTÉGRATIONS — le regole pure (5/11/2026).
 *
 * Un solo account Resend MOODD, un dominio per cliente, una chiave per
 * cliente. La chiave si scrive nella casella (cifrata nel database, #95) e il
 * `.env` resta come ripiego. Qui solo le decisioni, senza rete: che chiave e
 * che mittente valgono, come si mostrano, a che punto e' il dominio.
 */

/** Le chiavi di `brand_secrets` e di `app_config` usate dalla casella. */
export const CHIAVE_RESEND = "resend_api_key";
export const K_MITTENTE_NOME = "resend_from_name";
export const K_MITTENTE_EMAIL = "resend_from_email";

/** Una chiave Resend ha questa forma: `re_` e poi lettere, cifre, trattini bassi. */
export function chiaveValida(k: unknown): boolean {
  return /^re_[A-Za-z0-9_]{16,}$/.test(String(k ?? "").trim());
}

/** La chiave da mostrare: mai intera, solo le ultime quattro. */
export function chiaveMascherata(k: string): string {
  const v = String(k ?? "").trim();
  return v.length > 8 ? `re_••••${v.slice(-4)}` : v ? "re_••••" : "";
}

/** Il mittente dell'`.env` senza la virgolettatura stray («"Nome <mail>"»),
 *  che Resend rifiuta con 422 «Invalid from field». */
export function pulisciMittente(v: unknown): string {
  return String(v ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

export function emailValida(v: unknown): boolean {
  return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(String(v ?? "").trim());
}

/** «Nome <email>». Dal nome si tolgono i caratteri che romperebbero l'intestazione. */
export function componiMittente(nome: unknown, email: unknown): string {
  const e = String(email ?? "").trim();
  if (!emailValida(e)) return "";
  const n = String(nome ?? "").replace(/[<>"\r\n]/g, "").trim();
  return n ? `${n} <${e}>` : e;
}

/** L'indirizzo dentro «Nome <email>» (o l'email da sola). */
export function emailDelMittente(mittente: string): string {
  const m = String(mittente ?? "").match(/<([^>]+)>/);
  return (m ? m[1] : String(mittente ?? "")).trim();
}

/** Il nome dentro «Nome <email>», "" se non c'e'. */
export function nomeDelMittente(mittente: string): string {
  const m = String(mittente ?? "").match(/^(.*?)\s*<[^>]+>\s*$/);
  return m ? m[1].trim() : "";
}

export function dominioDi(email: string): string {
  const e = emailDelMittente(email);
  const i = e.lastIndexOf("@");
  return i > 0 ? e.slice(i + 1).toLowerCase() : "";
}

export type FonteValore = "casella" | "env" | "nessuna";

/**
 * Quale chiave vale. La casella vince sull'`.env`.
 *
 * ⚠️ Una riga che non si apre (`""`: `SECRETS_KEY` cambiata, riga manomessa)
 * NON e' una riga assente, ma per le email si ripiega lo stesso sull'`.env`:
 * al contrario di Stripe non ci sono soldi che finiscono sul conto sbagliato,
 * e una conferma di prenotazione che parte vale piu' di una che resta ferma.
 * Il guasto pero' si DICE (`rotta`): la casella lo mostra.
 */
export function scegliChiave(
  dallaCasella: string | null,
  dallEnv: string,
): { chiave: string; fonte: FonteValore; rotta: boolean } {
  const rotta = dallaCasella === "";
  if (dallaCasella) return { chiave: dallaCasella, fonte: "casella", rotta: false };
  if (dallEnv) return { chiave: dallEnv, fonte: "env", rotta };
  return { chiave: "", fonte: "nessuna", rotta };
}

/** Quale mittente vale: quello della casella, poi `RESEND_FROM`. */
export function scegliMittente(nome: string, email: string, dallEnv: string): { mittente: string; fonte: FonteValore } {
  const suo = componiMittente(nome, email);
  if (suo) return { mittente: suo, fonte: "casella" };
  const env = pulisciMittente(dallEnv);
  if (env) return { mittente: env, fonte: "env" };
  return { mittente: "", fonte: "nessuna" };
}

/** Lo stato di un dominio come lo dice Resend, ridotto a tre. */
export type StatoDominio = "verificato" | "attesa" | "assente" | "ignoto";

/**
 * Il dominio del mittente e' fra quelli dell'account, e verificato?
 * `domini` null = non si e' potuto chiedere (chiave «solo invio»): ignoto.
 */
export function statoDominio(domini: { name: string; status: string }[] | null, dominio: string): StatoDominio {
  if (!domini || !dominio) return "ignoto";
  const d = domini.find((x) => String(x.name).toLowerCase() === dominio);
  if (!d) return "assente";
  return d.status === "verified" ? "verificato" : "attesa";
}

export type Livello = "ok" | "parz" | "no" | "ignoto";

/**
 * Il segno della casella. Rosso = le email non partono (niente chiave o
 * niente mittente, o dominio assente). Arancio = partono ma c'e' da fare
 * (chiave ancora nel `.env`, riga illeggibile, dominio in attesa).
 */
export function livelloResend(s: {
  fonteChiave: FonteValore;
  rotta: boolean;
  fonteMittente: FonteValore;
  dominio: StatoDominio;
}): { livello: Livello; daFare: number } {
  if (s.fonteChiave === "nessuna" || s.fonteMittente === "nessuna" || s.dominio === "assente") {
    return { livello: "no", daFare: 1 };
  }
  let daFare = 0;
  if (s.fonteChiave === "env" || s.rotta) daFare++;
  if (s.fonteMittente === "env") daFare++;
  if (s.dominio === "attesa") daFare++;
  return { livello: daFare ? "parz" : "ok", daFare };
}
