/**
 * COME SI PAGA UN ORDINE — le regole pure, nessun import.
 *
 * Fino al 29/09/2026 il motore sapeva fare una cosa sola: si ordina e si paga
 * con la carta, subito, attraverso Stripe. Funziona per chi ce l'ha, e taglia
 * fuori chi non lo vuole — e ci sono ristoranti che vogliono gli ordini online
 * ma incassare in cassa, come hanno sempre fatto.
 *
 * Tre interruttori, e nessuno di loro e' una preferenza estetica:
 *
 *   `orders_pay_online`  — si puo' pagare con la carta al momento dell'ordine.
 *   `orders_pay_onsite`  — si puo' ordinare e pagare al ritiro.
 *   `orders_coupons`     — il campo «codice sconto» esiste.
 *   `orders_coupons_onsite` — e vale anche per chi paga in cassa.
 *
 * ⚠️ L'ULTIMO NON E' UN DETTAGLIO DEL PENULTIMO. Con Stripe lo sconto lo
 * applica il sistema all'incasso e nessuno puo' sbagliarsi. In cassa lo deve
 * applicare una persona, leggendo la comanda, mentre c'e' fila: se il
 * ristoratore non lo vuole, il campo del codice sparisce appena il cliente
 * sceglie di pagare al ritiro. Spento di ripiego, perche' promettere uno
 * sconto che alla cassa nessuno sa di dover fare e' peggio che non offrirlo.
 *
 * ⚠️ SONO CHIAVI DI SEDE. Su un gruppo con piu' punti, uno puo' accettare i
 * contanti e un altro no; uno puo' avere il conto Stripe e un altro non
 * ancora. A livello di marchio sarebbero una regola sola per tutti, e il
 * giorno che i punti non sono d'accordo si riscrive tutto — e' la stessa
 * forma di ogni guasto multi-sede che abbiamo pagato.
 *
 * ⚠️ IL RIPIEGO E' IL COMPORTAMENTO DI OGGI. Chiave assente = pagamento online
 * acceso, pagamento al locale spento, coupon accesi: cioe' esattamente come si
 * comportano i cinque clienti attuali, che non hanno nessuna di queste righe
 * nel database. Una funzione nuova non cambia sotto i piedi a chi non l'ha
 * chiesta.
 *
 * ⚠️ VOLERE NON E' POTERE. `online` qui dice che il ristoratore lo vuole
 * offrire; se poi il conto Stripe non e' configurato, non si puo' offrire lo
 * stesso. Le due cose si incrociano in `modiDiPagamento()`, e il sito
 * pubblico deve chiedere QUELLA, non questa.
 */
/**
 * ⚠️ PERCHE' QUESTO FILE ESISTE, SEPARATO DA `ordiniOpzioni.ts`.
 *
 * Le due funzioni che leggono il database stanno di la'. Qui ci sono solo
 * regole: quali chiavi esistono, e come si legge un interruttore.
 *
 * ⚠️ Non e' ordine, e' TESTABILITA'. `admin/sede.ts` importa `db.ts`, che
 * LANCIA all'import se mancano SUPABASE_URL e SUPABASE_SERVICE_KEY — e in
 * vitest mancano. Un file di prova che importi (anche indirettamente) quel
 * modulo non parte affatto, e vitest lo segnala come «0 test», non come un
 * errore: verde a colpo d'occhio, e nessuno si accorge che la rete non c'e'.
 * E' successo davvero con `slots.test.ts`, SEDICI prove ferme per mesi
 * (ENGINE.md, «Un modulo che lancia all'import non e' testabile»). Ed e'
 * successo di nuovo qui, il 29/09/2026, mezz'ora dopo aver scritto la rete.
 */

export interface OpzioniOrdini {
  /** Il ristoratore VUOLE il pagamento con carta. */
  online: boolean;
  /** Si puo' ordinare e pagare al ritiro. */
  locale: boolean;
  /** Il campo «codice sconto» esiste. */
  coupon: boolean;
  /** ...e vale anche per chi paga in cassa. */
  couponInCassa: boolean;
  /** Si puo' ordinare dal tavolo col QR. */
  tavolo: boolean;
  /** La campanella «Appeler le serveur» sulla pagina del tavolo. */
  chiamata: boolean;
  /** Si puo' scegliere la consegna a domicilio (accanto al ritiro, che resta). */
  consegna: boolean;
  /** Le mance al momento di pagare online (tutti gli ordini). */
  mance: boolean;
  /** Col piano della sala, il cliente sceglie il suo tavolo. Spento: da' solo
   *  il nome, come in una sala senza piano. */
  sceltaTavolo: boolean;
  /** «Ouvrir un compte»: si ordina dal tavolo e si paga alla fine. */
  conto: boolean;
  /**
   * Cosa ha scelto il ristoratore sull’avviso «c’e’ pronto», GREZZO: "1",
   * "0", o vuoto = non ha scelto.
   *
   * ⚠️ Non e’ un `boolean` perche’ i tre stati sono tre cose diverse, e il
   * terzo serve: «non ho scelto» si decide guardando se la sala ha dei
   * tavoli, e questo file non puo’ interrogare il database. La traduzione in
   * sì/no la fa `avvisaIlCliente`.
   */
  avvisoScelto: string;
}

/** Le chiavi, con il valore che vale quando la riga non c'e'. */
export const RIPIEGO_ORDINI: Record<string, "1" | "0"> = {
  orders_pay_online: "1",
  orders_pay_onsite: "0",
  orders_coupons: "1",
  orders_coupons_onsite: "0",
  /* ⚠️ SPENTO di ripiego, e non per prudenza generica: un ristorante che fa
     solo asporto non ha tavoli, e una pagina «ordina dal tavolo» accesa da
     sola gli darebbe un QR che porta a un modulo senza senso. Lo accende chi
     ha una sala. */
  orders_table: "0",
  /* ⚠️ SPENTO di ripiego anche questo: la campanella fa suonare un tablet, e
     chi non ha nessuno che lo guardi riceverebbe chiamate che nessuno sente
     — un cliente che aspetta e non vede arrivare nessuno. Serve anche la
     migrazione #83: accenderlo e' il momento in cui la si controlla. */
  orders_table_call: "0",
  /* ⚠️ SPENTA di ripiego: la consegna vuol dire qualcuno che esce col
     sacchetto. Accesa da sola, un ristorante senza fattorino si troverebbe
     ordini da portare a casa di gente che aspetta. Serve anche la #84. */
  orders_delivery: "0",
  /* ⚠️ SPENTE di ripiego: chiedere una mancia e' una scelta di tono del
     ristorante, e comparire da sola nel checkout di nove siti sarebbe
     l'ultima cosa che un ristoratore si aspetta. Serve anche la #86. */
  orders_tips: "0",
  /* ⚠️ ACCESO di ripiego: e' il comportamento di oggi — dove il piano ha dei
     tavoli, il cliente sceglie il suo. Il ristoratore che non lo vuole (i
     tavoli li assegna lui, o il cliente si sposta) lo spegne. */
  orders_table_choose: "1",
  /* ⚠️ SPENTO di ripiego: il conto aperto vuol dire la cucina che cucina
     PRIMA di essere pagata, e un cameriere che valida il primo invio di ogni
     tavolo. E' una scelta di servizio, non si accende da sola. Serve anche la
     #87 (conto-aperto.md). */
  orders_table_tab: "0",
};

/**
 * Chiavi a TRE stati: "1", "0", oppure vuota = «il ristoratore non ha
 * scelto», e chi legge decide con una regola sua.
 *
 * ⚠️ STANNO A PARTE da `RIPIEGO_ORDINI`, e non e’ pedanteria: `acceso()`
 * sa leggere solo due stati, e su una chiave come questa renderebbe `false`
 * — cioe’ «non avvisare» — in silenzio, che e’ esattamente il danno da
 * evitare: un cliente che aspetta al banco senza sapere niente. Tenute in un
 * elenco diverso, chiamare `acceso()` su una di loro non compila nemmeno per
 * sbaglio: non c’e’ nessun ripiego "1"/"0" da trovare.
 */
export const RIPIEGO_ORDINI_SCELTA: Record<string, ""> = {
  orders_table_notify: "",
  /* LE MANCE AL TAVOLO: vuota = come le mance di tutto il punto
     (`orders_tips`, Réglages › Paiements). E' il comportamento di prima: un
     ristorante che le aveva accese le aveva anche in sala, e nessun merge
     deve spegnergliele. "1"/"0" = una scelta della sala, che vince. Vedi
     `manceInSala`. */
  orders_table_tips: "",
};

/**
 * Si chiede la mancia AL TAVOLO? La chiave della sala, se il ristoratore l'ha
 * scelta; altrimenti quella di tutto il punto.
 *
 * ⚠️ Non `acceso(valore, "orders_table_tips")`: renderebbe `false` su una
 * chiave mai scritta, e le mance sparirebbero dalla sala di chi le aveva.
 */
export function manceInSala(valore: unknown, globale: boolean): boolean {
  const v = String(valore ?? "").trim();
  if (v === "1") return true;
  if (v === "0") return false;
  return globale;
}

export const CHIAVI_ORDINI = [
  ...Object.keys(RIPIEGO_ORDINI),
  ...Object.keys(RIPIEGO_ORDINI_SCELTA),
];

/**
 * COME SI PAGA AL TAVOLO (deciso con Enzo il 18/10/2026): MAI «sur place» a
 * ogni giro. Al tavolo si paga con la carta ordinando, oppure col conto
 * aperto (anche da soli: «Payer sur place» e' il conto). «Payer au retrait»
 * di Paiements vale solo per l'asporto.
 * ⚠️ Senza carta e senza conto, al tavolo non si puo' ordinare: `nessuno`.
 */
export function pagamentoAlTavolo<T extends { online: boolean; locale: boolean; nessuno: boolean }>(m: T, conto: boolean): T {
  return { ...m, locale: false, nessuno: !m.online && !conto };
}

/** Un valore di `app_config` letto come interruttore, col suo ripiego. */
export function acceso(valore: unknown, chiave: string): boolean {
  const v = String(valore ?? "").trim();
  if (v !== "1" && v !== "0") return RIPIEGO_ORDINI[chiave] === "1";
  return v === "1";
}

/* ───────── Come sono entrati i soldi ─────────
 *
 * ⚠️ La domanda non e' «l'ordine e' pagato?» ma «chi ha preso i soldi?».
 * Se li ha presi una persona al banco, non c'e' nessun incasso Stripe da
 * toccare: niente link per il supplemento dopo una modifica, niente rimborso
 * online, e l'email di annullo deve dire «passa in cassa», non «ti
 * rimborsiamo».
 *
 * `onsite` sta QUI insieme a `cash` e `card`: e' l'ordine preso dal sito e
 * pagato al ritiro. Finche' non lo si incassa resta `pending`; una volta
 * incassato e' denaro di cassa come gli altri due. Prima mancava da questa
 * lista, e un ordine incassato in contanti e poi modificato al rialzo mandava
 * al cliente un link Stripe per pagare la differenza di una cena gia' saldata.
 *
 * I metodi che NON sono qui — `link` e l'ordine del sito pagato con la carta,
 * che non scrive nessun metodo — sono passati da Stripe. */
export const METODI_IN_CASSA = ["cash", "card", "onsite"];

/** I soldi li ha presi (o li prendera') una persona al banco? */
export function inCassa(metodo: unknown): boolean {
  return METODI_IN_CASSA.includes(String(metodo ?? ""));
}

/** I due modi di incassare al banco: gli unici che lo staff puo' scegliere
 *  a mano su un ordine che esiste gia'. `link` non c'e' — mandare un link di
 *  pagamento e' un altro gesto, e `onsite` nemmeno: e' lo stato di partenza,
 *  non una scelta. */
export const METODI_CASSA_SCELTA = ["cash", "card"];

/** Si puo' cambiare il metodo di questo ordine?
 *
 * ⚠️ No su un ordine passato da Stripe: il metodo e' la prova di dove sono i
 * soldi. Cambiarlo in «contanti» farebbe sparire dal pannello il rimborso di
 * un incasso che esiste davvero sul conto. */
export function metodoCambiabile(metodo: unknown): boolean {
  return inCassa(metodo);
}

/* ==========================================================================
   QUANDO SI AVVISA IL CLIENTE CHE E' PRONTO
   --------------------------------------------------------------------------
   ⚠️ «Terminée» vuol dire due cose diverse a due ore diverse. Premuto
   all'ora del ritiro significa «e' pronto, vieni a prenderlo». Premuto a fine
   serata su un ordine delle 19:45 significa «il cliente e' passato da un
   pezzo e nessuno aveva cambiato lo stato»: mandargli un'email che dice che
   e' pronto, con il sacchetto gia' a casa sua, e' peggio del silenzio.

   La riga si taglia MEZZ'ORA DOPO l'ora di ritiro. Prima no: se la cucina
   finisce in anticipo e lo dice, e' una buona notizia.

   ⚠️ E vale solo per chi PREME. Il cron che chiude gli ordini rimasti aperti
   (`api/cron/auto-complete-orders`) non passa di qui e non deve: un'email
   partita da sola alle tre di notte non la spiega nessuno.
   ========================================================================== */

/** La mezz'ora, in un posto solo. */
export const FINESTRA_PRONTO_MIN = 30;

/**
 * Si avvisa il cliente che l'ordine e' pronto?
 * @param pickupIso l'ora di ritiro dell'ordine
 * @param adessoMs  l'istante in cui si preme (parametro apposta: una regola
 *                  che legge l'orologio da sola non si puo' provare)
 */
/**
 * AVVISIAMO IL CLIENTE QUANDO E’ PRONTO?
 *
 * Tre stati, e il terzo e’ quello che fa il lavoro:
 *   "1" → sì, "0" → no, vuoto → lo decide la sala.
 *
 * ⚠️ IL RIPIEGO GUARDA I TAVOLI, e non e’ un indovinello: due locali con gli
 * STESSI dati vogliono il contrario l’uno dell’altro — il bistrot senza
 * numeri sui tavoli ha il cameriere e l’email non la vuole, lo snack al banco
 * non ha nessuno che porti e l’email e’ l’unico modo di dirlo. Per questo
 * l’interruttore esiste. Ma finche’ nessuno lo tocca, il ripiego sbaglia
 * nella direzione meno costosa: dove NON ci sono tavoli si avvisa, perche’ il
 * danno di non avvisare chi aspetta al banco e’ peggiore del fastidio di
 * un’email in piu’ a chi e’ servito al tavolo.
 *
 * @param valore  il valore grezzo di `orders_table_notify`
 * @param ciSonoTavoli  la sala ha almeno un tavolo in `restaurant_tables`
 */
export function avvisaIlCliente(valore: unknown, ciSonoTavoli: boolean): boolean {
  const v = String(valore ?? "").trim();
  if (v === "1") return true;
  if (v === "0") return false;
  return !ciSonoTavoli;
}

export function avvisaChePronto(
  pickupIso: unknown,
  adessoMs: number = Date.now(),
  servizio: unknown = "pickup",
  avvisaInSala: boolean = false,
): boolean {
  /* ⚠️ A CHI E' SEDUTO A TRE METRI NON SI MANDA UN'EMAIL. «Votre commande est
     prete» ha senso per chi deve mettersi in macchina; per un tavolo il
     piatto arriva in mano, e l'email diventa rumore — o peggio, arriva dopo
     che il cameriere ha gia' servito. Il ripiego e' `pickup` perche' le righe
     scritte prima della migrazione #82 non hanno il servizio. */
  /* ⚠️ «In sala» non vuol dire piu’ «qualcuno ti porta il piatto». Un
     chiosco o uno snack prende gli ordini dal QR e poi CHIAMA al banco: li’
     l’email e’ l’unico modo di dire che e’ pronto, e tacere vorrebbe dire un
     cliente che fissa il bancone. Chi invece ha i camerieri resta col
     silenzio di prima. */
  if (alTavolo(servizio) && !avvisaInSala) return false;
  /* ⚠️ ALLA CONSEGNA NIENTE «VENEZ LA CHERCHER». Il cliente aspetta a casa:
     dirgli che il piatto e' pronto al banco lo farebbe uscire per niente, e
     incrociare il fattorino per strada. */
  if (aConsegna(servizio)) return false;
  const t = new Date(String(pickupIso ?? "")).getTime();
  // ⚠️ Una data illeggibile non e' «adesso»: senza questa riga `NaN` farebbe
  // fallire il confronto e l'email partirebbe sempre, anche a mezzanotte.
  if (!Number.isFinite(t)) return false;
  return adessoMs <= t + FINESTRA_PRONTO_MIN * 60_000;
}

/** I ritardi che il pannello propone. ⚠️ Un elenco chiuso, non un campo
 *  libero: a mezzanotte, con la cucina piena, si preme un bottone — non si
 *  scrive un numero. E il server rifiuta tutto il resto. */
export const RITARDI_MIN = [5, 10, 15, 20] as const;

export function ritardoAmmesso(min: unknown): boolean {
  return (RITARDI_MIN as readonly number[]).includes(Math.round(Number(min)));
}

/* ==========================================================================
   DA ASPORTO O AL TAVOLO
   --------------------------------------------------------------------------
   ⚠️ Nasce perche' `pickup_time` non basta piu'. Un ordine al tavolo non ha
   un'ora di ritiro, ma quella colonna la legge mezzo motore — e il semaforo
   dei ritardatari diventa ROSSO un quarto d'ora dopo l'ora di ritiro. Senza
   una colonna che dica di che servizio si tratta, ogni tavolo sarebbe in
   ritardo mentre la gente mangia.
   ========================================================================== */

export type Servizio = "pickup" | "table" | "delivery";

/**
 * Di che servizio e' questo ordine.
 * ⚠️ Il ripiego e' `pickup` e non e' una scelta estetica: in un database vivo
 * ci sono tutte le righe scritte PRIMA della migrazione #82, che non hanno la
 * colonna. Erano tutte da asporto, e devono continuare a comportarsi come
 * prima — ticket con l'ora, semaforo dei ritardi, email di ritiro.
 */
export function servizioDi(valore: unknown): Servizio {
  const v = String(valore ?? "");
  return v === "table" || v === "delivery" ? v : "pickup";
}

/** Scorciatoia per chi deve solo sapere «va portato a casa?». */
export function aConsegna(valore: unknown): boolean {
  return servizioDi(valore) === "delivery";
}

/** Scorciatoia per chi deve solo sapere «e' uno in sala?». */
export function alTavolo(valore: unknown): boolean {
  return servizioDi(valore) === "table";
}

/* ───────── Come si paga in sala ─────────
 *
 * ⚠️ DUE MODI, UNO SOLO COSTRUITO, e la differenza non e' un'impostazione
 * dello stesso flusso: sono due prodotti.
 *
 *   `per_giro` — ogni giro e' un ordine suo: paga, ticket, ricevuta. Riusa
 *                tutta la catena che esiste (checkout -> webhook ->
 *                confermaOrdine -> ticket).
 *   `conto`    — i giri si accumulano e si paga alla fine. Vuole lo stato del
 *                tavolo, il conto unico, e cosa fare con chi se ne va senza
 *                pagare. Ma soprattutto vuole che LA CUCINA CUOCIA PRIMA DI
 *                ESSERE PAGATA: oggi `daStampare` rifiuta di stampare
 *                qualsiasi cosa non pagata tranne il `pending + onsite`, e il
 *                motivo e' scritto qui sopra — cibo preparato per nessuno.
 *                E' una decisione di fiducia del ristoratore, non una riga.
 *
 * Il secondo valore esiste nel tipo perche' il giorno in cui si costruisce non
 * si debba rinominare niente; il pannello ne mostra UNO. Un interruttore che
 * promette una cosa non costruita e' peggio di un'opzione assente.
 */
export type ModoServizio = "per_giro" | "conto";

export function modoServizio(): ModoServizio {
  return "per_giro";
}

/* ==========================================================================
   SI PUO' ORDINARE DAL TAVOLO ADESSO?
   --------------------------------------------------------------------------
   ⚠️ Serve perche' il QR e' un pezzo di carta che resta sul tavolo ANCHE
   QUANDO IL LOCALE E' CHIUSO, e il QR generico (quello senza il numero
   stampato sopra) si puo' inquadrare da una foto, da casa, alle tre di notte.
   Senza questa porta, qualcuno ordinerebbe «al tavolo 7» mentre la cucina e'
   spenta: un incasso vero, un ticket che non esce, e nessuno che se ne
   accorge fino al mattino.

   ⚠️ FUNZIONE PURA, e l'ora si passa. Una regola che legge l'orologio da sola
   non si puo' provare, e questa va provata proprio sui bordi — l'apertura,
   la chiusura, e la cena che finisce dopo mezzanotte.
   ========================================================================== */

/** Quel poco della configurazione del giorno che serve a questa domanda. */
export interface OrariDelGiorno {
  lunch_active?: boolean | null;
  lunch_open?: string | null;
  lunch_close?: string | null;
  dinner_active?: boolean | null;
  dinner_open?: string | null;
  dinner_close?: string | null;
}

/** "HH:MM" → minuti dalla mezzanotte. Un'ora illeggibile rende `null`, che
 *  chi chiama tratta come «non lo so», mai come «mezzanotte». */
function minuti(hhmm: unknown): number | null {
  /* ⚠️ I SECONDI SONO FACOLTATIVI, e non e' una gentilezza: `lunch_open` e
     compagni sono colonne `time` di Postgres e tornano «12:00:00». Con
     l'ancora stretta `^\d{1,2}:\d{2}$` quella stringa non passava, `minuti`
     rendeva null, `dentro()` rispondeva sempre falso e `servizioInCorso`
     diceva CHIUSO a qualunque ora, in qualunque ristorante aperto. Dal
     16/10/2026, visto su un QR al tavolo: «Le service est fermé» alle 13:40
     di un venerdi' di servizio.
     ⚠️ I test non l'avevano visto perche' scrivevo io i finti orari, e li
     scrivevo «12:00» — cioe' chiedevo alla prova di confermare la mia idea
     del dato invece del dato. Il resto del motore lo sapeva gia': ovunque si
     confrontino orari c'e' uno `.slice(0, 5)` prima. */
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * Il servizio in corso a quell'ora, o `null` se e' chiuso.
 * @returns "midi" | "soir" | null — la stessa `service_key` delle prenotazioni.
 */
export function servizioInCorso(cfg: OrariDelGiorno | null | undefined, hhmm: string): "midi" | "soir" | null {
  const ora = minuti(hhmm);
  if (ora === null || !cfg) return null;

  const dentro = (apre: unknown, chiude: unknown): boolean => {
    const a = minuti(apre);
    const c = minuti(chiude);
    if (a === null || c === null) return false;
    /* ⚠️ LA CENA FINISCE DOPO MEZZANOTTE. «19:00 – 01:00» non e' un intervallo
       crescente: con un confronto normale sarebbe sempre falso, e alle 23:30
       il locale risulterebbe chiuso mentre la sala e' piena. Quando l'ora di
       chiusura e' PRIMA di quella di apertura, l'intervallo scavalca la
       mezzanotte e si guarda da tutte e due le parti. */
    return c >= a ? ora >= a && ora < c : ora >= a || ora < c;
  };

  if (cfg.dinner_active !== false && dentro(cfg.dinner_open, cfg.dinner_close)) return "soir";
  if (cfg.lunch_active !== false && dentro(cfg.lunch_open, cfg.lunch_close)) return "midi";
  return null;
}

/**
 * A CHE ORA RIAPRE OGGI, se riapre. `null` = per oggi e' finita (o non si sa).
 *
 * ⚠️ Serve a dire al cliente QUANDO, non solo «chiuso». «Fermé pour le
 * moment» davanti a un QR alle 15:00 si legge «non funziona»; «on rouvre à
 * 17:00» si legge «torno dopo». E' la differenza fra un cliente perso e uno
 * che aspetta un'ora.
 *
 * ⚠️ Solo OGGI, e di proposito: dire «riapre martedi'» a chi e' gia' seduto
 * al tavolo non e' un'informazione, e il giorno dopo il locale puo' aver
 * cambiato orari. Una fascia con un'ora illeggibile non conta — meglio non
 * promettere un orario che inventarlo.
 */
export function prossimaApertura(cfg: OrariDelGiorno | null | undefined, hhmm: string): string | null {
  const ora = minuti(hhmm);
  if (ora === null || !cfg) return null;
  const aperture: number[] = [];
  const fascia = (attiva: boolean | null | undefined, apre: unknown, chiude: unknown) => {
    if (attiva === false) return;
    const a = minuti(apre);
    if (a === null || minuti(chiude) === null) return;
    if (a > ora) aperture.push(a);
  };
  fascia(cfg.lunch_active, cfg.lunch_open, cfg.lunch_close);
  fascia(cfg.dinner_active, cfg.dinner_open, cfg.dinner_close);
  if (aperture.length === 0) return null;
  const m = Math.min(...aperture);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
