import type { APIRoute } from "astro";
// Multi-sede: l'ordine nasce in un PUNTO. Segnaposto fino al pezzo 8.
import { leggi, inserisci, aggiorna } from "../../lib/admin/sede";
import { normalizzaNome } from "../../lib/normalizzaNome";
import { DateTime } from "luxon";
import { supabaseAdmin, conRipiegoColonne, type RisultatoQuery } from "../../lib/db";
import { creaCheckoutSession, type VoceCheckout } from "../../lib/stripe";
import { calcolaSlotGiorno } from "../../lib/slots";
import { fusoDi } from "../../lib/fuso";
import { configGiornoEffettiva } from "../../lib/schedule";
// Multi-sede: quale punto sta guardando il sito pubblico (segnaposto, pezzo 8).
import { ambitoPubblicoChiesto } from "../../lib/admin/sede";
import { sedeDettaDa, PARAM_SEDE } from "../../lib/admin/sedeRegole";
import { appConfigEq } from "../../lib/appConfigCache";
import { basePubblicaOpz } from "../../lib/basePubblica";
import { modiDiPagamento, opzioniTavolo, type OpzioniTavolo } from "../../lib/ordiniOpzioni";
import { servizioDi, alTavolo, servizioInCorso } from "../../lib/ordiniRegole";
import { annunciaOrdine, type RigaAnnuncio } from "../../lib/confermaOrdine";
import { accodaTicket } from "../../lib/stampaCoda";
import { prezzoEffettivo, haVarianti, trovaVariante, etichettaVariante } from "../../lib/pricing";
import { applicaStatoSede } from "../../lib/menuStato";
import {
  calcolaScontoCoupon,
  verificaLimitiUso,
  testiCoupon,
  normalizzaCodice,
  type CouponRow,
  type LineaCoupon,
} from "../../lib/coupons";

export const prerender = false;

type Supplemento = "none" | "gluten-free" | "ricotta";

const SUPPL: Record<Supplemento, number> = {
  none: 0,
  "gluten-free": 400,
  ricotta: 300,
};
const SUPPL_LABEL: Record<Supplemento, string> = {
  none: "",
  "gluten-free": "Sans gluten",
  ricotta: "Croûte ricotta",
};

interface CheckoutRequest {
  items: { id: string; qty: number; supplement?: Supplemento; variant?: string }[];
  slot: string;
  note?: string;
  coupon?: string;
  /** Come vuole pagare, quando il punto offre entrambe le strade. */
  pay?: "online" | "onsite";
  customer: {
    name: string;
    /** ⚠️ Facoltativi perche' AL TAVOLO non si chiedono: cognome e telefono a
     *  chi e' seduto a tre metri sono attrito per un dato che non serve, e
     *  l'email e' una scelta del cliente. Da asporto restano obbligatori, e
     *  lo impongono le validazioni qui sotto — non il tipo. */
    surname?: string;
    phone?: string;
    email?: string;
  };
  /** Lingua della pagina pubblica da cui arriva l'ordine (5 lingue). */
  lang?: string;
  /** Da asporto (assente) o al tavolo. Qualunque altra cosa e' da asporto. */
  service?: string;
  /** Il tavolo e la prenotazione aperta, come li ha resi `/api/table-session`.
   *  ⚠️ NON SI CREDE A NESSUNO DEI DUE: arrivano dal browser, e qui sotto si
   *  rileggono dal database. Credendoci, un ordine si potrebbe attaccare al
   *  tavolo di qualcun altro cambiando un id in una richiesta. */
  table_id?: string;
  reservation_id?: string;
}

function isPizza(categoryOrder: number): boolean {
  return categoryOrder === 2 || categoryOrder === 3;
}

export const POST: APIRoute = async ({ request }) => {
  let body: CheckoutRequest;
  try {
    body = await request.json();
  } catch {
    return err(400, "Richiesta non valida");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return err(400, "Carrello vuoto");
  }
  /* ⚠️ QUALE SERVIZIO — si decide subito, perche' cambia cosa e' obbligatorio.
     `servizioDi` e' la regola pura: tutto cio' che non e' "table" e' da
     asporto, compreso un valore mai visto. Le righe scritte prima della #82
     non hanno la colonna e restano da asporto, come sono sempre state. */
  const servizio = servizioDi(body.service);
  const aTavolo = alTavolo(servizio);

  // Il form pubblico (OrderApp) esige nome, cognome, telefono ed email: qui si
  // ricontrolla, perche' l'API e' raggiungibile anche senza passare dal form e
  // un ordine senza telefono lascia il ristoratore senza modo di richiamare.
  if (!body.customer?.name) {
    return err(400, "Dati mancanti");
  }
  if (!aTavolo) {
    if (!body.slot || !body.customer?.email) {
      return err(400, "Dati mancanti");
    }
    if (!String(body.customer.surname ?? "").trim() || !String(body.customer.phone ?? "").trim()) {
      return err(400, "Dati mancanti");
    }
  } else {
    /* ⚠️ AL TAVOLO SI CHIEDE MENO, E NON E' UNA SVISTA. Cognome, telefono e
       ora di ritiro non esistono: il cliente e' seduto a tre metri e il nome
       serve solo a chiamarlo. L'email e' FACOLTATIVA — e' l'unica prova che
       resta a chi chiude la pagina dopo aver pagato, ma pretenderla al tavolo
       perderebbe ordini. Tutte le email al cliente saltano gia' da sole
       quando manca (`if (!o.customer_email?.trim()) return`).
       Obbligatori sono invece il tavolo e la prenotazione: senza, l'incasso
       non si sa a chi portarlo. */
    /* ⚠️ Qui si pretende SOLO la sessione. Il tavolo e l'email dipendono da
       com'e' fatta questa sala — se ha dei tavoli, se qualcuno porta i piatti
       — e quelle sono due letture dal database: si controllano piu' sotto,
       appena si sa. Pretendere il tavolo qui vorrebbe dire rifiutare l'ordine
       di uno snack che di tavoli non ne ha nessuno. */
    if (!String(body.reservation_id ?? "").trim()) {
      return err(400, "Dati mancanti");
    }
  }

  // Lingua del CLIENTE: quella della pagina da cui ordina. Va salvata intera
  // sull'ordine, perche' le email al cliente esistono in 5 lingue.
  const LANG_PUBBLICHE = ["fr", "en", "it", "nl", "es"];
  const lang = LANG_PUBBLICHE.includes(String(body.lang)) ? String(body.lang) : "fr";
  // Ordini chiusi dall'admin: messaggio nella lingua del cliente.
  // ⚠️ Non e' «chiuso adesso», e' «qui non si prende nessun ordine»: il
  // ristoratore ha spento sia il pagamento con carta sia quello al locale,
  // oppure ha chiesto la carta senza avere un conto Stripe configurato.
  // Meglio dirlo che far finta di accettare un ordine che non arrivera'.
  const TXT_COUPON_SOLO_ONLINE: Record<string, string> = {
    fr: "Ce code promo n'est valable qu'en payant en ligne.",
    en: "This promo code is only valid when paying online.",
    it: "Questo codice sconto vale solo pagando online.",
    nl: "Deze kortingscode geldt alleen bij online betaling.",
    es: "Este código promocional solo es válido pagando en línea.",
  };
  const TXT_NIENTE_PAGAMENTO: Record<string, string> = {
    fr: "Les commandes en ligne ne sont pas disponibles pour le moment.",
    en: "Online ordering is not available at the moment.",
    it: "Gli ordini online non sono disponibili al momento.",
    nl: "Online bestellen is momenteel niet beschikbaar.",
    es: "Los pedidos en línea no están disponibles por el momento.",
  };
  const TXT_CHIUSO: Record<string, string> = {
    fr: "Les commandes en ligne sont momentanément fermées. Réessayez plus tard.",
    en: "Online ordering is temporarily closed. Please try again later.",
    it: "Gli ordini online sono momentaneamente chiusi. Riprova più tardi.",
    nl: "Online bestellen is tijdelijk gesloten. Probeer het later opnieuw.",
    es: "Los pedidos en línea están cerrados temporalmente. Inténtalo más tarde.",
  };

  // ⚠️ L'AMBITO SI CALCOLA PRIMA DEL CONTROLLO DI CHIUSURA.
  // Stava sotto, e la chiusura leggeva `app_config` a mano: il bottone
  // «Fermer» SCRIVE per sede (`scriviConfig(ambito)`), quindi su un gruppo il
  // valore finisce in `location_config` e qui non si vedeva mai. Una cucina
  // chiusa continuava a ricevere ordini, e il ristoratore vedeva il pulsante
  // rosso pensando di essere protetto.
  const ambitoPub = await ambitoPubblicoChiesto(request);

  // Servizio chiuso dall'admin (bottone "Fermer" nella pagina Commandes):
  // blocco anche lato server, per chi avesse la pagina già aperta.
  const { data: cfgChiusura } = await appConfigEq("orders_closed", ambitoPub);
  if (cfgChiusura?.value === "1") {
    return err(503, TXT_CHIUSO[lang] ?? TXT_CHIUSO.fr);
  }

  // ⚠️ COME SI PAGA IN QUESTO PUNTO. Non e' una preferenza: decide se qui si
  // puo' ordinare, e come. `modiDiPagamento` incrocia quello che il ristoratore
  // ha chiesto con quello che e' davvero possibile — volere il pagamento con
  // carta senza un conto Stripe configurato non lo rende possibile.
  const modi = await modiDiPagamento(ambitoPub);
  if (modi.nessuno) {
    return err(503, TXT_NIENTE_PAGAMENTO[lang] ?? TXT_NIENTE_PAGAMENTO.fr);
  }
  /* ⚠️ L'INTERRUTTORE DELLA SALA VALE ANCHE QUI, non solo in
     `/api/table-session`. Quella rotta apre il tavolo, questa prende i soldi:
     chiudere solo la prima lascerebbe aperta la seconda a chi manda la
     richiesta a mano, e un incasso «al tavolo 7» in un locale che fa solo
     asporto non lo guarderebbe nessuno. */
  /* ⚠️ Si legge SOLO per un ordine dal locale: un ordine da asporto non deve
     pagare una lettura in piu' per una sala che non lo riguarda. */
  let sala: OpzioniTavolo | null = null;
  if (aTavolo) {
    sala = await opzioniTavolo(ambitoPub);
    if (!sala.attivo) {
      return err(403, TXT_NIENTE_PAGAMENTO[lang] ?? TXT_NIENTE_PAGAMENTO.fr);
    }
    /* ⚠️ IL TAVOLO E' OBBLIGATORIO SOLO DOVE ESISTE. Con la mappa della sala
       e' l'unico dato che dice dove portare il piatto, e saltarlo renderebbe
       la comanda inutilizzabile; senza mappa non c'e' niente da chiedere, e
       pretenderlo bloccherebbe ogni ordine di quel locale. */
    if (sala.conTavoli && !String(body.table_id ?? "").trim()) {
      return err(400, "Dati mancanti");
    }
    /* ⚠️ E L'EMAIL DIVENTA OBBLIGATORIA QUANDO E' L'UNICO MODO DI AVVISARE.
       Dove nessuno porta il piatto, l'email «c'e' pronto» e' il solo canale
       verso il cliente: un ordine senza indirizzo sarebbe una persona che
       aspetta al banco senza che niente possa dirle di venire. Il modulo la
       chiede spiegando perche'; qui si ricontrolla, perche' questa rotta e'
       raggiungibile anche senza passare dal modulo. */
    if (sala.avvisa && !String(body.customer.email ?? "").trim()) {
      return err(400, "Dati mancanti");
    }
  }

  const fuso = await fusoDi(ambitoPub);
  const ora = DateTime.now().setZone(fuso);

  // Config effettiva: orari settimanali + giorni speciali (special_days).
  // Stessa fonte di /api/slots: i due DEVONO essere d'accordo.
  // La sede la dice la RICHIESTA (header `x-sede` o `?sede=`), non piu' un
  // ripiego sulla prima. Chi non la dice ricade su `ambitoPubblico()`.
  // (calcolato piu' sopra: serve gia' al controllo di chiusura)
  const config = await configGiornoEffettiva(ora, ambitoPub);
  if (!config) {
    return err(503, "Configurazione orari non disponibile");
  }

  /* ⚠️ DUE DOMANDE DIVERSE SULLO STESSO OROLOGIO.
     Da asporto: «lo slot scelto esiste ancora?» — una lista di orari.
     Al tavolo: «la cucina e' aperta ADESSO?» — perche' non c'e' nessuno slot
     da scegliere, ma il QR resta incollato al tavolo anche a locale chiuso e
     quello generico si puo' inquadrare da una foto. Senza questa porta si
     incassa con la cucina spenta: un ticket che non esce, e nessuno che se ne
     accorge fino al mattino. */
  if (aTavolo) {
    if (!servizioInCorso(config, ora.toFormat("HH:mm"))) {
      return err(409, TXT_CHIUSO[lang] ?? TXT_CHIUSO.fr);
    }
  } else {
    const { lunch, dinner } = calcolaSlotGiorno(ora, config, fuso);
    const slotValidi = [...lunch, ...dinner];
    if (!slotValidi.includes(body.slot)) {
      return err(409, "Orario di ritiro non più disponibile");
    }
  }

  const ids = body.items.map((i) => i.id);
  const CAMPI = "id, name, category, price_cents, available, category_order, discount_type, discount_value";
  // `sold_out` e `variants` mancano sui DB dove le migrazioni #55/#71 non sono
  // state lanciate: si ripiega su quelle che ci sono invece di rifiutare l'ordine.
  const { data: piatti, error: errMenu } = await conRipiegoColonne(
    CAMPI,
    async (campi) =>
      (await leggi("menu_items", ambitoPub, campi).in("id", ids)) as unknown as RisultatoQuery
  );

  if (errMenu || !piatti) {
    return err(503, "Impossibile leggere il menu");
  }

  // L'esaurito di QUESTO punto: il menu e' del gruppo, «finito» no. Senza
  // questo passaggio si incassa per un piatto che questa cucina non ha.
  const piattiPunto = await applicaStatoSede(
    piatti as unknown as Record<string, unknown>[],
    ambitoPub,
  );

  const voci: VoceCheckout[] = [];
  const itemsOrdine: {
    id: string;
    name: string;
    qty: number;
    price_cents: number;
    notes: string;
    /** Chiave del formato scelto (migrazione #71). Assente = prezzo unico. */
    variant?: string;
    /** Nome del piatto SENZA variante/supplemento: le card e le email lo
        vogliono separato per disegnare le pastiglie. `name` resta intero. */
    base_name?: string;
    /** Etichetta della variante scelta, gia' tradotta. */
    variant_label?: string;
  }[] = [];
  // Righe per il calcolo del coupon (prezzo base effettivo, senza supplementi).
  const lineeCoupon: LineaCoupon[] = [];

  for (const richiesto of body.items) {
    const piatto = piattiPunto.find((p) => p.id === richiesto.id) as any;
    if (!piatto || !piatto.available || piatto.sold_out === true) {
      return err(409, "Un piatto selezionato non è più disponibile");
    }
    const qty = Math.max(1, Math.floor(richiesto.qty));

    let supplemento: Supplemento = "none";
    const richiestoSuppl = richiesto.supplement;
    if (
      (richiestoSuppl === "gluten-free" || richiestoSuppl === "ricotta") &&
      isPizza(piatto.category_order)
    ) {
      supplemento = richiestoSuppl;
    }
    const supplCents = SUPPL[supplemento];

    // Formato scelto (pizza 30/40 cm, calice/bottiglia...). Se il piatto ha
    // formati, sceglierne uno è OBBLIGATORIO e il prezzo è quello del formato:
    // dal browser arriva solo la chiave, il prezzo lo decide il server.
    let variante = null as ReturnType<typeof trovaVariante>;
    if (haVarianti(piatto.variants, ambitoPub)) {
      variante = trovaVariante(piatto.variants, richiesto.variant, true, ambitoPub);
      if (!variante) {
        return err(409, "Le format choisi n'est plus disponible");
      }
    }
    const prezzoPieno = variante ? variante.price_cents : piatto.price_cents;

    // Prezzo base EFFETTIVO: gli sconti (fissi o %) valgono sempre online.
    const prezzoBase = prezzoEffettivo(prezzoPieno, piatto.discount_type, piatto.discount_value);
    const prezzoUnitario = prezzoBase + supplCents;

    const etichetta = variante ? etichettaVariante(variante, lang) : "";
    const nomeConFormato = etichetta ? `${piatto.name} — ${etichetta}` : piatto.name;
    const nomeRiga =
      supplemento === "none"
        ? nomeConFormato
        : `${nomeConFormato} (${SUPPL_LABEL[supplemento]})`;

    voci.push({ name: nomeRiga, price_cents: prezzoUnitario, qty });
    itemsOrdine.push({
      id: piatto.id,
      // `name` resta la stringa completa concatenata: la leggono le email, la
      // stampa e Stripe, e cambiarla romperebbe tutto quanto sta a valle.
      name: nomeRiga,
      // I PEZZI separati, per chi vuole comporli da solo (card Ordini: nome in
      // grande, variante e supplemento come pastiglie sotto). Senza questi
      // l'unico modo sarebbe spezzare `name` sul trattino lungo — e si romperebbe
      // col primo piatto che ha un trattino nel nome.
      base_name: piatto.name,
      ...(etichetta ? { variant_label: etichetta } : {}),
      qty,
      price_cents: prezzoUnitario,
      notes: supplemento === "none" ? "" : SUPPL_LABEL[supplemento],
      ...(variante ? { variant: variante.key } : {}),
    });
    lineeCoupon.push({
      price_cents: prezzoBase,
      is_promo: prezzoBase < prezzoPieno,
      category: piatto.category,
      qty,
    });
  }

  // Nota libera dell'ordine: la aggiungo come voce speciale in items (qty 0, prezzo 0),
  // così appare nelle notifiche cucina senza modificare il totale né lo schema.
  const noteText = (body.note ?? "").trim().slice(0, 500);
  if (noteText) {
    itemsOrdine.push({
      id: "note",
      name: "NOTE CLIENT",
      qty: 0,
      price_cents: 0,
      notes: noteText,
    });
  }

  const totalCents = itemsOrdine.reduce((s, i) => s + i.price_cents * i.qty, 0);

  // ⚠️ QUALE DELLE DUE STRADE — si decide QUI, prima del coupon, perche' il
  // coupon puo' non valere in cassa. Se il cliente ha chiesto `pay: "onsite"`
  // (e il locale lo offre) si paga al ritiro; altrimenti vince la carta quando
  // e' possibile. Con un solo modo acceso non c'e' niente da scegliere e il
  // sito non deve chiedere nulla.
  const inCassa = modi.locale && (!modi.online || body.pay === "onsite");

  // ---- Code promo: validazione + sconto REALE, ricalcolato lato server ----
  // Non ci si fida mai dell'importo mandato dal browser: si rilegge il coupon
  // dal DB e si ricalcola. Se non è (più) valido si rifiuta, così il cliente
  // può togliere il codice e riprovare.
  let couponId: string | null = null;
  let couponCodeSalvato: string | null = null;
  let scontoCents = 0;
  // ⚠️ Il codice si legge solo se il ristoratore tiene i coupon accesi, E se
  // valgono per la strada scelta. Non basta nascondere il campo nel sito: chi
  // manda la richiesta a mano aggirerebbe l'interruttore, e uno sconto non
  // voluto e' denaro vero.
  const couponAmmesso = modi.coupon && (!inCassa || modi.couponInCassa);
  const codeInput = couponAmmesso ? normalizzaCodice(body.coupon ?? "") : "";

  // ⚠️ E se un codice C'ERA, non lo si butta in silenzio: il cliente ha visto
  // uno sconto sullo schermo e si aspetta quel totale. Meglio fermarsi e
  // dirglielo, cosi' puo' scegliere di pagare con la carta o di togliere il
  // codice — invece di scoprire alla cassa che paga di piu'.
  if (!couponAmmesso && normalizzaCodice(body.coupon ?? "")) {
    return err(409, TXT_COUPON_SOLO_ONLINE[lang] ?? TXT_COUPON_SOLO_ONLINE.fr);
  }
  if (codeInput) {
    const { data: coupon } = await supabaseAdmin
      .from("coupons")
      .select("*")
      .eq("code_norm", codeInput)
      .maybeSingle();
    if (!coupon) {
      return err(409, testiCoupon(lang).nonValido);
    }
    // L'ambito e' quello che il cliente ha scelto sul sito: un codice
    // riservato a un punto vale li' e basta.
    const ris = calcolaScontoCoupon(coupon as CouponRow, lineeCoupon, ora, ambitoPub, lang);
    if (ris.error) return err(409, ris.error);
    const limite = await verificaLimitiUso(coupon as CouponRow, body.customer.email ?? "", supabaseAdmin, lang);
    if (limite) return err(409, limite);
    scontoCents = Math.min(ris.discount_cents, totalCents);
    couponId = (coupon as CouponRow).id;
    couponCodeSalvato = (coupon as CouponRow).code;
  }

  const totaleIncassato = Math.max(0, totalCents - scontoCents);

  /* ⚠️ AL TAVOLO `pickup_time` E' L'ISTANTE IN CUI L'ORDINE ENTRA, non `null`.
     Sembrerebbe piu' pulito lasciarla vuota — al tavolo non si ritira niente
     — e sarebbe il difetto peggiore di tutti: la lista Commandes filtra con
     `.gte("pickup_time", ...)` e ordina su quella colonna, e in Postgres un
     `null` non passa nessun confronto. L'ordine del tavolo 7 semplicemente
     NON comparirebbe in cucina. Con l'ora d'arrivo, invece, tutto cio' che
     legge quella colonna (lista, statistiche, affluenza, cron) continua a
     funzionare senza sapere niente di nuovo.
     ⚠️ E' `service`, non un buco nella colonna, che fa tacere il semaforo dei
     ritardatari: vedi la #82 e `ncLivelloRitardo`. */
  let pickup = ora;
  if (!aTavolo) {
    const [h, m] = body.slot.split(":").map((n) => parseInt(n, 10));
    pickup = ora.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  }

  /* ⚠️ IL TAVOLO E LA PRENOTAZIONE SI RILEGGONO DAL DATABASE. Dal browser
     arrivano due id, e due id si cambiano. Si pretende che la prenotazione sia
     di OGGI, ancora `seated`, e che quel tavolo sia davvero fra i suoi: senza,
     un ordine si attaccherebbe al tavolo di qualcun altro, o alla cena di
     ieri. E il NOME del tavolo lo scrive il server — quello che il cliente
     dice di avere non conta. */
  let tavoloId: string | null = null;
  let tavoloNome = "";
  if (aTavolo) {
    const { data: resaRaw } = await leggi("reservations", ambitoPub, "id, date, status, tables")
      .eq("id", String(body.reservation_id))
      .maybeSingle();
    const resa = resaRaw as unknown as
      | { id: string; date: string; status: string; tables: string[] | null }
      | null;
    if (!resa || resa.status !== "seated" || resa.date !== ora.toFormat("yyyy-MM-dd")) {
      return err(409, TXT_CHIUSO[lang] ?? TXT_CHIUSO.fr);
    }
    const chiesto = String(body.table_id ?? "").trim();
    if (chiesto) {
      /* ⚠️ Il tavolo deve essere fra quelli di QUELLA sessione. Senza questo
         confronto basterebbe cambiare un id nella richiesta per far comparire
         l'ordine su un altro tavolo — e i piatti partirebbero per il posto
         sbagliato. */
      if (!Array.isArray(resa.tables) || !resa.tables.includes(chiesto)) {
        return err(409, TXT_CHIUSO[lang] ?? TXT_CHIUSO.fr);
      }
      const { data: tavRaw } = await leggi("restaurant_tables", ambitoPub, "id, name")
        .eq("id", chiesto)
        .maybeSingle();
      const tav = tavRaw as unknown as { id: string; name: string } | null;
      if (!tav) return err(409, TXT_CHIUSO[lang] ?? TXT_CHIUSO.fr);
      tavoloId = tav.id;
      tavoloNome = String(tav.name ?? "");
    }
  }

  // Le colonne coupon_* si scrivono SOLO se un coupon è stato applicato: così
  // gli ordini normali funzionano anche se la migration 014_coupons.sql non è
  // ancora stata lanciata su Supabase.
  const datiOrdine: Record<string, unknown> = {
    // ⚠️ `pending` ANCHE per l'ordine in cassa, e non e' un limbo: quell'ordine
    // NON e' pagato, e dire `paid` sarebbe scrivere una cifra incassata che
    // non e' entrata. Diventa `paid` quando qualcuno incassa davvero.
    status: "pending",
    // ⚠️ E' QUESTO che distingue un ordine da incassare da un carrello
    // abbandonato: due righe `pending` identiche in tutto il resto. Il
    // pannello mostra i primi e ignora i secondi, e il recupero da Stripe
    // salta i primi perche' non hanno nessuna sessione da verificare.
    ...(inCassa ? { payment_method: "onsite" } : {}),
    pickup_time: pickup.toISO(),
    /* ⚠️ Le quattro colonne della #82 si scrivono SOLO al tavolo. Un ordine da
       asporto non le porta affatto: `service` ha `default 'pickup'` in SQL, e
       cosi' i nove clienti di oggi — compreso chi non ha ancora passato la
       migrazione — continuano a inserire esattamente le colonne di prima.
       ⚠️ E al tavolo NON c'e' ripiego: se la #82 manca, l'inserimento fallisce
       e il cliente non paga. Un ripiego che togliesse queste colonne
       incasserebbe i soldi e perderebbe il numero del tavolo — una comanda
       senza destinazione, cioe' il contrario di un ordine. */
    ...(aTavolo
      ? {
          service: "table",
          table_id: tavoloId,
          table_label: tavoloNome,
          reservation_id: String(body.reservation_id),
        }
      : {}),
    customer_name: normalizzaNome(`${body.customer.name} ${body.customer.surname ?? ""}`),
    customer_email: body.customer.email ?? "",
    customer_phone: body.customer.phone ?? "",
    items: itemsOrdine,
    total_cents: totaleIncassato,
    lang,
  };
  if (couponId) {
    datiOrdine.coupon_id = couponId;
    datiOrdine.coupon_code = couponCodeSalvato;
    datiOrdine.coupon_discount_cents = scontoCents;
  }

  // L'ordine in cassa ha bisogno del suo `cancel_token` subito: e' con quello
  // che la pagina di ritorno lo ritrova, visto che nessuna sessione Stripe
  // esiste.
  const campiResa = inCassa
    ? "id, cancel_token, customer_name, customer_email, customer_phone, pickup_time, items, total_cents, lang, location_id"
    : "id";
  // ⚠️ `select` con una stringa VARIABILE fa perdere a TypeScript la forma
  // della riga (rende un `ParserError`): si dichiara qui cosa ci si aspetta,
  // che e' esattamente quello che `campiResa` chiede.
  const { data: ordineRaw, error: errInsert } = await inserisci("orders", ambitoPub, datiOrdine)
    .select(campiResa)
    .single();
  const ordine = ordineRaw as unknown as
    | (RigaAnnuncio & { cancel_token?: string })
    | null;

  if (errInsert || !ordine) {
    // ⚠️ IL GUASTO ERA MUTO. Il 02/10 su BROS nessun ordine veniva creato — il
    // `check` del database non conosceva ancora `payment_method = 'onsite'` —
    // e qui si rispondeva 500 senza scrivere da nessuna parte COSA avesse
    // detto Postgres. Il messaggio al cliente resta generico, ma il motivo
    // vero deve finire nei log del server: e' l'unico posto dove cercarlo
    // quando un ordine non nasce e il carrello si svuota.
    console.error("[checkout] insert ordine fallito:", errInsert);
    return err(500, "Impossibile creare l'ordine");
  }

  const siteUrl = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";

  // ---- L'ORDINE DA PAGARE IN CASSA ----
  // ⚠️ Niente Stripe, e quindi niente webhook: se l'ordine non lo annunciamo
  // qui, non lo annuncia nessuno. E' lo stesso annuncio della strada con la
  // carta — email al cliente, email alla cucina, notifica, rubrica — perche'
  // per il ristorante quell'ordine e' vero esattamente come l'altro. Cio' che
  // NON succede e' il passaggio a `paid`: quello aspetta la cassa.
  if (inCassa) {
    /* ⚠️ IL TICKET IN CUCINA, e qui non lo accoda nessun altro. Senza Stripe
       non c'e' webhook, e `confermaOrdine` — l'unico altro punto che mette in
       coda — da questa strada non passa mai: un ordine da pagare al ritiro
       restava `pending` finche' qualcuno non lo incassava, e in cucina non
       usciva niente. La regola c'era gia' e diceva di stamparlo
       (`daStampare`: `pending` + `onsite` -> si stampa, con tanto di prova in
       `tests/stampaTicket.test.mjs`); a chiamarla non c'era nessuno. Visto su
       BROS, che non ha Stripe e incassa al banco.
       ⚠️ SI STAMPA QUANDO L'ORDINE ARRIVA, non quando si incassa: il cliente
       paga ritirando, e una comanda che aspettasse la cassa farebbe cominciare
       la cucina quando lui e' gia' al banco.
       ⚠️ Due comande non sono un rischio: l'indice unico `(order_id, kind,
       dest)` rifiuta la seconda riga. Se un domani l'incasso passasse anche da
       `confermaOrdine`, dal forno non uscirebbe niente di doppio.
       ⚠️ `void`, come l'annuncio: una stampante spenta non deve far fallire un
       ordine che e' gia' nel database. */
    void accodaTicket({
      id: ordine.id,
      status: "pending",
      payment_method: "onsite",
      location_id: ordine.location_id ?? null,
    });
    try {
      await annunciaOrdine(ordine, true);
    } catch (e) {
      // ⚠️ L'ordine ESISTE gia': se l'annuncio fallisce non si torna indietro e
      // non si dice al cliente di riprovare, o si ritroverebbe due ordini. Il
      // ristoratore lo vede comunque nel pannello, che e' il punto.
      console.error("[checkout] annuncio dell'ordine in cassa fallito:", e);
    }
    // ⚠️ La stessa forma della strada con la carta: il sito fa `location.href`
    // su quello che gli si rende, e non deve sapere quale delle due e' stata.
    // Il token e' la chiave per ritrovare l'ordine sulla pagina di ritorno —
    // li' non c'e' nessuna sessione Stripe da citare.
    const base = (await basePubblicaOpz(ambitoPub)) ?? "";
    return new Response(
      JSON.stringify({
        url: `${base}/order-confirm?token=${encodeURIComponent(String(ordine.cancel_token ?? ""))}`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  /* ⚠️ AL TAVOLO «INDIETRO» SU STRIPE NON ANNULLA NIENTE. Chi e' seduto e
     torna indietro dal pagamento vuole cambiare qualcosa — un piatto, i
     coperti, un'altra carta — e trovava «Commande annulée» e un link al
     sito: il carrello sparito dalla vista, la sala da rifare. Si torna alla
     pagina del tavolo, con la stessa sede con cui e' arrivato (id o nome
     breve, com'era), dritti sui dati (`ripresa=1`): carrello, tavolo e
     coperti li ritrova lui, sono nel suo browser.
     ⚠️ `/table` sta alla radice per contratto (il QR e' stampato): niente
     prefisso del sito qui, a differenza delle pagine di conferma. */
  let ritornoTavolo: string | undefined;
  if (aTavolo) {
    const u = new URL(`${siteUrl.replace(/\/$/, "")}/table`);
    const sedeChiesta = sedeDettaDa(request);
    if (sedeChiesta) u.searchParams.set(PARAM_SEDE, sedeChiesta);
    u.searchParams.set("ripresa", "1");
    ritornoTavolo = u.toString();
  }

  try {
    const url = await creaCheckoutSession({
      // Chi incassa: il punto che il cliente ha scelto, lo stesso con cui
      // l'ordine e' stato appena inserito.
      ambito: ambitoPub,
      voci,
      orderId: ordine.id,
      siteUrl,
      lang,
      // ⚠️ Il prefisso del sito viene dalla CONFIGURAZIONE, non dal nome di
      // un demo scritto qui dentro. Vedi `lib/basePubblica.ts`.
      returnBase: await basePubblicaOpz(ambitoPub),
      cancelUrl: ritornoTavolo,
      discount:
        scontoCents > 0
          ? { amount_cents: scontoCents, label: couponCodeSalvato ?? "Code promo" }
          : undefined,
    });
    await aggiorna("orders", ambitoPub, { stripe_session_id: url })
      .eq("id", ordine.id);

    return new Response(JSON.stringify({ url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    // Il motivo vero (chiave Stripe, metodo di pagamento non attivo…)
    // finisce nel log del server: mai nel browser del cliente.
    console.error("[checkout] Stripe error:", e);
    return err(502, "Errore nella creazione del pagamento");
  }
};

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}