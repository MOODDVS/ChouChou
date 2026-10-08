/**
 * L'INDIRIZZO PUBBLICO di questa installazione — una domanda, una risposta.
 *
 * ⚠️ Serve a chi deve far APRIRE un indirizzo a qualcun altro: le email che
 * mandano un link al cliente, e il servizio di stampa che va a leggere il
 * ticket da un tablet. Fuori di qui nessuno deve ricostruirselo.
 *
 * ⚠️ IL GUASTO (05/10/2026): la prova di stampa lo prendeva da
 * `new URL(request.url).origin`. Dietro Hostinger il TLS finisce sul proxy e
 * il server Node vede arrivare una richiesta `http`: si spediva
 * `http://restohub.moodd.online/...`, Android rifiutava il traffico in chiaro
 * e il lavoro restava «inviato» senza che uscisse mai carta. Dal nostro lato
 * non c'era nessun errore: il motivo era scritto in un posto solo al mondo,
 * sullo schermo del tablet.
 *
 * L'ordine delle risposte non e' casuale:
 *  1. `PUBLIC_SITE_URL` — la verita' CONFIGURATA, la stessa che usano le
 *     email. Vale anche senza una richiesta sottomano, e un lavoro automatico
 *     (coda di stampa, cron) non ne ha nessuna.
 *  2. gli header del proxy, per chi ha una richiesta e non ha configurato
 *     niente.
 *  3. l'indirizzo della richiesta, come ultima spiaggia.
 */
const CONFIGURATO = String(
  process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "",
).trim().replace(/\/+$/, "");

/** `true` se l'installazione sa da sola dove vive. Senza, un lavoro
 *  automatico non puo' costruire nessun indirizzo da far aprire a nessuno. */
export const indirizzoConfigurato = (): boolean => CONFIGURATO !== "";

export function indirizzoPubblico(request?: Request): string {
  if (CONFIGURATO) return CONFIGURATO;
  if (!request) return "";
  const h = request.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!host) {
    try { return new URL(request.url).origin; } catch { return ""; }
  }
  // ⚠️ `https` di ripiego, non `http`: vedi il guasto qui sopra. In sviluppo
  // invece `http` e' la verita', e dire `https` su localhost sarebbe un
  // indirizzo che non risponde.
  const locale = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const proto = (h.get("x-forwarded-proto") ?? (locale ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}
