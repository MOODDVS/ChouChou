/**
 * LA CASELLA STRIPE DI INTÉGRATIONS — le regole pure (5/11/2026).
 *
 * Due livelli: il MARCHIO (`brand_secrets`, #95) e ogni SEDE
 * (`location_secrets`, #73). La sede senza chiave sua eredita dal marchio,
 * il marchio senza chiave dal `.env`. Qui solo le decisioni, senza rete.
 *
 * ⚠️ Le due meta' di un conto — la chiave con cui si incassa e la firma del
 * webhook che dice «pagato» — devono venire DALLO STESSO POSTO
 * (`pagamentoOnlinePronto` in `sedeRegole.ts`). La casella lo mostra.
 */
import type { Fonte } from "./sedeRegole";

export const K_CHIAVE = "stripe_secret_key";
export const K_FIRMA = "stripe_webhook_secret";

/** L'indirizzo del webhook: UNO per tutti i conti (vedi api/stripe-webhook.ts). */
export const PERCORSO_WEBHOOK = "/api/stripe-webhook";

/** Gli eventi che il webhook usa. Uno solo: il pagamento completato. */
export const EVENTI_WEBHOOK = ["checkout.session.completed"];

/** Chiave segreta (`sk_`) o limitata (`rk_`), live o test. */
export function chiaveStripeValida(k: unknown): boolean {
  return /^(sk|rk)_(live|test)_[A-Za-z0-9]{16,}$/.test(String(k ?? "").trim());
}

/** Una chiave pubblicabile incollata al posto della segreta: errore tipico. */
export function chiavePubblicabile(k: unknown): boolean {
  return /^pk_(live|test)_/.test(String(k ?? "").trim());
}

export function firmaValida(w: unknown): boolean {
  return /^whsec_[A-Za-z0-9+/=_-]{16,}$/.test(String(w ?? "").trim());
}

export function modoChiave(k: string): "live" | "test" | "" {
  const m = String(k ?? "").match(/^(?:sk|rk)_(live|test)_/);
  return m ? (m[1] as "live" | "test") : "";
}

/** `sk_live_••••4f2a`: il prefisso dice che chiave e', mai il resto. */
export function chiaveStripeMascherata(k: string): string {
  const v = String(k ?? "").trim();
  const m = v.match(/^((?:sk|rk|whsec)_(?:(?:live|test)_)?)/);
  if (!v) return "";
  return `${m ? m[1] : ""}••••${v.length > 12 ? v.slice(-4) : ""}`;
}

/** L'URL del webhook per un sito: `https://x.be/api/stripe-webhook`. */
export function urlWebhook(sito: string): string {
  return String(sito ?? "").replace(/\/+$/, "") + PERCORSO_WEBHOOK;
}

export type StatoWebhook = "ok" | "eventi" | "spento" | "assente" | "ignoto";

/**
 * Il webhook di questo conto c'e' ed e' giusto?
 *
 * Online si cerca l'URL esatto. In locale (`sito` = localhost) l'URL del
 * sito vero non si conosce: si cerca il PERCORSO su qualunque dominio e si
 * dice quale (`domini`), come i job della casella Supabase.
 */
export function webhookGiusto(
  endpoints: { id: string; url: string; status: string; enabled_events: string[] }[] | null,
  sito: string,
  online: boolean,
): { stato: StatoWebhook; id: string; domini: string[] } {
  if (!endpoints) return { stato: "ignoto", id: "", domini: [] };
  const atteso = urlWebhook(sito);
  const nostri = endpoints.filter((e) => (online ? e.url.replace(/\/+$/, "") === atteso : e.url.replace(/\/+$/, "").endsWith(PERCORSO_WEBHOOK)));
  const domini = [...new Set(nostri.map((e) => { try { return new URL(e.url).host; } catch { return ""; } }).filter(Boolean))];
  if (!nostri.length) return { stato: "assente", id: "", domini };
  const buono = (e: (typeof nostri)[number]) =>
    e.enabled_events.includes("*") || EVENTI_WEBHOOK.every((ev) => e.enabled_events.includes(ev));
  const attivo = nostri.find((e) => e.status === "enabled" && buono(e));
  if (attivo) return { stato: "ok", id: attivo.id, domini };
  const acceso = nostri.find((e) => e.status === "enabled");
  return { stato: acceso ? "eventi" : "spento", id: (acceso ?? nostri[0]).id, domini };
}

export type Livello = "ok" | "parz" | "no" | "ignoto";

/** Un livello (marchio o sede) come lo vede la casella, senza chiamare Stripe. */
export interface RiepilogoLivello {
  id: string; // "marchio" o l'id della sede
  nome: string;
  fonteChiave: Fonte;
  fonteFirma: Fonte;
  /** Si incassa online qui: il conto ATTIVO e' pronto (chiave e firma dallo stesso posto). */
  pronto: boolean;
  /** Il conto attivo: "principale" o l'id di un conto alternativo (#96). */
  attivo?: string;
}

/**
 * Il segno della casella.
 *
 * - a sede unica conta il marchio; con le sedi contano le SEDI (e' li' che si
 *   incassa) — il marchio e' solo il loro ripiego;
 * - verde: si incassa ovunque, e niente viene piu' dal `.env`;
 * - arancio: si incassa ovunque ma qualcosa sta ancora nel `.env`, oppure
 *   solo in alcune sedi («2 / 3»);
 * - rosso: da nessuna parte.
 */
export function livelloStripe(livelli: RiepilogoLivello[]): { livello: Livello; pronti: number; totale: number; daEnv: boolean } {
  const sedi = livelli.filter((l) => l.id !== "marchio");
  const contano = sedi.length ? sedi : livelli.filter((l) => l.id === "marchio");
  const pronti = contano.filter((l) => l.pronto).length;
  const totale = contano.length;
  // Il .env conta solo se si incassa col principale: un alternativo e' sempre nel database.
  const daEnv = contano.some((l) => l.pronto && (l.attivo ?? "principale") === "principale" && (l.fonteChiave === "ambiente" || l.fonteFirma === "ambiente"));
  if (!totale || pronti === 0) return { livello: "no", pronti, totale, daEnv };
  if (pronti < totale || daEnv) return { livello: "parz", pronti, totale, daEnv };
  return { livello: "ok", pronti, totale, daEnv };
}
