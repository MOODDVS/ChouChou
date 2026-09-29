/**
 * COME SI PAGA UN ORDINE — le due letture dal database.
 *
 * Le regole (quali chiavi, quali ripieghi, come si legge un interruttore)
 * stanno in `ordiniRegole.ts`, che non importa niente ed e' percio'
 * testabile: qui dentro si arriva a `db.ts`, che in vitest lancia all'import.
 * Vedi la nota in testa a quel file.
 */
import { leggiConfig, pagamentoOnlineAttivo, type Ambito } from "./admin/sede";
import { CHIAVI_ORDINI, acceso, type OpzioniOrdini } from "./ordiniRegole";

export { CHIAVI_ORDINI, acceso, RIPIEGO_ORDINI, type OpzioniOrdini } from "./ordiniRegole";

/** Cosa ha chiesto il ristoratore, per questo punto. */
export async function opzioniOrdini(ambito: Ambito): Promise<OpzioniOrdini> {
  try {
    const { valori } = await leggiConfig(ambito, CHIAVI_ORDINI);
    return {
      online: acceso(valori.get("orders_pay_online"), "orders_pay_online"),
      locale: acceso(valori.get("orders_pay_onsite"), "orders_pay_onsite"),
      coupon: acceso(valori.get("orders_coupons"), "orders_coupons"),
    };
  } catch {
    // Database muto: si torna al comportamento di sempre, non a un sito che
    // non prende ordini.
    return { online: true, locale: false, coupon: true };
  }
}

/**
 * COSA SI PUO' DAVVERO FARE in questo punto, adesso.
 *
 * ⚠️ E' questa che deve chiedere il sito pubblico, non `opzioniOrdini`: il
 * pagamento con carta richiede che il ristoratore lo voglia E che il conto
 * Stripe sia configurato. Chiedere solo la volonta' vorrebbe dire un bottone
 * «paga ora» che porta a un errore di Stripe, cioe' un ordine perso senza che
 * nessuno sappia perche'.
 *
 * ⚠️ `nessuno` non e' un caso teorico: e' un ristorante che ha spento il
 * pagamento online senza accendere quello al locale, o che non ha mai
 * configurato Stripe. In quel caso NON si prendono ordini, e il sito deve
 * dirlo con parole sue — mai far finta di prenderli.
 */
export async function modiDiPagamento(ambito: Ambito): Promise<{
  online: boolean;
  locale: boolean;
  coupon: boolean;
  nessuno: boolean;
}> {
  const [volute, stripePronto] = await Promise.all([
    opzioniOrdini(ambito),
    pagamentoOnlineAttivo(ambito),
  ]);
  const online = volute.online && stripePronto;
  return { online, locale: volute.locale, coupon: volute.coupon, nessuno: !online && !volute.locale };
}
