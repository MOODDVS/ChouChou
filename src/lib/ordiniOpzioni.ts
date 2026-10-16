/**
 * COME SI PAGA UN ORDINE — le due letture dal database.
 *
 * Le regole (quali chiavi, quali ripieghi, come si legge un interruttore)
 * stanno in `ordiniRegole.ts`, che non importa niente ed e' percio'
 * testabile: qui dentro si arriva a `db.ts`, che in vitest lancia all'import.
 * Vedi la nota in testa a quel file.
 */
import { leggi, leggiConfig, pagamentoOnlineAttivo, type Ambito } from "./admin/sede";
import { DateTime } from "luxon";
import { CHIAVI_ORDINI, acceso, avvisaIlCliente, servizioInCorso, prossimaApertura, type OpzioniOrdini } from "./ordiniRegole";
import { configGiornoEffettiva } from "./schedule";
import { fusoDi } from "./fuso";
import { tavoliDelPiano, type TavoloDiSala } from "./pianoSalaRegole";

export { CHIAVI_ORDINI, acceso, RIPIEGO_ORDINI, type OpzioniOrdini } from "./ordiniRegole";

/** Cosa ha chiesto il ristoratore, per questo punto. */
export async function opzioniOrdini(ambito: Ambito): Promise<OpzioniOrdini> {
  try {
    const { valori } = await leggiConfig(ambito, CHIAVI_ORDINI);
    return {
      online: acceso(valori.get("orders_pay_online"), "orders_pay_online"),
      locale: acceso(valori.get("orders_pay_onsite"), "orders_pay_onsite"),
      coupon: acceso(valori.get("orders_coupons"), "orders_coupons"),
      couponInCassa: acceso(valori.get("orders_coupons_onsite"), "orders_coupons_onsite"),
      tavolo: acceso(valori.get("orders_table"), "orders_table"),
      avvisoScelto: String(valori.get("orders_table_notify") ?? ""),
    };
  } catch {
    // Database muto: si torna al comportamento di sempre, non a un sito che
    // non prende ordini.
    /* ⚠️ `tavolo: false` nel ripiego, a differenza di `online`. Un database
       muto non deve spegnere gli ordini — da sempre si continua a prenderli —
       ma non puo' nemmeno ACCENDERE una sala a chi non ce l'ha: un QR che
       porta a un modulo senza tavoli e' peggio di una pagina che non c'e'. */
    return { online: true, locale: false, coupon: true, couponInCassa: false, tavolo: false, avvisoScelto: "" };
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
  couponInCassa: boolean;
  nessuno: boolean;
  /** La sala e' accesa. ⚠️ Non e' incrociato con niente, a differenza di
   *  `online`: ordinare dal tavolo non dipende da Stripe — se il locale
   *  incassa solo al banco, al tavolo paga il cameriere. */
  tavolo: boolean;
}> {
  const [volute, stripePronto] = await Promise.all([
    opzioniOrdini(ambito),
    pagamentoOnlineAttivo(ambito),
  ]);
  const online = volute.online && stripePronto;
  return {
    online,
    locale: volute.locale,
    coupon: volute.coupon,
    // Un codice sconto in cassa vale solo se il ristoratore ha acceso
    // entrambe le cose: i coupon, e i coupon anche in cassa.
    couponInCassa: volute.coupon && volute.couponInCassa,
    nessuno: !online && !volute.locale,
    tavolo: volute.tavolo,
  };
}

/* ==========================================================================
   LA SALA: com’e’ fatta, e cosa comporta.
   ========================================================================== */

export interface OpzioniTavolo {
  /** Il ristoratore ha acceso gli ordini dal locale. */
  attivo: boolean;
  /** La sala ha almeno un tavolo disegnato. */
  conTavoli: boolean;
  /** Si manda l’email «c’e’ pronto» a chi ordina dal locale. */
  avvisa: boolean;
}

/**
 * ⚠️ «CI SONO I TAVOLI?» E’ UNA DOMANDA AI DATI, NON UN INTERRUTTORE.
 * Si guarda se `restaurant_tables` ha righe per questo punto. Un interruttore
 * in piu’ sarebbe una cosa da tenere d’accordo con la mappa della sala: il
 * giorno che si allontanano, il modulo chiede un numero di tavolo a un locale
 * che non ne ha — oppure non lo chiede a chi ce l’ha, e il cameriere non sa
 * dove portare il piatto.
 *
 * ⚠️ `reservation_plan_mode` NON serve a questo: quella chiave dice «i posti
 * li conta il piano della sala», che e’ un’altra domanda. Un locale puo’
 * avere i tavoli disegnati e contare i posti per zona.
 *
 * ⚠️ Lettura muta → «nessun tavolo», e non e’ indifferente: senza tavoli il
 * modulo chiede solo il nome, e si ordina. Dicendo il contrario si
 * pretenderebbe un numero di tavolo che nessuna lista puo’ confermare, e
 * l’ordine non partirebbe affatto.
 */
export async function opzioniTavolo(ambito: Ambito): Promise<OpzioniTavolo> {
  const [opz, quanti] = await Promise.all([opzioniOrdini(ambito), contaTavoli(ambito)]);
  const conTavoli = quanti > 0;
  return { attivo: opz.tavolo, conTavoli, avvisa: avvisaIlCliente(opz.avvisoScelto, conTavoli) };
}

export type { TavoloDiSala } from "./pianoSalaRegole";

/**
 * I TAVOLI DELLA SALA, per il menu a tendina del QR.
 *
 * ⚠️ L’ordine e i tavoli da tenere li decide `tavoliDelPiano` (regola pura,
 * provata): sections nell’ordine dei Réglages, nomi confrontati in modo
 * numerico, e FUORI i tavoli agganciati a sections che non esistono piu’.
 *
 * ⚠️ Lettura muta → elenco vuoto, che vuol dire «sala senza mappa»: si chiede
 * solo il nome e si ordina lo stesso. Mai un errore in faccia a chi e’ seduto.
 */
export async function tavoliDiSala(ambito: Ambito): Promise<TavoloDiSala[]> {
  try {
    /* ⚠️ Le due letture insieme: i tavoli NON bastano. Una riga di
       `restaurant_tables` puo' appartenere a una section cancellata o
       rinominata, e nessun piano di sala la mostra piu'. Chi decide quali
       sono veri e' `reservation_zones` — la stessa chiave che il piano di
       sala e l'assegnazione delle prenotazioni usano da sempre. */
    const [righe, cfg] = await Promise.all([
      leggi("restaurant_tables", ambito, "id, name, zone"),
      leggiConfig(ambito, ["reservation_zones"]),
    ]);
    if (righe.error) return [];
    return tavoliDelPiano(righe.data ?? [], cfg.valori.get("reservation_zones") ?? "");
  } catch {
    return [];
  }
}

async function contaTavoli(ambito: Ambito): Promise<number> {
  return (await tavoliDiSala(ambito)).length;
}

/** Il servizio della sala, adesso. */
export interface StatoServizio {
  aperto: boolean;
  /** Chiuso: a che ora riapre OGGI. `null` = per oggi e' finita. */
  riapre: string | null;
}

/**
 * LA SALA E' APERTA ADESSO? — per la pagina del QR, prima di mostrare il menu.
 *
 * ⚠️ STESSI TRE PASSI, NELLO STESSO ORDINE, di `/api/table-session` e di
 * `/api/checkout`: il fuso della sede, gli orari effettivi di oggi (giorni
 * speciali compresi), `servizioInCorso`. Se la pagina rispondesse con un
 * altro calcolo, prima o poi direbbe «aperto» e poi rifiuterebbe l'ordine
 * al momento di pagare — dopo che il cliente ha composto la cena.
 *
 * ⚠️ Sta nel MOTORE e non nella pagina: `table.astro` e' del cliente
 * (`merge=ours`), e una regola scritta li' dentro non si aggiornerebbe piu'.
 *
 * ⚠️ Orari illeggibili → CHIUSO, come fanno le due rotte: meglio un modale
 * che dice «chiuso» di un menu che poi rifiuta di prendere i soldi.
 */
export async function statoServizioSala(ambito: Ambito): Promise<StatoServizio> {
  try {
    const ora = DateTime.now().setZone(await fusoDi(ambito));
    const cfg = await configGiornoEffettiva(ora, ambito);
    const hhmm = ora.toFormat("HH:mm");
    if (servizioInCorso(cfg, hhmm)) return { aperto: true, riapre: null };
    return { aperto: false, riapre: prossimaApertura(cfg, hhmm) };
  } catch {
    return { aperto: false, riapre: null };
  }
}
