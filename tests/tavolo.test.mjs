/**
 * ORDINARE DAL TAVOLO — le regole, prima delle schermate.
 *
 * ⚠️ Il difetto che queste prove tengono chiuso non si vede guardando una
 * pagina: si vede la sera, sul tablet in cucina, quando TUTTI i tavoli sono
 * rossi. Un ordine al tavolo non ha un'ora di ritiro, e il semaforo dei
 * ritardatari conta i minuti da quell'ora.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  servizioDi, alTavolo, modoServizio, avvisaChePronto, servizioInCorso,
  avvisaIlCliente, RIPIEGO_ORDINI, RIPIEGO_ORDINI_SCELTA, CHIAVI_ORDINI,
} from "../src/lib/ordiniRegole.ts";
import { SORGENTI } from "../src/lib/sorgenteRegole.ts";
import { adminT, ADMIN_LANG_CODES } from "../src/i18n/admin.ts";
import { ordineDaRiga, ticketCucina } from "../src/lib/stampaRegole.ts";
// ⚠️ Le colonne di una taglia si CHIEDONO a `escpos.ts`: scritte a mano,
// una taglia nuova resterebbe misurata con i numeri di quella vecchia.
import { colonneDi } from "../src/lib/escpos.ts";

const leggi = (f) => readFileSync(f, "utf8");
const nudo = (f) => leggi(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("un ordine senza servizio e' un ordine da asporto, come e' sempre stato", () => {
  // ⚠️ Il caso vero: tutte le righe scritte PRIMA della migrazione #82 non
  // hanno la colonna. Erano da asporto, e devono continuare a comportarsi
  // come prima — ticket con l'ora, semaforo, email di ritiro.
  assert.equal(servizioDi(undefined), "pickup");
  assert.equal(servizioDi(null), "pickup");
  assert.equal(servizioDi(""), "pickup");
  assert.equal(servizioDi("pickup"), "pickup");
  assert.equal(servizioDi("table"), "table");
  // Un valore mai visto non diventa «tavolo» per sbaglio: nel dubbio e' un
  // ritiro, che e' il comportamento che il motore ha sempre avuto.
  assert.equal(servizioDi("terrasse"), "pickup");
  assert.equal(alTavolo("table"), true);
  assert.equal(alTavolo(undefined), false);
});

test("a chi e' seduto a tre metri non si manda l'email «c'e' pronto»", () => {
  const ora = Date.now();
  const iso = new Date(ora).toISOString();
  // Da asporto, dentro la finestra: si avvisa.
  assert.equal(avvisaChePronto(iso, ora, "pickup"), true);
  assert.equal(avvisaChePronto(iso, ora), true, "il ripiego deve restare «da asporto»");
  // ⚠️ Al tavolo MAI, nemmeno all'ora esatta: il piatto arriva in mano, e
  // l'email o e' rumore o arriva dopo che il cameriere ha gia' servito.
  assert.equal(avvisaChePronto(iso, ora, "table"), false);
  assert.equal(avvisaChePronto(iso, ora - 3600_000, "table"), false);
});

test("la sala e' SPENTA finche' qualcuno non la accende", () => {
  // ⚠️ Un ristorante che fa solo asporto non ha tavoli: una pagina «ordina dal
  // tavolo» accesa di ripiego gli darebbe un QR verso un modulo senza senso.
  assert.equal(RIPIEGO_ORDINI.orders_table, "0");
  assert.ok(CHIAVI_ORDINI.includes("orders_table"),
    "la chiave non viene letta dalla configurazione: l'interruttore non farebbe niente");
  // E il ripiego del database muto non la accende per sbaglio.
  const opz = nudo("src/lib/ordiniOpzioni.ts");
  assert.match(opz, /tavolo:\s*false/,
    "il ripiego accende la sala: un database muto darebbe tavoli a chi non ne ha");
});

test("si paga a ogni giro, e il conto aperto non e' promesso", () => {
  assert.equal(modoServizio(), "per_giro");
  // ⚠️ Il conto aperto vuole che la cucina cuocia PRIMA di essere pagata, e
  // oggi `daStampare` lo rifiuta. Finche' quella regola non cambia, il
  // pannello non deve offrire la scelta: un interruttore che promette una
  // cosa non costruita e' peggio di un'opzione assente.
  const stampa = nudo("src/lib/stampaRegole.ts");
  assert.match(stampa, /s === "pending" && String\(metodo \?\? ""\) === "onsite"/,
    "daStampare ha cambiato regola: se adesso stampa il non pagato, il conto aperto e' possibile e questa prova va riscritta");
});

test("la migrazione #82 c'e', ed e' richiamabile due volte", () => {
  const m = leggi("supabase/082_orders_service_tavolo.sql");
  // ⚠️ Le migrazioni si ripassano su installazioni vive: tutto idempotente.
  assert.match(m, /add column if not exists service/);
  assert.match(m, /default 'pickup'/, "senza default, le righe gia' scritte diventerebbero senza servizio");
  // ⚠️ Il check si aggiunge a parte: `add column if not exists` non lo riporta
  // quando la colonna esiste gia', e un check perso non si vede finche'
  // qualcuno non scrive un valore storto.
  assert.match(m, /pg_constraint/,
    "il check arriva attaccato alla colonna: su un'installazione che ripassa le migrazioni andrebbe perso");
  assert.match(m, /on delete set null/,
    "reservation_id senza regola di cancellazione: cancellando una prenotazione si perderebbe un incasso vero");
  assert.doesNotMatch(m, /table_id[^;]*references/,
    "table_id ha una foreign key: togliere un tavolo costringerebbe a scegliere fra rifiutare e cancellare gli ordini");
  // Il nome del tavolo accanto all'id, come per le note assegnate (#81).
  assert.match(m, /table_label/,
    "manca il nome del tavolo: rinominandolo, gli ordini di marzo resterebbero senza un numero da dire a voce");
});


/* ==========================================================================
   SI PUO' ORDINARE ADESSO? — la porta davanti al QR.

   ⚠️ Il QR resta incollato al tavolo anche a locale chiuso, e quello generico
   si puo' inquadrare da una foto: senza questa porta si incassa con la cucina
   spenta, e il ticket non esce.
   ========================================================================== */

const GIORNO = {
  lunch_active: true,  lunch_open: "12:00",  lunch_close: "14:30",
  dinner_active: true, dinner_open: "19:00", dinner_close: "22:30",
};

test("dentro al servizio si ordina, nel buco del pomeriggio no", () => {
  assert.equal(servizioInCorso(GIORNO, "12:30"), "midi");
  assert.equal(servizioInCorso(GIORNO, "20:00"), "soir");
  // ⚠️ Le 16:00 sono il caso piu' comune di tutti: il locale e' aperto per il
  // personale, le sedie sono fuori, e qualcuno inquadra il QR.
  assert.equal(servizioInCorso(GIORNO, "16:00"), null);
  assert.equal(servizioInCorso(GIORNO, "09:00"), null);
  assert.equal(servizioInCorso(GIORNO, "23:30"), null);
});

test("l'apertura entra, la chiusura no", () => {
  // All'ora di apertura la cucina c'e': si ordina.
  assert.equal(servizioInCorso(GIORNO, "12:00"), "midi");
  assert.equal(servizioInCorso(GIORNO, "19:00"), "soir");
  // ⚠️ All'ora di chiusura NO. L'ultimo ordine alle 22:30 in punto e' un
  // piatto da fare mentre si lava la cucina.
  assert.equal(servizioInCorso(GIORNO, "14:30"), null);
  assert.equal(servizioInCorso(GIORNO, "22:30"), null);
  assert.equal(servizioInCorso(GIORNO, "14:29"), "midi");
  assert.equal(servizioInCorso(GIORNO, "22:29"), "soir");
});

test("la cena che finisce dopo mezzanotte non chiude alle 19:01", () => {
  // ⚠️ «19:00 – 01:00» non e' un intervallo crescente. Con un confronto
  // normale sarebbe sempre falso: alle 23:30, sala piena, il QR direbbe
  // «service ferme».
  const notte = { ...GIORNO, dinner_open: "19:00", dinner_close: "01:00" };
  assert.equal(servizioInCorso(notte, "23:30"), "soir");
  assert.equal(servizioInCorso(notte, "00:30"), "soir");
  assert.equal(servizioInCorso(notte, "01:00"), null, "l'ora di chiusura resta fuori anche oltre mezzanotte");
  assert.equal(servizioInCorso(notte, "03:00"), null);
  assert.equal(servizioInCorso(notte, "13:00"), "midi", "il pranzo non deve sparire");
});

test("una fascia spenta e' chiusa, e un'ora illeggibile non diventa mezzanotte", () => {
  assert.equal(servizioInCorso({ ...GIORNO, lunch_active: false }, "12:30"), null);
  assert.equal(servizioInCorso({ ...GIORNO, dinner_active: false }, "20:00"), null);
  // ⚠️ Il giorno di chiusura eccezionale arriva proprio cosi': la #schedule
  // rende lunch_active e dinner_active a false, non `null` di config.
  assert.equal(servizioInCorso({ lunch_active: false, dinner_active: false }, "12:30"), null);
  // Orari mancanti o storti: chiuso, mai «aperto da mezzanotte».
  assert.equal(servizioInCorso({ lunch_active: true, lunch_open: null, lunch_close: null }, "12:30"), null);
  assert.equal(servizioInCorso({ lunch_active: true, lunch_open: "aperto", lunch_close: "14:30" }, "12:30"), null);
  assert.equal(servizioInCorso({ lunch_active: true, lunch_open: "12:00", lunch_close: "99:99" }, "12:30"), null);
  assert.equal(servizioInCorso(GIORNO, "boh"), null);
  // Nessuna configurazione = database muto: chiuso, non aperto per sempre.
  assert.equal(servizioInCorso(null, "12:30"), null);
  assert.equal(servizioInCorso(undefined, "12:30"), null);
});

/* ==========================================================================
   LA ROTTA CHE APRE IL TAVOLO.

   Non si puo' chiamare in vitest (porta a `db.ts`): queste prove guardano il
   testo e tengono fermi gli otto fatti che, sbagliati, non danno nessun
   errore — danno una sala che conta male.
   ========================================================================== */

const ROTTA = nudo("src/pages/api/table-session.ts");

test("l'interruttore della sala si guarda PRIMA del tavolo", () => {
  // ⚠️ Un locale di solo asporto non ha tavoli: se la rotta cercasse prima il
  // tavolo risponderebbe «table inconnue», cioe' «sbaglia numero», a chi
  // invece non ha mai acceso la sala.
  const iSpento = ROTTA.indexOf("opz.attivo");
  const iTavolo = ROTTA.indexOf("await trovaTavolo(");
  assert.ok(iSpento > 0, "la rotta non guarda piu' l'interruttore: un QR funzionerebbe su tutti i clienti");
  assert.ok(iTavolo > 0 && iSpento < iTavolo, "il tavolo si cerca prima dell'interruttore");
});

test("fuori servizio si rifiuta, e si rifiuta prima di scrivere", () => {
  const iOre = ROTTA.indexOf("servizioInCorso(");
  const iScrive = ROTTA.indexOf('inserisci("reservations"');
  assert.ok(iOre > 0, "la rotta non controlla piu' l'orario: si ordinerebbe alle tre di notte");
  assert.ok(iOre < iScrive, "la prenotazione nasce prima del controllo dell'orario");
  assert.match(ROTTA, /service ferme/);
});

test("il secondo giro ritrova lo stesso tavolo", () => {
  // ⚠️ Senza questo, la famiglia che ordina il dolce dopo il primo giro apre
  // una seconda prenotazione: due righe, due volte i coperti, e la sera in
  // cassa i numeri non tornano.
  assert.match(ROTTA, /\.eq\("status",\s*"seated"\)/);
  assert.match(ROTTA, /\.eq\("date",\s*oggi\)/);
  assert.match(ROTTA, /tables\.includes\(tavolo\.id\)/,
    "non si cerca piu' per tavolo: si riuserebbe la prenotazione di un altro tavolo");
  assert.match(ROTTA, /ripresa:\s*true/, "il fronte non sa piu' distinguere un tavolo ritrovato da uno nuovo");
});

test("le colonne obbligatorie che al tavolo non si chiedono sono stringhe vuote", () => {
  // ⚠️ `last_name` e `phone` sono `not null` (migrazione #20). Non chiederli
  // e' una scelta — nessuno da' il cognome a un QR — ma `null` farebbe
  // fallire l'inserimento, cioe' un cliente seduto che non riesce a ordinare.
  const sql = leggi("supabase/020_reservations.sql");
  assert.match(sql, /last_name\s+text not null/);
  assert.match(sql, /phone\s+text not null/);
  assert.match(sql, /email\s+text not null/);
  /* ⚠️ LA FINESTRA E' LA RIGA, non il file. `phone: null` compare anche nella
     rotta, in `registraCliente`, e li' e' GIUSTO: la rubrica accetta
     `string | null`, e un telefono che nessuno ha chiesto e' assente, non
     vuoto. Sono due cose diverse, e una prova che le confonde fa fallire il
     codice corretto. */
  const RIGA = /const riga = \{([\s\S]*?)\n  \};/.exec(ROTTA)?.[1] ?? "";
  assert.ok(RIGA, "la riga della prenotazione non si legge piu': le tre prove qui sotto girerebbero a vuoto");
  assert.match(RIGA, /last_name:\s*""/);
  assert.match(RIGA, /phone:\s*""/);
  assert.doesNotMatch(RIGA, /(last_name|phone|email):\s*(null|undefined)/);
});

test("il tavolo nasce seduto, con l'ora d'arrivo vera", () => {
  assert.match(ROTTA, /status:\s*"seated"/,
    "una prenotazione `confirmed` finirebbe nel promemoria del giorno dopo e nella capienza del servizio");
  // ⚠️ `table_minutes` conta da `seated_at` (migrazioni #26 e #27): senza,
  // il piano sala vedrebbe il tavolo arrivato all'ora di apertura.
  assert.match(ROTTA, /seated_at:/);
  /* ⚠️ Il tavolo assegnato quando c'e'. Senza questa riga il piano sala
     mostrerebbe la sala vuota con la sala piena — e dove i tavoli non ci sono
     resta un array vuoto, non `null`: i conteggi fanno `Array.isArray(...)`. */
  assert.match(ROTTA, /tables: tavolo \? \[tavolo\.id\] : \[\]/,
    "senza i tavoli assegnati il piano sala mostra la sala vuota con la sala piena");
});

test("il canale e' `qr`, ed esiste davvero", () => {
  // ⚠️ La colonna ha un `check` in SQL: un valore fuori elenco non fa una
  // statistica sbagliata, fa fallire l'inserimento.
  assert.ok(SORGENTI.includes("qr"), "la sorgente scritta dalla rotta non e' piu' ammessa dal check");
  assert.match(ROTTA, /source:\s*"qr"/);
  // E il ripiego per chi non ha ancora passato la #74, come in /api/reservation.
  assert.match(ROTTA, /includes\("source"\)/,
    "senza ripiego, un cliente con il check vecchio non prende nessun ordine dal tavolo");
});

test("la recensione si programma, il promemoria no", () => {
  // Il secondo motivo per cui l'email si chiede: l'invito a lasciare una
  // recensione, differito come per le prenotazioni normali.
  assert.match(ROTTA, /programmaReview\(/);
  assert.match(ROTTA, /review_email_id/);
  assert.match(ROTTA, /registraCliente\(/, "il cliente non entra piu' in rubrica: resta solo un incasso anonimo");
  // ⚠️ E il promemoria del giorno prima NON deve partire: `rappelReservations`
  // prende solo le `confirmed`, quindi basta che il tavolo resti `seated`.
  const rappel = nudo("src/lib/rappelReservations.ts");
  assert.match(rappel, /\.eq\("status",\s*"confirmed"\)/,
    "il promemoria non filtra piu' sulle confermate: arriverebbe a chi ha cenato ieri");
});

test("la rotta non chiede «c'e' posto?» a chi e' gia' seduto", () => {
  // ⚠️ La capienza e le fasce sono domande sul futuro. Applicarle qui vorrebbe
  // dire rifiutare un cliente che e' DENTRO al locale perche' il servizio
  // della sera risulta pieno.
  assert.doesNotMatch(ROTTA, /capienza|postiLiberi|slotLiberi|calcolaSlot/i,
    "la sessione del tavolo e' passata dalla capienza: un tavolo pieno di gente verrebbe rifiutato");
  assert.match(ROTTA, /ambitoPubblicoChiesto\(request\)/,
    "senza il punto chiesto alla richiesta, il tavolo 7 si apre nella prima sede");
  assert.match(ROTTA, /export const prerender = false/);
});


/* ==========================================================================
   IL CHECKOUT AL TAVOLO.

   La rotta non si puo' chiamare in vitest (porta a `db.ts`). Queste prove
   guardano il testo, e tengono fermo soprattutto UN fatto che, sbagliato, non
   da' nessun errore: l'ordine del tavolo 7 che non compare in cucina.
   ========================================================================== */

const CK = nudo("src/pages/api/checkout.ts");
const ORDINI_API = nudo("src/pages/api/admin/orders.ts");

test("al tavolo `pickup_time` e' l'ora d'arrivo, MAI null", () => {
  /* ⚠️ Lasciarla vuota sembra piu' pulito — al tavolo non si ritira niente —
     ed e' il difetto peggiore possibile: la lista Commandes filtra con
     `.gte("pickup_time", ...)`, e in Postgres un `null` non passa nessun
     confronto. L'ordine non comparirebbe in cucina. Questa prova tiene legate
     le due cose: finche' la lista filtra su quella colonna, il checkout deve
     scriverla. */
  assert.match(ORDINI_API, /\.gte\("pickup_time"/,
    "la lista non filtra piu' su pickup_time: ricontrollare se al tavolo possa restare vuota");
  assert.match(CK, /let pickup = ora;/);
  assert.doesNotMatch(CK, /pickup_time:\s*null/);
  // E lo slot si legge solo da asporto: al tavolo `body.slot` non arriva.
  assert.match(CK, /if \(!aTavolo\) \{\n    const \[h, m\] = body\.slot\.split/);
});

test("le quattro colonne della #82 si scrivono SOLO al tavolo", () => {
  // ⚠️ Un ordine da asporto non deve portarle affatto: `service` ha
  // `default 'pickup'` in SQL, e cosi' i clienti che non hanno ancora passato
  // la migrazione continuano a inserire le colonne di prima.
  assert.match(CK, /\.\.\.\(aTavolo\s*\n?\s*\?\s*\{\s*\n\s*service: "table"/);
  assert.doesNotMatch(CK, /service:\s*"pickup"/,
    "l'ordine da asporto scrive `service`: su un database senza la #82 nessun ordine nascerebbe piu'");
  assert.match(CK, /table_label: tavoloNome/);
});

test("il nome del tavolo lo scrive il server, non il browser", () => {
  // ⚠️ Un'etichetta scelta dal cliente finirebbe sul ticket e sulla card:
  // «tavolo 1» scritto da chi siede al 9.
  assert.doesNotMatch(CK, /body\.table_label/);
  assert.match(CK, /leggi\("restaurant_tables", ambitoPub, "id, name"\)/);
  assert.match(CK, /tavoloNome = String\(tav\.name/);
});

test("la prenotazione si rilegge: di oggi, ancora seduta, e con QUEL tavolo", () => {
  /* ⚠️ Dal browser arrivano due id, e due id si cambiano. Senza questi tre
     confronti un ordine si attaccherebbe al tavolo di qualcun altro, o alla
     cena di ieri — e il cameriere porterebbe i piatti al posto sbagliato. */
  assert.match(CK, /\.eq\("id", String\(body\.reservation_id\)\)/);
  assert.match(CK, /resa\.status !== "seated"/);
  assert.match(CK, /resa\.date !== ora\.toFormat\("yyyy-MM-dd"\)/);
  assert.match(CK, /!resa\.tables\.includes\(chiesto\)/);
});

test("l'interruttore e l'orario valgono anche dove si prendono i soldi", () => {
  /* ⚠️ `/api/table-session` apre il tavolo, il checkout INCASSA. Chiudere solo
     la prima lascia aperta la seconda a chi manda la richiesta a mano: un
     incasso «al tavolo 7» in un locale che fa solo asporto, o con la cucina
     spenta, e nessuno che se ne accorge. */
  assert.match(CK, /if \(!sala\.attivo\)/);
  assert.match(CK, /servizioInCorso\(config, ora\.toFormat\("HH:mm"\)\)/);
  const iSoldi = CK.indexOf('inserisci("orders"');
  assert.ok(CK.indexOf("if (!sala.attivo)") < iSoldi, "si incassa prima di guardare l'interruttore");
  assert.ok(CK.indexOf("servizioInCorso(config") < iSoldi, "si incassa prima di guardare l'orario");
});

test("da asporto non cambia niente: slot, cognome e telefono restano obbligatori", () => {
  /* ⚠️ La prova che protegge i nove clienti di oggi. Al tavolo si chiede meno
     — nome e basta — e la tentazione e' di allentare per tutti: un ordine da
     ritirare senza telefono lascia il ristoratore senza modo di richiamare
     quando il cliente non si presenta. */
  assert.match(CK, /if \(!body\.slot \|\| !body\.customer\?\.email\)/);
  assert.match(CK, /body\.customer\.surname \?\? ""\)\.trim\(\) \|\| !String\(body\.customer\.phone/);
  assert.match(CK, /calcolaSlotGiorno\(ora, config, fuso\)/);
  assert.match(CK, /Orario di ritiro non pi/,
    "lo slot non si controlla piu': si ordinerebbe per un'ora che non esiste");
});

test("al tavolo l'email e' facoltativa, e le email sanno gia' tacere", () => {
  // ⚠️ Pretenderla perderebbe ordini; non gestire la sua assenza manderebbe
  // una ricevuta a una stringa vuota. La seconda meta' della regola sta in
  // notifications.ts, e c'era da prima.
  assert.match(CK, /customer_email: body\.customer\.email \?\? ""/);
  const notif = leggi("src/lib/notifications.ts");
  assert.match(notif, /if \(!o\.customer_email\?\.trim\(\)\) return/,
    "le email al cliente non controllano piu' l'indirizzo: un ordine al tavolo senza email le farebbe partire a vuoto");
});


/* ==========================================================================
   LA SCHEDA SUL TABLET.

   ⚠️ Il difetto che queste prove tengono chiuso e' quello descritto in testa
   al file: la lista della sera tutta rossa. Non un guasto — un semaforo che
   smette di dire qualcosa, anche sui ritiri veri.
   ========================================================================== */

const ORD = nudo("src/pages/admin/orders.astro");

test("il semaforo dei ritardatari tace al tavolo", () => {
  // La regola e' una sola, condivisa col server: `alTavolo` sta in
  // ordiniRegole.ts, che non importa niente e quindi gira anche nel browser.
  assert.match(ORD, /import \{ alTavolo \} from "\.\.\/\.\.\/lib\/ordiniRegole"/,
    "la pagina decide il servizio da sola: due meta' della stessa regola si allontanano");
  assert.match(ORD, /function ncLivelloRitardo\(pickupIso: string, status: string, servizio\?: string \| null\)/);
  assert.match(ORD, /if \(alTavolo\(servizio\)\) return 0;/);
  // ⚠️ E TUTTI i punti che lo chiamano devono passarlo: uno dimenticato e'
  // una lista rossa in meta' della pagina.
  const chiamate = [...ORD.matchAll(/ncLivelloRitardo\(o\.pickup_time, o\.status([^)]*)\)/g)];
  assert.ok(chiamate.length >= 2, `trovate ${chiamate.length} chiamate: la prova non copre piu' tutta la pagina`);
  for (const c of chiamate) {
    assert.match(c[1], /, o\.service/, "una chiamata non dice il servizio: quelle card tornerebbero rosse");
  }
});

test("in alto a sinistra: l'ora, oppure il tavolo", () => {
  assert.match(ORD, /const oraOTavolo = aTavolo/);
  assert.match(ORD, /time time-tavolo/);
  assert.match(ORD, /esc\(o\.table_label \|\| tr\("ord\.room"\)\)/,
    "senza ripiego la pastiglia resterebbe vuota nei locali senza tavoli");
  // Il markup non disegna piu' l'ora a mano: una sola strada per tutt'e due.
  assert.match(ORD, /\$\{oraOTavolo\}/);
  const topCard = ORD.slice(ORD.indexOf('<div class="card-top">'));
  assert.doesNotMatch(topCard.slice(0, 400), /ICON_CLOCK/,
    "l'ora e' ancora scritta nel markup: al tavolo comparirebbero sia l'ora che il tavolo");
  // E la pastiglia ha un corpo piu' piccolo dell'ora: «Terrasse 2» a 1.85rem
  // andrebbe a capo sulla card da 300px.
  assert.match(ORD, /\.time-tavolo \{ font-size: 1\.3rem/);
});

test("al tavolo non si puo' «ritardare» niente", () => {
  /* ⚠️ Sposterebbe un'ora di ritiro che non esiste, e manderebbe al cliente
     un'email che gli dice a che ora venire a prendere il piatto che ha
     davanti. Il bottone si costruisce UNA volta e vale per tutti i tre stati:
     scritto a mano tre volte, il quarto stato aggiunto domani se lo
     dimentica. */
  assert.match(ORD, /const ritardoBtn = aTavolo\n\s*\? ""/);
  const usi = ORD.match(/\$\{ritardoBtn\}/g) ?? [];
  assert.equal(usi.length, 3, `il bottone compare ${usi.length} volte invece di 3 (pagato, da incassare, in attesa)`);
  // ⚠️ `const` ha una zona morta: dichiarato sotto ai bottoni, sarebbe
  // «used before its declaration» — ed e' esattamente l'inciampo che il file
  // documenta per `incassaId`.
  assert.ok(ORD.indexOf("const ritardoBtn = aTavolo") < ORD.indexOf("${ritardoBtn}"),
    "ritardoBtn e' dichiarato dopo chi lo usa");
  assert.ok(ORD.indexOf("const aTavolo = alTavolo(o.service)") < ORD.indexOf("const ritardoBtn"),
    "aTavolo e' dichiarato dopo chi lo usa");
});

test("l'API porta le colonne del tavolo, e il ripiego non costa altro", () => {
  /* ⚠️ Un tentativo A PARTE, non attaccato a EXTRA_50: uniti, un cliente che
     ha la #50 ma non la #82 ricadrebbe sui soli campi base e perderebbe
     `payment_method` — cioe' gli ordini da incassare tornerebbero a sembrare
     carrelli abbandonati e sparirebbero dalla lista. */
  assert.match(ORDINI_API, /const EXTRA_82 = ", service, table_label, reservation_id";/);
  assert.match(ORDINI_API, /leggiOrdini\(CAMPI_BASE \+ EXTRA_50 \+ EXTRA_82\)/);
  assert.match(ORDINI_API, /if \(princ\.error\) \[princ, pend, cassa\] = await leggiOrdini\(CAMPI_BASE \+ EXTRA_50\);/);
  assert.match(ORDINI_API, /if \(princ\.error\) \[princ, pend, cassa\] = await leggiOrdini\(CAMPI_BASE\);/);
});

test("le due parole nuove esistono in tutte e cinque le lingue", () => {
  // ⚠️ `adminT` rende la CHIAVE quando la riga manca: nessun errore, nessun
  // log — solo «ord.table» scritto sulla card.
  for (const k of ["ord.room", "ord.atTable"]) {
    for (const lang of ADMIN_LANG_CODES) {
      const v = adminT(lang)(k);
      assert.ok(v && v !== k, `${k} manca in ${lang}`);
    }
  }
});


/* ==========================================================================
   IL TICKET CHE ESCE DALLA STAMPANTE.

   ⚠️ Queste sono le uniche prove di questo file che chiamano il codice vero
   invece di leggerlo: il ticket e' una funzione pura, e una funzione pura si
   prova facendola girare. Il difetto che tengono chiuso: «RITIRO 20:14» su un
   ordine al tavolo — chi prepara appoggia il sacchetto sul banco e aspetta,
   mentre quattro persone aspettano in sala.
   ========================================================================== */

const RIGA_BASE = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeee1234",
  status: "paid",
  payment_method: null,
  customer_name: "Marc",
  customer_phone: null,
  items: [{ name: "Margherita", base_name: "Margherita", qty: 2, notes: "" }],
};
const testi = (o) => ticketCucina(o).map((r) => r.testo);

test("al tavolo il ticket dice il TAVOLO, in testa e in fondo", () => {
  const t = ordineDaRiga({ ...RIGA_BASE, service: "table", table_label: "7" }, "20:14");
  assert.equal(t.tavolo, "7");
  const righe = testi(t);
  // In testa: e' la sola riga che si vede sul ferma-comande.
  assert.ok(righe.some((x) => x.includes("TAVOLO 7")), "il tavolo non compare sul ticket");
  // ⚠️ E «RITIRO» da nessuna parte: l'ora sulla riga esiste (e' quella
  // d'arrivo) e stamparla come ora di ritiro e' il difetto peggiore possibile.
  assert.ok(!righe.some((x) => x.includes("RITIRO")),
    "il ticket del tavolo annuncia un ritiro: il sacchetto finisce sul banco e il cliente aspetta in sala");
  // E l'ora d'arrivo non prende la riga grossa in fondo.
  const grosse = ticketCucina(t).filter((r) => r.taglia === "gigante").map((r) => r.testo);
  assert.ok(!grosse.includes("20:14"), "l'ora d'arrivo e' stampata grossa come se fosse un orario di ritiro");
  assert.ok(grosse.some((x) => x.includes("TAVOLO 7")));
});

test("da asporto il ticket e' quello di sempre", () => {
  // ⚠️ La prova che protegge i nove clienti di oggi: nessuno di loro ha un
  // tavolo, e il loro ticket non deve muoversi di una riga.
  const t = ordineDaRiga({ ...RIGA_BASE }, "19:45");
  assert.equal(t.tavolo, null);
  const righe = testi(t);
  assert.ok(righe.some((x) => x.includes("RITIRO 19:45")));
  assert.ok(!righe.some((x) => x.includes("TAVOLO")));
  // E anche con la colonna presente ma vuota: le righe scritte prima della #82.
  const vecchio = ordineDaRiga({ ...RIGA_BASE, service: null, table_label: null }, "19:45");
  assert.equal(vecchio.tavolo, null);
  assert.ok(testi(vecchio).some((x) => x.includes("RITIRO 19:45")));
});

test("in sala senza tavoli il ticket dice il NOME", () => {
  /* ⚠️ IL CASO DEL BISTROT E DELLO SNACK. Qui non c'e' nessun tavolo da
     stampare, e il nome e' l'unica cosa che permette di consegnare: il
     cameriere cerca Marc, lo snack lo chiama al banco. Con il solo campo
     `tavolo` il ticket ricadeva su quello da asporto e stampava «RITIRO
     20:14» — l'ora in cui quella persona si e' SEDUTA — e il sacchetto
     restava sul banco. */
  const t = ordineDaRiga({ ...RIGA_BASE, service: "table", table_label: "" }, "20:14");
  assert.equal(t.servizio, "table", "il ticket non sa piu' che il cliente e' in sala");
  assert.equal(t.tavolo, null, "un tavolo finto: l'etichetta vuota deve restare vuota");
  const righe = testi(t);
  assert.ok(righe.some((x) => x.includes("MARC")), "il nome non compare: nessuno sa a chi portare");
  assert.ok(!righe.some((x) => x.includes("RITIRO")),
    "il ticket annuncia un ritiro a chi e' in sala: il sacchetto resta sul banco");
  // La riga grossa in fondo e' il nome, non l'ora d'arrivo.
  const grosse = ticketCucina(t).filter((r) => r.taglia === "gigante").map((r) => r.testo);
  assert.ok(grosse.includes("MARC"));
  assert.ok(!grosse.includes("20:14"));
});

test("in sala, senza tavolo e senza nome: mai l'ora d'arrivo", () => {
  // ⚠️ Il nome e' obbligatorio nel modulo, ma questo ticket non puo' fidarsi
  // di quella garanzia: una riga storta non deve far ricomparire «RITIRO».
  const t = ordineDaRiga({ ...RIGA_BASE, customer_name: "", service: "table", table_label: "" }, "20:14");
  const righe = testi(t);
  assert.ok(righe.some((x) => x.includes("IN SALA")));
  assert.ok(!righe.some((x) => x.includes("RITIRO")));
});

test("la riga di testa ci sta nelle colonne della sua taglia", () => {
  // ⚠️ `largo` sono 24 colonne. «#EE1234 · TAVOLO 12» ci sta; se un domani la
  // riga si allungasse, andrebbe a capo proprio dove si legge il numero.
  const t = ordineDaRiga({ ...RIGA_BASE, service: "table", table_label: "12" }, "20:14");
  const testa = ticketCucina(t).find((r) => r.testo.includes("TAVOLO 12"));
  assert.ok(testa, "riga di testa non trovata");
  assert.ok(
    testa.testo.length <= colonneDi(testa.taglia),
    `la testa occupa ${testa.testo.length} colonne su ${colonneDi(testa.taglia)}: andrebbe a capo`,
  );
});

test("il tavolo e' un campo a se', non `ora` travestita", () => {
  /* ⚠️ Il disegno del ticket e' del CLIENTE (`config/ticket.ts`). Infilare il
     numero del tavolo dentro `ora` avrebbe fatto stampare «RITIRO 7» a
     chiunque abbia un disegno proprio, e nessuno avrebbe capito da dove
     venisse quel sette. */
  const t = ordineDaRiga({ ...RIGA_BASE, service: "table", table_label: "7" }, "20:14");
  assert.equal(t.ora, "20:14", "l'ora e' stata sovrascritta col tavolo");
  assert.equal(t.tavolo, "7");
});

test("la rotta di stampa non perde la comanda per una colonna che non c'e'", () => {
  /* ⚠️ Su un cliente senza la #82 una `select` con `service` FALLISCE, e in
     quella rotta un ordine che non si legge vuol dire NESSUN TICKET — per
     tutti gli ordini, compresi quelli da asporto. Meglio perdere il nome del
     tavolo che la comanda. */
  const pr = nudo("src/pages/api/print/[token].ts");
  assert.match(pr, /service, table_label/);
  assert.match(pr, /if \(!ordine\) \(\{ data: ordine \} = await leggiOrdine\(CAMPI\)\);/,
    "il secondo tentativo non c'e' piu': un cliente senza la #82 non stamperebbe nulla");
});


/* ==========================================================================
   TRE LOCALI, NON DUE.

   ⚠️ Il bistrot senza numeri sui tavoli e lo snack al banco hanno gli STESSI
   dati e vogliono il contrario l'uno dell'altro: il primo ha il cameriere e
   l'email «c'è pronto» è rumore, il secondo non ha nessuno che porti e
   quell'email è l'unico modo di dirlo. Per questo l'interruttore esiste; per
   questo il suo ripiego guarda i tavoli.
   ========================================================================== */

test("l'avviso: tre stati, e il terzo guarda i tavoli", () => {
  // Scelto a mano: vince sempre su qualunque deduzione.
  assert.equal(avvisaIlCliente("1", true), true, "acceso a mano e ignorato");
  assert.equal(avvisaIlCliente("0", false), false, "spento a mano e ignorato");
  /* ⚠️ Non scelto: si avvisa dove NON ci sono tavoli. Il ripiego sbaglia nella
     direzione meno costosa — il danno di non avvisare chi aspetta al banco e'
     peggiore del fastidio di un'email in piu' a chi e' servito al tavolo. */
  assert.equal(avvisaIlCliente("", false), true);
  assert.equal(avvisaIlCliente("", true), false);
  assert.equal(avvisaIlCliente(undefined, false), true);
  assert.equal(avvisaIlCliente(null, true), false);
  // Un valore storto non e' una terza scelta: e' «non scelto».
  assert.equal(avvisaIlCliente("oui", false), true);
  assert.equal(avvisaIlCliente("2", true), false);
});

test("la chiave a tre stati non passa da `acceso()`", () => {
  /* ⚠️ `acceso()` legge due stati e cerca il ripiego in `RIPIEGO_ORDINI`. Su
     questa chiave non lo troverebbe e renderebbe `false` — cioe' «non
     avvisare» — in silenzio, che e' esattamente il danno da evitare. Tenerla
     in un elenco separato fa sbagliare rumorosamente invece che in silenzio. */
  assert.ok(RIPIEGO_ORDINI_SCELTA.orders_table_notify === "",
    "il ripiego della chiave non e' piu' «non scelto»: il terzo stato e' sparito");
  assert.equal(RIPIEGO_ORDINI.orders_table_notify, undefined,
    "la chiave a tre stati e' finita fra quelle a due: acceso() la leggerebbe come «non avvisare»");
  assert.ok(CHIAVI_ORDINI.includes("orders_table_notify"),
    "la chiave non viene letta dalla configurazione: l'interruttore non farebbe niente");
});

test("a chi e' servito al tavolo niente email, a chi aspetta al banco sì", () => {
  const ora = Date.now();
  const iso = new Date(ora).toISOString();
  // Da asporto: come sempre.
  assert.equal(avvisaChePronto(iso, ora, "pickup"), true);
  // In sala col cameriere: silenzio, anche all'ora esatta.
  assert.equal(avvisaChePronto(iso, ora, "table"), false);
  assert.equal(avvisaChePronto(iso, ora, "table", false), false);
  // ⚠️ In sala SENZA cameriere: si avvisa. Senza questo ramo lo snack non
  // avrebbe nessun modo di dire che il piatto e' pronto.
  assert.equal(avvisaChePronto(iso, ora, "table", true), true);
  /* ⚠️ Ma la finestra resta: al banco `pickup_time` e' l'istante dell'ordine,
     e mezz'ora dopo «Terminée» non vuol dire «e' pronto» ma «il cliente e'
     passato e nessuno aveva cambiato lo stato». */
  assert.equal(avvisaChePronto(iso, ora + 31 * 60_000, "table", true), false);
  assert.equal(avvisaChePronto(iso, ora + 29 * 60_000, "table", true), true);
});

test("«ci sono i tavoli?» si chiede ai dati, non a un interruttore", () => {
  const opzioni = nudo("src/lib/ordiniOpzioni.ts");
  assert.match(opzioni, /leggi\("restaurant_tables", ambito, "id"\)/,
    "la presenza dei tavoli non si legge piu' dalla mappa: tornerebbe a essere una cosa da tenere d'accordo a mano");
  /* ⚠️ `reservation_plan_mode` dice «i posti li conta il piano della sala»,
     che e' un'altra domanda: un locale puo' avere i tavoli disegnati e
     contare i posti per zona. Usarla qui spegnerebbe la scelta del tavolo a
     chi i tavoli ce li ha. */
  assert.doesNotMatch(opzioni, /reservation_plan_mode/,
    "opzioniTavolo guarda reservation_plan_mode: e' un'altra domanda");
  // Lettura muta → nessun tavolo: si chiede solo il nome, e si ordina.
  assert.match(opzioni, /if \(error\) return 0;/);
});

test("il tavolo si chiede solo dove esiste", () => {
  // La sessione: obbligatorio con i tavoli, assente senza.
  assert.match(ROTTA, /if \(opz\.conTavoli && !chiesto\) return json\(\{ error: "table manquante" \}/);
  assert.match(ROTTA, /if \(opz\.conTavoli\) \{\n\s*tavolo = await trovaTavolo\(chiesto, ambito\);/);
  // E l'incasso: stessa regola, ricontrollata dove si prendono i soldi.
  assert.match(CK, /if \(sala\.conTavoli && !String\(body\.table_id \?\? ""\)\.trim\(\)\)/);
  /* ⚠️ Senza tavoli la prenotazione porta un array VUOTO, non `null`: il piano
     sala e i conteggi fanno `Array.isArray(...)`, e un `null` li farebbe
     passare dal ramo «colonna non lanciata» invece che da «nessun tavolo». */
  assert.match(ROTTA, /tables: tavolo \? \[tavolo\.id\] : \[\]/);
});

test("l'email diventa obbligatoria solo quando e' l'unico modo di avvisare", () => {
  /* ⚠️ Dove nessuno porta il piatto l'email e' il solo canale verso il
     cliente: `push.ts` suona sui telefoni del RISTORATORE, un push al cliente
     non esiste. Senza indirizzo, quella persona fissa il bancone. */
  assert.match(ROTTA, /if \(opz\.avvisa && !email\) return json\(\{ error: "email requise" \}/);
  assert.match(CK, /if \(sala\.avvisa && !String\(body\.customer\.email \?\? ""\)\.trim\(\)\)/);
  // E dove c'e' chi serve, resta facoltativa: pretenderla perderebbe ordini.
  assert.match(CK, /customer_email: body\.customer\.email \?\? ""/);
});

test("il secondo giro si ritrova con due chiavi diverse", () => {
  /* ⚠️ Col tavolo si riconosce dal numero, che e' un fatto. Senza tavoli
     l'unica chiave e' il `reservation_id` che il browser si e' ricordato, e si
     crede solo dopo aver verificato che quella prenotazione e' di OGGI e
     ancora aperta. Senza nessuna delle due, la famiglia che ordina il dolce
     conta due volte nei coperti della sera. */
  assert.match(ROTTA, /const gia = opz\.conTavoli/);
  assert.match(ROTTA, /tables\.includes\(tavolo\.id\)/);
  assert.match(ROTTA, /seduti\.find\(\(r\) => String\(r\.id\) === chiestaResa\)/);
  assert.match(ROTTA, /\.eq\("date", oggi\)/);
  assert.match(ROTTA, /\.eq\("status", "seated"\)/);
});

test("l'email «c'e' pronto» legge l'interruttore della sede dell'ORDINE", () => {
  /* ⚠️ Non quella selezionata nell'header: in un gruppo lo snack e il
     ristorante col cameriere stanno nello stesso account e vogliono il
     contrario l'uno dell'altro. */
  assert.match(ORDINI_API, /avvisaInSala = \(await opzioniTavolo\(contoAnn\)\)\.avvisa;/);
  assert.match(ORDINI_API, /avvisaChePronto\(prima\.pickup_time, Date\.now\(\), prima\.service, avvisaInSala\)/);
  // ⚠️ E si legge SOLO per un ordine in sala: un ritiro non deve pagare una
  // lettura in piu' per una sala che non lo riguarda.
  assert.match(ORDINI_API, /if \(status === "done" && alTavolo\(prima\?\.service\)\)/);
  // La colonna deve arrivare fin qui, col ripiego per chi non ha la #82.
  assert.match(ORDINI_API, /payment_method, service";/);
});


/* ==========================================================================
   I DUE INTERRUTTORI IN REGLAGES.

   ⚠️ Fino a oggi `orders_table` si poteva accendere solo scrivendo a mano in
   `app_config`: la chiave era classificata e letta, e nessuna pagina la
   mostrava. Un interruttore che esiste e non si può toccare è una funzione
   che non esiste.
   ========================================================================== */

const SET_API = nudo("src/pages/api/admin/settings.ts");
const SET_PAG = nudo("src/pages/admin/settings.astro");

test("la pagina mostra l'avviso RISOLTO, non quello che direbbe `acceso()`", () => {
  /* ⚠️ IL DIFETTO CHE QUESTA PROVA TIENE CHIUSO E' DEI PEGGIORI, perche' non
     fa rumore: `acceso()` non trova il ripiego di una chiave a tre stati e
     rende `false`. La pagina mostrerebbe «avvisa: spento» a uno snack che sta
     avvisando; il ristoratore salva un campo qualsiasi, quel "0" diventa la
     scelta, e i clienti al banco smettono di ricevere l'email senza che
     nessuno abbia deciso niente. */
  assert.match(SET_API, /if \(k in RIPIEGO_ORDINI_SCELTA\) continue;/,
    "le chiavi a tre stati passano da acceso(): la pagina mostrerebbe «spento» a chi sta avvisando");
  assert.match(SET_API, /orders\.orders_table_notify = sala\.avvisa;/);
  assert.match(SET_API, /const sala = await opzioniTavolo\(ambito\);/,
    "il valore non lo risolve piu' la stessa funzione che decide a ordine fatto: i due possono allontanarsi");
  // E la pagina deve poter DIRE che tavoli non ce ne sono.
  assert.match(SET_API, /sala_con_tavoli: sala\.conTavoli/);
});

test("i due interruttori esistono, si leggono e si salvano", () => {
  // ⚠️ Tre punti, e mancandone uno l'interruttore sembra funzionare: si
  // accende, si salva, e alla ricarica e' tornato spento.
  for (const id of ["o-table", "o-table-notify"]) {
    assert.ok(SET_PAG.includes(`id="${id}"`), `manca la casella ${id} nel markup`);
    assert.ok(SET_PAG.includes(`met("${id}"`), `${id} non viene letto al caricamento: tornerebbe spento a ogni ricarica`);
  }
  assert.match(SET_PAG, /orders_table: \(document\.getElementById\("o-table"\)/);
  assert.match(SET_PAG, /orders_table_notify: \(document\.getElementById\("o-table-notify"\)/);
  // Il server scrive solo le chiavi che arrivano, e sono le sue.
  assert.match(SET_API, /for \(const k of CHIAVI_ORDINI\) \{\n\s*if \(!\(k in dati\)\) continue;/,
    "il salvataggio non filtra piu' sulle chiavi dichiarate");
});

test("la domanda sull'avviso compare solo a sala accesa", () => {
  /* ⚠️ A chi fa solo asporto «avvisare quando e' pronto» non vuol dire
     niente: sarebbe un interruttore che non fa mai nulla, come i coupon in
     cassa senza la cassa. E segue la sala anche MENTRE la si tocca, non solo
     al caricamento. */
  assert.match(SET_PAG, /rigaAvviso\.style\.display = swTavolo\?\.checked \? "" : "none"/);
  assert.match(SET_PAG, /swTavolo\?\.addEventListener\("change", aggiornaRigaAvviso\)/,
    "la riga non segue l'interruttore mentre lo si tocca: bisognerebbe ricaricare la pagina");
  // E il fatto «questa sala non ha tavoli» e' scritto, non lasciato capire.
  assert.match(SET_PAG, /dati\.sala_con_tavoli === false/);
});

test("le parole dei due interruttori esistono in tutte e cinque le lingue", () => {
  for (const k of ["set.ord.table", "set.ord.tableHint", "set.ord.tableNoTables",
                   "set.ord.tableNotify", "set.ord.tableNotifyHint"]) {
    for (const lang of ADMIN_LANG_CODES) {
      const v = adminT(lang)(k);
      assert.ok(v && v !== k, `${k} manca in ${lang}`);
    }
  }
});


/* ==========================================================================
   LA PAGINA DEL QR.
   ========================================================================== */

const OAPP = nudo("src/components/OrderApp.tsx");
const TORD = nudo("src/components/TableOrder.tsx");
const TPAG = nudo("src/pages/table.astro");

test("il menu della sala non e' nessuno dei due di prima", () => {
  const db = nudo("src/lib/db.ts");
  /* ⚠️ `definizioneMenu(false)` — in sala si ordina tutto cio' che e' VISIBILE:
     «ordinabile» vuol dire «ordinabile ONLINE», e il piatto che il ristoratore
     non manda in un sacchetto e' proprio quello che ha senso da seduti. */
  assert.match(db, /const \{ visibili, categorie \} = await definizioneMenu\(false, ambito\);\n\s*return arricchisci\(raggruppa\(await applicaStatoSede\(visibili, ambito\), true, ambito\), categorie\);/,
    "getMenuSala non legge piu' «visibile + prezzi online»");
  /* ⚠️ E `online: true` per i PREZZI, che e' la meta' che non si puo'
     sbagliare: `/api/checkout` applica SEMPRE tutti gli sconti
     (`prezzoEffettivo`, senza condizioni). Coi prezzi della vetrina il
     cliente vedrebbe 14,00 e sulla carta gli uscirebbe 12,00 — due numeri
     diversi per la stessa cena, e nessuno abbastanza sbagliato da far
     sospettare dove sia il guasto. */
  assert.match(nudo("src/pages/api/checkout.ts"),
    /const prezzoBase = prezzoEffettivo\(prezzoPieno, piatto\.discount_type, piatto\.discount_value\);/,
    "il checkout ha cambiato il modo di scontare: ricontrollare che i prezzi della sala combacino");
  assert.match(TPAG, /getMenuSala\(ambito\)/);
});

test("al tavolo niente slot, niente cognome, niente telefono", () => {
  // ⚠️ Lasciare il selettore degli orari chiederebbe a chi e' seduto quando
  // passa a ritirare, e il primo orario scelto finirebbe scritto come
  // appuntamento su un ordine che nessuno viene a prendere.
  assert.match(OAPP, /\{inSala \? \(\n\s*tavolo\.tableLabel \?/);
  assert.match(OAPP, /\{!inSala && \(/, "cognome e telefono si chiedono anche in sala");
  assert.match(OAPP, /\(inSala \|\| slot !== null\) &&/);
  assert.match(OAPP, /\(inSala \|\| cognome\.trim\(\) !== ""\) &&/);
  assert.match(OAPP, /\(inSala \|\| telefono\.trim\(\) !== ""\) &&/);
  // E al checkout si manda il servizio al posto dello slot.
  assert.match(OAPP, /\? \{\n\s*service: "table",\n\s*reservation_id: tavolo\.reservationId,/);
  assert.match(OAPP, /: \{ slot \}\),/,
    "lo slot si manda sempre: al tavolo diventerebbe un orario di ritiro inventato");
});

test("l'email obbligatoria solo dove nessuno porta il piatto", () => {
  assert.match(OAPP, /const emailOk = inSala\n\s*\? tavolo\.emailObbligatoria/);
  // Facoltativa: vuota va bene, sbagliata no. Senza la seconda meta', un
  // indirizzo storto partirebbe e la ricevuta tornerebbe indietro.
  assert.match(OAPP, /: email\.trim\(\) === "" \|\| emailValida/);
});

test("niente cambia per chi ordina da asporto", () => {
  /* ⚠️ LA PROVA CHE PROTEGGE I NOVE SITI IN PRODUZIONE. `tavolo` e'
     facoltativa e nulla di ripiego: il giorno del merge una pagina /order che
     non la passa si comporta esattamente come ieri. */
  assert.match(OAPP, /tavolo = null, pagamento = \{ online: true/);
  assert.match(OAPP, /const inSala = tavolo !== null;/);
  // Le stringhe nuove sono OPZIONALI: un dizionario che non le ha non rompe.
  assert.match(OAPP, /emailWhyRequired\?: string;/);
});

test("l'isola del tavolo non tocca `db.ts`, nemmeno coi tipi", () => {
  /* ⚠️ `db.ts` crea il client Supabase ALL'IMPORT e lancia senza le variabili
     d'ambiente. OrderApp si dichiara i suoi tipi in casa per questo motivo
     esatto, ed e' una disciplina che si perde con un import innocuo. */
  assert.doesNotMatch(TORD, /from "\.\.\/lib\/db"/,
    "TableOrder importa da db.ts: l'isola porterebbe dentro il client Supabase");
  assert.match(TORD, /React\.ComponentProps<typeof OrderApp>\["menu"\]/);
});

test("la sessione del tavolo viaggia col punto, e si riprende", () => {
  // ⚠️ Senza la sede, un gruppo con piu' punti aprirebbe il tavolo 7 del
  // PRIMO. Stesso inciampo gia' pagato da /api/checkout e /api/coupon.
  assert.match(TORD, /conSede\("\/api\/table-session"\)/);
  assert.match(TORD, /const conSede = \(u: string\) => urlConSede\(u, sede\);/);
  // La ripresa: chi riapre il QR a fine cena ritrova lo stesso conto.
  assert.match(TORD, /sessionStorage\.setItem\(CHIAVE/);
  assert.match(TORD, /reservation_id: leggiSessione\(\)\?\.id/);
  // ⚠️ E in navigazione privata non deve morire: si ordina, non si riprende.
  assert.match(TORD, /try \{\n\s*const raw = window\.sessionStorage\.getItem\(CHIAVE\);/);
});

test("il messaggio del server non arriva mai grezzo al cliente", () => {
  /* ⚠️ `/api/table-session` risponde in una lingua sola, e di proposito: i
     suoi messaggi sono per i log. Mostrarli vorrebbe dire «commande a table
     non activee» sul telefono di un cliente. */
  assert.match(TORD, /e\.includes\("ferme"\) \? testi\.errChiuso/);
  assert.match(TORD, /: testi\.errGenerico,/);
  assert.doesNotMatch(TORD, /setErrore\(String\(dati\.error/);
});

test("la pagina del QR: spenta da', 404, e non finisce su Google", () => {
  /* ⚠️ Il QR resta incollato al tavolo per mesi. Se il ristoratore spegne gli
     ordini dal locale, chi inquadra deve trovare «questa pagina non c'e'» —
     non un modulo che rifiuta l'ordine DOPO che ha composto la cena. */
  assert.match(TPAG, /if \(!sala\.attivo\) return new Response\(null, \{ status: 404 \}\)/);
  // ⚠️ Indicizzata, qualcuno la troverebbe cercando il ristorante e aprirebbe
  // un tavolo da casa.
  assert.match(TPAG, /name="robots" content="noindex, nofollow"/);
  // I due QR: generico e stampato per quel tavolo.
  assert.match(TPAG, /searchParams\.get\("table"\)/);
  assert.match(TPAG, /tavoloDaUrl=\{tavoloDaUrl\}/);
});

test("le parole della prima schermata stanno nella pagina, non nel dizionario", () => {
  /* ⚠️ `src/i18n/**` e' del cliente (`merge=ours`): una chiave nuova messa in
     fr.json dal motore non arriverebbe MAI a nessuno — `t("...")` rende la
     chiave, e sul tavolo si leggerebbe «table.intro». Stando nella pagina, le
     parole viaggiano col file che le usa. */
  const attr = leggi(".gitattributes");
  assert.match(attr, /src\/i18n\/\*\*\s+merge=ours/,
    "il dizionario pubblico non e' piu' del cliente: le parole possono tornare nel json");
  assert.match(TPAG, /const TESTI: Record<string, TestiSessione>/);
  for (const l of ["fr", "en", "it", "nl", "es"]) {
    assert.ok(new RegExp(`\\n  ${l}: \\{`).test(TPAG), `manca la lingua ${l} nella pagina del tavolo`);
  }
  // E le parole della PERSONA si riusano dal widget prenotazioni: due
  // traduzioni della stessa parola si allontanano alla prima modifica.
  assert.match(TPAG, /firstName: t\("book\.firstName"\)/);
});


/* ==========================================================================
   LA SCHEDA COMMANDES DI REGLAGES, divisa in due.
   ========================================================================== */

test("due schede: chi ordina da fuori, e chi e' dentro al locale", () => {
  /* ⚠️ Erano sei interruttori di fila, e le due domande si leggevano come una
     sola: «paghi online» e «ordini dal tavolo» non hanno niente in comune. */
  assert.match(SET_PAG, /<h2>\{t\("set\.ord\.onlineTitle"\)\}<\/h2>/);
  assert.match(SET_PAG, /<h2>\{t\("set\.ord\.salleTitle"\)\}<\/h2>/);
  // I due interruttori della sala stanno nella SECONDA scheda.
  const iSalle = SET_PAG.indexOf('set.ord.salleTitle');
  assert.ok(iSalle > 0 && SET_PAG.indexOf('id="o-table"') > iSalle,
    "l'interruttore della sala e' rimasto nella scheda degli ordini online");
  assert.ok(SET_PAG.indexOf('id="o-pay-online"') < iSalle,
    "il pagamento online e' finito nella scheda della sala");
});

test("il tempo di preparazione sparisce dalla vista, non dal salvataggio", () => {
  /* ⚠️ IL PUT DEGLI ORARI LO PRETENDE: `Number.isFinite(prep)` e 400 senza.
     Tolto il campo senza tenerne il valore, il salvataggio di QUALSIASI cosa
     in Reglages morirebbe con un errore in faccia al ristoratore — e la
     pagina non lo spiegherebbe. */
  assert.match(SET_API, /if \(!Number\.isFinite\(prep\) \|\| prep < 0 \|\| prep > 240\)/,
    "il PUT non pretende piu' prep_time_minutes: ricontrollare se la pagina debba ancora rimandarlo");
  assert.doesNotMatch(SET_PAG, /id="prep"/, "il campo e' ancora li'");
  assert.doesNotMatch(SET_PAG, /prepEl/, "resta un riferimento a un elemento che non esiste: la pagina morirebbe al caricamento");
  assert.match(SET_PAG, /prep_time_minutes: prepCorrente,/);
  assert.match(SET_PAG, /prepCorrente = Number\(dati\.prep_time_minutes\) \|\| 30;/);
  // ⚠️ Il ripiego e' 30 come nell'API, non 0: una lettura fallita non deve
  // scrivere «pronto fra un minuto» su tutti e sette i giorni.
  assert.match(SET_PAG, /let prepCorrente = 30;/);
});

test("la durata di uno slot resta, e resta viva", () => {
  // ⚠️ Tre fili, e mancandone uno il campo sembra funzionare: si riempie, si
  // cambia, e al salvataggio torna com'era.
  assert.match(SET_PAG, /id="slot" min="5" max="120"/);
  assert.match(SET_PAG, /slotEl\.value = String\(dati\.slot_duration_minutes\)/);
  assert.match(SET_PAG, /slotEl\.addEventListener\("input", dirty\)/,
    "cambiare la durata non segna piu' la pagina come modificata: il bottone «salva» resta spento");
  assert.match(SET_PAG, /slot_duration_minutes: Number\(slotEl\.value\)/);
});

test("l'interruttore non va a capo sotto la sua spiegazione", () => {
  /* ⚠️ `.field` ha `flex-wrap: wrap`, e una spiegazione di due righe spingeva
     il suo interruttore sulla riga sotto: letto di sfuggita sembrava
     appartenere alla voce successiva, e il ristoratore accendeva l'altra
     cosa. Visto sulle due voci nuove, che hanno il testo piu' lungo. */
  assert.match(SET_PAG, /\.field:has\(> label\.switch\) \{ flex-wrap: nowrap; \}/);
});

test("i titoli delle due schede esistono in tutte e cinque le lingue", () => {
  for (const k of ["set.ord.onlineTitle", "set.ord.salleTitle"]) {
    for (const lang of ADMIN_LANG_CODES) {
      const v = adminT(lang)(k);
      assert.ok(v && v !== k, `${k} manca in ${lang}`);
    }
  }
});


/* ==========================================================================
   LA PAGINA COMMANDES IN DUE COLONNE.

   ⚠️ Il confine è il GESTO che segue: un ritiro si prepara e si mette sul
   bancone, un ordine in sala si porta. In una lista sola i due si mescolano e
   la differenza sta in una pastiglia che a mezzo metro dal tablet non si legge.
   ========================================================================== */

test("ritiri e sala, e la divisione la fa la regola condivisa", () => {
  assert.match(ORD, /const inSala = attivi\.filter\(\(o\) => alTavolo\(o\.service\)\);/);
  assert.match(ORD, /const daRitirare = attivi\.filter\(\(o\) => !alTavolo\(o\.service\)\);/);
  /* ⚠️ `alTavolo`, non `o.service === "table"` scritto a mano: un valore mai
     visto finirebbe in sala invece che fra i ritiri, e `servizioDi` dice che
     nel dubbio è un ritiro. */
  assert.doesNotMatch(ORD, /o\.service === "table"/,
    "la divisione è scritta a mano: un valore sconosciuto finirebbe in sala");
  assert.match(ORD, /gridSalaEl\.innerHTML = inSala\.map\(cardHTML\)\.join\(""\)/);
});

test("nessun ordine può sparire quando la sala si spegne", () => {
  /* ⚠️ La seconda colonna si apre con l'interruttore acceso O con almeno un
     ordine al tavolo già in lista. Legata al solo interruttore, spegnere la
     sala a servizio iniziato farebbe sparire chi sta mangiando — e un ordine
     che non si vede è un piatto che nessuno porta. */
  assert.match(ORD, /const apriSala = dueColEl\?\.dataset\.sala === "1" \|\| inSala\.length > 0;/);
  // E di ripiego è SPENTA: una colonna «Sala» vuota è mezzo schermo che non
  // dice niente in cucina.
  assert.match(ORD, /let salaAttiva = false;/);
  assert.match(ORD, /salaAttiva = \(await opzioniTavolo\(ambitoOrd\)\)\.attivo;/);
});

test("la ricerca chiude le due colonne, e svuota quella della sala", () => {
  /* ⚠️ Svuotarla non è facoltativo: lasciata com'era mostrerebbe le card di
     prima accanto ai risultati della ricerca — un ordine che non c'entra
     niente, letto come se c'entrasse. */
  /* ⚠️ L'ancora e' CODICE, non un commento: `ORD` passa da `nudo()`, che i
     commenti li toglie — cercare «Modalità RICERCA» rendeva -1, la finestra
     veniva vuota, e la prova falliva su un codice giusto. */
  const iRicerca = ORD.indexOf("if (ricerca) {");
  const iRender = ORD.indexOf("const inSala = attivi.filter");
  const blocco = ORD.slice(iRicerca, iRender);
  assert.match(blocco, /gridSalaEl\.innerHTML = "";/,
    "la colonna della sala non si svuota durante la ricerca");
  assert.match(blocco, /dueColEl\.classList\.remove\("aperta"\)/);
});

test("sotto i 1100px le due colonne tornano una", () => {
  // ⚠️ Le card hanno un minimo di 300px: in mezza schermata stretta
  // andrebbero a filo o fuori, e la pagina Commandes si guarda su un tablet.
  assert.match(ORD, /@media \(max-width: 1100px\) \{ \.due-col\.aperta \{ grid-template-columns: 1fr;/);
});

test("il titolo delle due colonne esiste in tutte e cinque le lingue", () => {
  for (const k of ["ord.colPickup", "ord.room"]) {
    for (const lang of ADMIN_LANG_CODES) {
      const v = adminT(lang)(k);
      assert.ok(v && v !== k, `${k} manca in ${lang}`);
    }
  }
});


test("lo stile della pagina del QR arriva davvero all'isola", () => {
  /* ⚠️ IL DIFETTO CHE QUESTA PROVA TIENE CHIUSO NON DA' NESSUN ERRORE. Astro
     marca con `data-astro-…` solo gli elementi del SUO template; il modulo lo
     disegna React dentro l'isola, quindi uno stile «scoped» non combacia con
     niente e la pagina esce nuda — niente in Astro, niente in console, solo
     un modulo senza vestito su un telefono al tavolo. */
  assert.match(TPAG, /<style is:global>/,
    "lo stile e' scoped: non raggiunge il DOM disegnato da React e la pagina esce nuda");
  // ⚠️ E il bottone ha due colori dichiarati: con `background: currentColor`
  // il testo ereditava lo stesso colore dello sfondo — un rettangolo pieno.
  /* ⚠️ Due VARIABILI, non due colori scritti dentro: il motore non conosce
     la tavolozza del sito e non deve imporgliene una. Il cliente le cambia dal
     suo foglio di stile, senza toccare la pagina e senza conflitti al merge. */
  assert.match(TPAG, /\.tbl-btn \{[^}]*background: var\(--tbl-ink\); color: var\(--tbl-paper\);/);
  assert.match(TPAG, /--tbl-ink: #1b1b1b; --tbl-paper: #fff;/);
  assert.doesNotMatch(TPAG, /background: currentColor/);
  // Le altre pagine del motore che vestono un'isola fanno gia' cosi'.
  assert.match(leggi("src/components/ReservationWidget.astro"), /<style is:global>/,
    "il modello e' cambiato: ricontrollare come si veste un'isola");
});


test("la pagina del QR si veste col brand del CLIENTE, non del motore", () => {
  /* ⚠️ Una pagina del motore non ha un design suo e non deve averne uno: dà
     le porte ai dati, il vestito è del cliente. Senza questa lettura esce in
     Times New Roman su fondo bianco — tecnicamente giusta, e per chi inquadra
     il QR seduto al tavolo è il sito di nessuno. */
  assert.match(TPAG, /brandPubblico\(ambito\)/);
  assert.match(TPAG, /coloreTema\(brand\.tema, "accent"\)/);
  assert.match(TPAG, /\{brand\.logo && <Immagine class="tbl-logo"[^>]*width=\{220\} height=\{72\}/,
    "il logo e' tornato un tag immagine nudo: senza misure la pagina salta mentre carica");
  assert.match(TPAG, /font-family: var\(--font-body\)/);
  assert.match(TPAG, /font-family: var\(--font-title\)/);
  // E i colori restano VARIABILI: una riga nel foglio di stile del cliente
  // vince su tutto, senza toccare il motore.
  assert.match(TPAG, /style=\{stileTema\}/);

  /* ⚠️ LE REGOLE STANNO IN UN FILE CHE NON ARRIVA A `db.ts`. Quello crea il
     client Supabase all’import e lancia senza le variabili d’ambiente: con
     l’elenco delle chiavi dentro `brandPubblico`, la prova che lo importa non
     partirebbe nemmeno e vitest la conterebbe come zero. Stessa divisione di
     `ordiniRegole`/`ordiniOpzioni` e `stampaRegole`/`stampaCoda`. */
  const brandRegole = nudo("src/lib/brandRegole.ts");
  assert.doesNotMatch(brandRegole, /from "\.\/admin\/sede"|from "\.\/db"/,
    "brandRegole ha un import che porta a db.ts: le prove che lo importano smettono di partire");
  assert.match(brandRegole, /export const CHIAVI_BRAND/);

  const brandLib = nudo("src/lib/brandPubblico.ts");
  /* ⚠️ `leggiConfig(ambito)`, non `supabaseAdmin` a mano: in un gruppo con più
     punti il logo e i colori possono essere diversi per sede, e una lettura
     senza ambito darebbe il marchio del primo. */
  assert.match(brandLib, /leggiConfig\(ambito, CHIAVI_BRAND\)/);
  assert.doesNotMatch(brandLib, /supabaseAdmin/);
  // ⚠️ E non lancia mai: un database muto dà una pagina sobria, non rotta.
  assert.match(brandLib, /return \{ nome: "", logo: "", favicon: "\/favicon\.svg", tema: \{\} \};/);
});

test("i campi del modulo non scendono sotto i 16px", () => {
  /* ⚠️ Sotto i 16px iOS ZOOMA sul campo appena lo si tocca, e chi ordina si
     ritrova la pagina ingrandita e storta — con una mano sola, in piedi, al
     tavolo. La stessa regola c'è già per il widget prenotazioni. */
  assert.match(TPAG, /\.tbl-input \{[^}]*font-size: 16px/);
});
