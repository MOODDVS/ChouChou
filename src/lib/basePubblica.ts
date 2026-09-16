/**
 * DOVE VIVE IL SITO PUBBLICO di questa installazione.
 *
 * Un'installazione puo' servire il sito alla radice (`""`, il caso normale
 * di un cliente) oppure sotto un prefisso (`"/demo01"`, le vetrine di
 * dimostrazione su restohub.moodd.online). Il valore sta in
 * `app_config.public_site_base` e lo leggono in tre posti:
 *
 *   - i link di pagamento generati dall'admin (ritorno da Stripe)
 *   - le email di prenotazione («modifier / annuler»)
 *   - il checkout pubblico
 *
 * ⚠️ IL NOME DI UN DEMO NON STA NEL MOTORE. Fino al 16/09/2026 il checkout
 * aveva scritto dentro `source === "demo01" ? "/demo01" : undefined`: un
 * demo nominato nel motore vuol dire che aggiungerne un secondo si tocca
 * qui, e che togliendoli per un cliente resta una stringa morta che nessuno
 * sa piu' a cosa serviva. Il motore non conosce i demo: conosce un prefisso,
 * e chi lo configura decide.
 *
 * ⚠️ Ed era la TERZA copia della stessa lettura. Le altre due — in
 * `api/admin/orders.ts` e in `notifications.ts` — erano gia' divergenti su un
 * dettaglio: una rendeva `undefined` e l'altra `""`. Sono la stessa domanda,
 * e ora hanno una risposta sola.
 */
import { appConfigEq } from "./appConfigCache";
import type { Ambito } from "./admin/sedeRegole";

/** Il prefisso normalizzato: `""` oppure `"/qualcosa"`, mai con slash finale. */
export async function basePubblica(ambito: Ambito): Promise<string> {
  try {
    const { data } = await appConfigEq("public_site_base", ambito);
    const v = String((data as { value?: unknown } | null)?.value ?? "").trim();
    if (!v) return "";
    return (v.startsWith("/") ? v : "/" + v).replace(/\/$/, "");
  } catch {
    // Configurazione irraggiungibile: la radice e' l'ipotesi che rompe meno.
    // Un link di ritorno alla home e' brutto; uno a un prefisso inventato e'
    // un 404 dopo un pagamento riuscito.
    return "";
  }
}

/** Come sopra, ma `undefined` invece di `""`: la forma che vuole Stripe,
 *  dove il campo si omette del tutto se il sito sta alla radice. */
export async function basePubblicaOpz(ambito: Ambito): Promise<string | undefined> {
  return (await basePubblica(ambito)) || undefined;
}
