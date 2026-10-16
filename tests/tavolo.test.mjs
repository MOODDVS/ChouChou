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
  avvisaIlCliente, prossimaApertura, RIPIEGO_ORDINI, RIPIEGO_ORDINI_SCELTA, CHIAVI_ORDINI,
} from "../src/lib/ordiniRegole.ts";
// ⚠️ Le regole del piano di sala stanno in un file loro: chi sono i tavoli
// veri non e' una domanda sugli ordini, e `planSalle.ts` non si puo'
// importare in vitest (arriva a db.ts).
import { tavoliDelPiano, tavoliPresiAlQr, tavoliApertiAlQr, inizialeDi, durateDelServizio } from "../src/lib/pianoSalaRegole.ts";
import { urlConSede } from "../src/lib/sedeUrl.ts";
import { riconosciSede } from "../src/lib/admin/sedeRegole.ts";
import { immagineDelLocale } from "../src/lib/brandRegole.ts";
import { piattiInVetrina } from "../src/lib/vetrinaRegole.ts";
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
  assert.match(opzioni, /leggi\("restaurant_tables", ambito, "id, name, zone"\)/,
    "la presenza dei tavoli non si legge piu' dalla mappa: tornerebbe a essere una cosa da tenere d'accordo a mano");
  /* ⚠️ `reservation_plan_mode` dice «i posti li conta il piano della sala»,
     che e' un'altra domanda: un locale puo' avere i tavoli disegnati e
     contare i posti per zona. Usarla qui spegnerebbe la scelta del tavolo a
     chi i tavoli ce li ha. */
  assert.doesNotMatch(opzioni, /reservation_plan_mode/,
    "opzioniTavolo guarda reservation_plan_mode: e' un'altra domanda");
  // Lettura muta → nessun tavolo: si chiede solo il nome, e si ordina.
  assert.match(opzioni, /if \(righe\.error\) return \[\];/,
    "la lettura muta non rende piu' un elenco vuoto: pretenderebbe un tavolo che nessuna lista puo' confermare");
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
  // Al posto dell'ora: QUALE tavolo e IN QUANTI, disegnati dalla pagina.
  assert.match(OAPP, /\{inSala \? \(\n\s*tavolo\.campi\n/);
  assert.match(OAPP, /\{!inSala && \(/, "cognome e telefono si chiedono anche in sala");
  assert.match(OAPP, /\(inSala \|\| slot !== null\) &&/);
  assert.match(OAPP, /\(inSala \|\| cognome\.trim\(\) !== ""\) &&/);
  assert.match(OAPP, /\(inSala \|\| telefono\.trim\(\) !== ""\) &&/);
  // E al checkout si manda il servizio al posto dello slot.
  assert.match(OAPP, /\? \{\n\s*service: "table",\n\s*reservation_id: sessione\.reservationId,/);
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
  assert.match(TORD, /ricorda\(CHIAVE, JSON\.stringify\(\{ id: dati\.reservation_id \}\)\);/);
  assert.match(TORD, /reservation_id: leggiSessione\(\)\?\.id/);
  // ⚠️ E in navigazione privata non deve morire: si ordina, non si riprende.
  assert.match(TORD, /function ricorda[\s\S]*?try \{\s*window\.localStorage\.setItem/);
  assert.match(TORD, /function richiama[\s\S]*?try \{\s*const raw = window\.localStorage\.getItem\(chiave\);/);
});

test("il messaggio del server non arriva mai grezzo al cliente", () => {
  /* ⚠️ `/api/table-session` risponde in una lingua sola, e di proposito: i
     suoi messaggi sono per i log. Mostrarli vorrebbe dire «commande a table
     non activee» sul telefono di un cliente. */
  assert.match(TORD, /: testi\.errGenerico,/);
  assert.doesNotMatch(TORD, /errore: String\(dati\.error/);
  assert.doesNotMatch(TORD, /errore: e[,\s}]/, "la stringa grezza del server arriva al cliente");
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
  assert.match(brandLib, /return \{ nome: "", logo: "", favicon: "\/favicon\.svg", tema: \{\}, immagine: "" \};/);
});

test("i campi del modulo non scendono sotto i 16px", () => {
  /* ⚠️ Sotto i 16px iOS ZOOMA sul campo appena lo si tocca, e chi ordina si
     ritrova la pagina ingrandita e storta — con una mano sola, in piedi, al
     tavolo. La stessa regola c'è già per il widget prenotazioni. */
  assert.match(TPAG, /\.tbl-input \{[^}]*font-size: 16px/);
});


/* ==========================================================================
   LA PAGINA DEL QR SU UN TELEFONO.

   ⚠️ Si apre in piedi, con una mano, davanti a qualcuno che non ha chiesto
   niente a nessuno: ogni dubbio costa un cliente che chiude la pagina e
   chiama il cameriere.
   ========================================================================== */

test("il fondo copre tutta la pagina, non solo la colonna", () => {
  /* ⚠️ Sul <main> il fondo del tema si fermava a 34rem e lasciava bianco
     tutt'intorno: su un telefono si vede poco, su un tablet appoggiato al
     bancone si vede benissimo, e sembra una pagina rotta. */
  assert.match(TPAG, /<body style=\{stileTema\}>/);
  assert.match(TPAG, /body \{ --tbl-bg: #fff;[\s\S]{0,400}?background: var\(--tbl-bg\)/,
    "il fondo non e' piu' sul body: torna la cornice bianca");
  assert.match(TPAG, /min-height: 100dvh/);
});

test("il tavolo sta in cima, subito, e resta li' mentre si scorre", () => {
  /* ⚠️ Era il primo campo del pannello dei dati, cioe' l'ultima cosa che si
     vedeva. Il percorso in tre passi e' stato tolto il 16/10/2026: al suo
     posto la barra del tavolo, fissa in alto. */
  assert.doesNotMatch(TORD, /tbl-passi|function percorso/, "il percorso in tre passi e' tornato");
  assert.match(TORD, /\{conBarra && \(\s*<div className=\{`tbl-barra\$\{compatta \? " tbl-barra--compatta" : ""\}`\}>\s*<div className="tbl-barra-fondo" ref=\{fondoRef\}>/);
  assert.match(TORD, /const conBarra = conTavoli && !chiusoTesto;/);
  assert.match(TPAG, /\.tbl-barra \{ position: sticky; top: 0;/);
  // Le categorie si mettono SOTTO la barra, con l'altezza misurata.
  const css = leggi("src/components/TableOrder.css");
  assert.match(css, /position: sticky; top: var\(--tbl-barra-h, 0px\);/);
  assert.match(TORD, /"--tbl-barra-piena": `\$\{altezzaPiena\}px`/);
  assert.doesNotMatch(TORD, /"--tbl-barra-h":/, "inline vincerebbe sulla barra stretta");
  assert.match(css, /:where\(\.tbl-pagina--barra\) \{ --tbl-barra-h: var\(--tbl-barra-piena, 0px\); \}/);
  // Nel pannello dei dati, se il tavolo manca, lo si ricorda vicino al bottone.
  assert.match(TORD, /\{conTavoli && !scelto && \(\s*<button type="button" className="tbl-scegli tbl-scegli--manca"/);
});

test("il tavolo si TOCCA, non si scrive", () => {
  /* ⚠️ Un campo libero produce «7», «tavolo 7», «7 terrazza» e «8» battuto per
     sbaglio: il server rifiuta i primi tre e accetta il quarto, che e' il
     peggiore — i piatti partono per un tavolo dove siede qualcun altro. */
  assert.doesNotMatch(TORD, /type="text" inputMode="numeric"/, "il tavolo si scrive ancora a mano");
  assert.doesNotMatch(TORD, /<select/, "il tavolo e' tornato una tendina");
  // Tre stati: un bottone solo, la griglia aperta, il quadrato scelto.
  assert.match(TORD, /className="tbl-scegli"/);
  assert.match(TORD, /\{sceltaAperta && \(/);
  assert.match(TORD, /className=\{`tbl-tav tbl-tav--scelto/);
  // Si tiene l'ID: un tavolo rinominato stasera manderebbe i piatti altrove,
  // e due zone possono avere tutte e due un «3».
  assert.match(TORD, /setTavolo\(t\.id\);\s*chiudiRiquadro\(\);/);
  /* ⚠️ Ma il QR puo' portare un NOME (`?table=7`): il quadrato deve mostrare
     lo stesso il tavolo giusto, o il cliente crede di non averlo scelto. */
  assert.match(TORD, /t\.name\.trim\(\)\.toLowerCase\(\) === tavolo\.trim\(\)\.toLowerCase\(\)/);
  // Le zone diventano gruppi solo quando ce n'e' piu' d'una.

  // Sei colonne, e i quadrati hanno un fondo loro: su un fondo scuro un bordo
  // sottile sparisce e si tocca a caso.
  assert.match(TPAG, /grid-template-columns: repeat\(6, 1fr\)/);
  assert.match(TPAG, /\.tbl-tav \{[^}]*background: var\(--tbl-card\)/);
  /* ⚠️ NIENTE NOMI DI ZONA: in sala il cliente cerca il SUO numero, e
     scriverglieli sopra gli fa leggere qualcosa che non gli serve. */
  assert.doesNotMatch(TORD, /tbl-zona/, "i nomi delle zone sono tornati nella scelta");
  // E l'elenco arriva dal server, letto una volta sola.
  assert.match(TPAG, /tavoliDiSala\(ambito\)/);
  assert.match(nudo("src/lib/ordiniOpzioni.ts"), /return \(await tavoliDiSala\(ambito\)\)\.length;/,
    "i tavoli si leggono due volte: due query per la stessa domanda");
});

test("l'intestazione e' del SITO: l'isola non disegna nessun logo", () => {
  /* ⚠️ Il logo, il menu e i colori del locale vivono nel `Layout` del
     cliente. Il motore non ha un layout da importare — quel file li' non
     esiste — quindi la pagina comincia dai passi: nuda, e giusta. Disegnare
     un logo qui vorrebbe dire due intestazioni su ogni sito vero. */
  assert.doesNotMatch(TORD, /logo/, "l'isola disegna ancora un logo: sul sito del cliente ce ne sarebbero due");
  assert.doesNotMatch(TPAG, /Immagine/, "la pagina disegna ancora il logo");
});

test("l'azione in basso e' quella di OrderApp, non una seconda", () => {
  /* ⚠️ Col menu davanti, il bottone fisso in fondo e' `order-mobcart` di
     OrderApp («voir le panier»). La vecchia barra «Voir la carte» della
     prima schermata non ha piu' niente da fare: lasciarla vorrebbe dire due
     bottoni in fondo allo schermo, uno sopra l'altro. */
  assert.doesNotMatch(TORD, /tbl-azione/);
  assert.doesNotMatch(TPAG, /\.tbl-azione \{/);
  // ⚠️ Sugli iPhone senza tasto casa la barra di sistema coprirebbe meta'
  // del riquadro dei tavoli: il margine resta.
  assert.match(TPAG, /env\(safe-area-inset-bottom/);
});

test("le parole della scelta del tavolo esistono in tutte e cinque le lingue", () => {
  for (const l of ["fr", "en", "it", "nl", "es"]) {
    const i = TPAG.indexOf(`\n  ${l}: {`);
    assert.ok(i > 0, `manca la lingua ${l}`);
    const blocco = TPAG.slice(i, i + 900);
    for (const k of ["tavolo", "scegli", "scegliTavolo"]) {
      assert.ok(blocco.includes(`${k}:`), `${k} manca in ${l}`);
    }
  }
});


test("la scelta del tavolo e' un modale, e se ne esce", () => {
  /* ⚠️ Fuori dal campo, non dentro: dentro, lo sfondo scuro avrebbe coperto
     solo quel pezzo di pagina. E si chiude toccando il fondo o con Esc — chi
     apre per sbaglio deve poterne uscire senza scegliere un tavolo a caso. */
  assert.match(TORD, /role="dialog"[\s\S]{0,120}aria-modal="true"/);
  // Si chiude scendendo (`chiudiRiquadro`), col fondo o con Esc.
  assert.match(TORD, /onClick=\{chiudiRiquadro\}/);
  assert.match(TORD, /if \(e\.key === "Escape"\) chiudiRiquadro\(\)/);
  /* ⚠️ Il riquadro non chiude: il tocco su un tavolo non deve valere anche
     come tocco sul fondo, o si sceglierebbe e si richiuderebbe due volte. */
  assert.match(TORD, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  // ⚠️ Una sala da sessanta tavoli non ci sta: senza scorrimento gli ultimi
  // non si raggiungono.
  assert.match(TPAG, /\.tbl-modale-box \{[^}]*max-height: 80vh; overflow: auto/);
});

test("l'aiuto del tavolo e' un bottone, non un `title`", () => {
  /* ⚠️ Su un telefono il suggerimento del sistema non esiste: non c'è niente
     da sorvolare, e quella frase resterebbe scritta solo per chi usa il
     mouse. Qui si tocca e compare — e il bottone è 28px, perché si deve
     poter prendere col dito. */
  assert.match(TORD, /className="tbl-aiuto-btn"/);
  assert.match(TORD, /aria-expanded=\{aiutoAperto\}/);
  assert.match(TORD, /\{aiutoAperto && <p className="tbl-aiuto-testo">\{testi\.tavoloAiuto\}<\/p>\}/);
  assert.match(TPAG, /\.tbl-aiuto-btn \{ width: 28px; height: 28px/);
});

test("il titolo e' centrato e maiuscolo dal CSS, non dai testi", () => {
  /* ⚠️ Maiuscolo scritto nelle traduzioni vorrebbe dire cinque stringhe da
     riscrivere il giorno che il cliente lo vuole normale. Dal CSS si toglie
     una riga. */
  // Il titolo non si vede piu' (il percorso e la vetrina dicono gia' dove si
  // e'), ma resta per i lettori di schermo: nascosto dal CSS, non tolto.
  assert.match(TPAG, /\.tbl-titolo \{[^}]*clip: rect\(0 0 0 0\)/);
  assert.match(TORD, /<h1 className="tbl-titolo">\{testi\.titolo\}<\/h1>/);
  assert.doesNotMatch(TPAG, /titolo: "COMMANDER/, "il maiuscolo e' finito nelle traduzioni");
});


test("le persone si scelgono con un tocco, come nel widget prenotazioni", () => {
  /* ⚠️ Un campo numerico apre la tastiera del telefono, che copre mezzo
     schermo e va poi chiusa a mano: chi è seduto risponde «due» con un dito.
     È lo stesso modo di `rw-pgrid` nel widget prenotazioni — un gesto solo
     per tutto il motore, non due invenzioni diverse. */
  assert.match(TORD, /className="tbl-pgrid"/);
  assert.match(TORD, /Array\.from\(\{ length: PERSONE_PASTIGLIE \}/);
  assert.match(leggi("src/components/ReservationWidget.astro"), /class="rw-pgrid"/,
    "il widget ha cambiato modo: ricontrollare che i due gesti restino uguali");
  /* ⚠️ Oltre il cinque NON si taglia: un tavolo da otto esiste (due tavoli
     uniti), e scrivere cinque al posto di otto vuol dire tre coperti in meno
     nel conto della sera, ogni volta. */
  assert.match(TORD, /const PERSONE_PASTIGLIE = 5;/);
  assert.match(TORD, /\{PERSONE_PASTIGLIE \+ 1\}\+/, "l'ultima pastiglia deve dire «6+», non «5+»");
  assert.match(TORD, /\{oltre && \(/);
  // Chi torna con «8» ritrova «6+» acceso e il suo otto nel campo.
  assert.match(TORD, /useState\(Number\(ricordata\.persone\) > PERSONE_PASTIGLIE\)/);
  assert.match(TORD, /min=\{PERSONE_PASTIGLIE \+ 1\} max=\{100\}/);
  // ⚠️ 44px d'altezza: la misura minima di un bersaglio da toccare in piedi,
  // con una mano sola. In larghezza: sei colonne uguali, una riga sola.
  assert.match(TPAG, /\.tbl-p \{ min-width: 0; min-height: 44px/);
  assert.match(TPAG, /\.tbl-pgrid \{ display: grid; grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
});

/* ==================================================================
   I TAVOLI FANTASMA

   ⚠️ Il guasto vero, visto il 16/10/2026 in un selettore con 21 quadrati
   per 19 tavoli: due «T1» e due «T2». I piani di sala ne mostravano 7 + 8
   + 4, perche' il piano chiede i tavoli UNA ZONA ALLA VOLTA. Le righe
   rimaste agganciate a una section cancellata non compaiono in nessun
   piano — e una lettura senza filtro le ripescava tutte.
   ================================================================== */

const SEZIONI = [{ name: "Interno" }, { name: "Terrazzo" }, { name: "Strada" }];

test("un tavolo agganciato a una section che non esiste piu' non si sceglie", () => {
  const righe = [
    { id: "a", name: "T1", zone: "Interno" },
    { id: "b", name: "T1", zone: "Sala vecchia" },   // section cancellata
    { id: "c", name: "T2", zone: "Sala vecchia" },   // section cancellata
    { id: "d", name: "F1", zone: "Terrazzo" },
  ];
  const tenuti = tavoliDelPiano(righe, JSON.stringify(SEZIONI));
  assert.deepEqual(tenuti.map((t) => t.id), ["a", "d"]);
  // ⚠️ Il punto non e' «sono due»: e' che il nome NON si ripete piu'. Due
  // quadrati uguali e chi e' seduto tocca a caso, e il piatto parte.
  assert.equal(new Set(tenuti.map((t) => t.name)).size, tenuti.length);
});

test("nessuna section configurata: si tiene tutto, la sala non si svuota", () => {
  // ⚠️ Un locale che non ha mai aperto i Réglages delle sections ha i tavoli
  // e nessuna zona dichiarata. Filtrare qui vorrebbe dire spegnergli il QR.
  const righe = [{ id: "a", name: "1", zone: "Salle" }, { id: "b", name: "2", zone: "Salle" }];
  assert.equal(tavoliDelPiano(righe, "[]").length, 2);
  assert.equal(tavoliDelPiano(righe, "").length, 2);
  assert.equal(tavoliDelPiano(righe, "{non e' json").length, 2);
});

test("l'ordine e' quello delle sections, non l'alfabeto", () => {
  // «Strada» prima di «Terrazzo» per l'alfabeto, ma il cameriere gira
  // Interno → Terrazzo → Strada, ed e' l'ordine che lui ha messo.
  const righe = [
    { id: "s", name: "S1", zone: "Strada" },
    { id: "t", name: "F1", zone: "Terrazzo" },
    { id: "i", name: "T1", zone: "Interno" },
  ];
  assert.deepEqual(tavoliDelPiano(righe, JSON.stringify(SEZIONI)).map((t) => t.zone),
    ["Interno", "Terrazzo", "Strada"]);
});

test("T10 viene dopo T2, non prima", () => {
  // ⚠️ Come testo «T10» < «T2». In una sala da dodici tavoli l'elenco
  // diventava T1, T10, T11, T2 — e il proprio numero non si trova piu'.
  const righe = [
    { id: "a", name: "T10", zone: "Interno" },
    { id: "b", name: "T2", zone: "Interno" },
    { id: "c", name: "T1", zone: "Interno" },
  ];
  assert.deepEqual(tavoliDelPiano(righe, JSON.stringify(SEZIONI)).map((t) => t.name),
    ["T1", "T2", "T10"]);
});

test("una riga senza nome o senza zona non e' un tavolo", () => {
  const righe = [
    { id: "a", name: "", zone: "Interno" },
    { id: "b", name: "T1", zone: "" },
    { id: "", name: "T2", zone: "Interno" },
    { id: "d", name: "T3", zone: "Interno" },
  ];
  assert.deepEqual(tavoliDelPiano(righe, JSON.stringify(SEZIONI)).map((t) => t.id), ["d"]);
});

test("niente righe, o righe che non sono un elenco: elenco vuoto, mai un errore", () => {
  assert.deepEqual(tavoliDelPiano(null, "[]"), []);
  assert.deepEqual(tavoliDelPiano(undefined, null), []);
  assert.deepEqual(tavoliDelPiano("boh", "[]"), []);
});

test("la lettura dei tavoli chiede anche le sections, se no il filtro non esiste", () => {
  // ⚠️ Ancora sul codice: senza questa riga `tavoliDelPiano` riceverebbe
  // sempre «nessuna section» e terrebbe tutto, fantasmi compresi — la prova
  // di sopra resterebbe verde e il selettore tornerebbe sbagliato.
  const opzioni = nudo("src/lib/ordiniOpzioni.ts");
  assert.match(opzioni, /leggiConfig\(ambito, \["reservation_zones"\]\)/,
    "tavoliDiSala deve leggere reservation_zones");
  assert.match(opzioni, /tavoliDelPiano\(righe\.data \?\? \[\], cfg\.valori\.get\("reservation_zones"\)/,
    "la regola pura deve ricevere le sections configurate");
});

test("gli orari arrivano dal database con i secondi, e devono valere lo stesso", () => {
  /* ⚠️ IL GUASTO VERO, 16/10/2026. `lunch_open` e compagni sono colonne
     `time` di Postgres: tornano «12:00:00», non «12:00». `minuti()` aveva
     l'ancora stretta, non li riconosceva, e `servizioInCorso` rispondeva
     CHIUSO a qualunque ora — su qualunque ristorante, sempre. Dal tavolo si
     leggeva «Le service est fermé pour le moment» alle 13:40 di un venerdi'
     di servizio, e l'ordine non partiva mai.

     ⚠️ Queste prove erano verdi mentre succedeva, perche' gli orari finti li
     scrivevo io «12:00». Una prova costruita sulla mia idea del dato non
     controlla il dato: qui sotto il formato e' quello che manda il database. */
  const DB = {
    lunch_active: true, lunch_open: "12:00:00", lunch_close: "14:30:00",
    dinner_active: true, dinner_open: "19:00:00", dinner_close: "22:30:00",
  };
  assert.equal(servizioInCorso(DB, "13:40"), "midi");
  assert.equal(servizioInCorso(DB, "20:00"), "soir");
  assert.equal(servizioInCorso(DB, "16:00"), null, "fra i due servizi resta chiuso");
  assert.equal(servizioInCorso(DB, "11:59"), null);
  // Anche l'ora chiesta puo' avere i secondi.
  assert.equal(servizioInCorso(DB, "13:40:12"), "midi");
  // E il formato corto non deve smettere di funzionare.
  assert.equal(servizioInCorso({ lunch_active: true, lunch_open: "12:00", lunch_close: "14:30" }, "12:30"), "midi");
  // ⚠️ Largo sui secondi, non su tutto: un orario assurdo resta rifiutato.
  assert.equal(servizioInCorso({ lunch_active: true, lunch_open: "99:99:99", lunch_close: "14:30:00" }, "12:30"), null);
  assert.equal(servizioInCorso({ lunch_active: true, lunch_open: "12:00:00", lunch_close: "14:30:00" }, "mezzogiorno"), null);
});

test("la cena oltre mezzanotte regge anche con i secondi", () => {
  const notte = {
    lunch_active: true, lunch_open: "12:00:00", lunch_close: "14:30:00",
    dinner_active: true, dinner_open: "19:00:00", dinner_close: "01:00:00",
  };
  assert.equal(servizioInCorso(notte, "23:30"), "soir");
  assert.equal(servizioInCorso(notte, "00:30"), "soir");
  assert.equal(servizioInCorso(notte, "01:00"), null);
});

/* ==================================================================
   IL LINK DEL QR — con la sede dentro, sempre

   ⚠️ Visto il 16/10/2026: tre sedi, una sola accesa. `/table` senza sede
   ripiega sulla PRIMA sede attiva — giusto per caso finche' ne e' accesa
   una, sbagliato il giorno in cui se ne riaccende un'altra. Un QR stampato
   vive anni su un tavolo: deve dire da se' di quale locale e'.
   ================================================================== */

test("il link del QR porta la sede, e a sede unica resta /table", () => {
  assert.equal(urlConSede("https://resto.be/table", "5cf85a6a-3342-44c6-9831-d8b8495fed3f"),
    "https://resto.be/table?sede=5cf85a6a-3342-44c6-9831-d8b8495fed3f");
  // Installazione a punto unico: nessun parametro, l'URL di sempre.
  assert.equal(urlConSede("https://resto.be/table", ""), "https://resto.be/table");
});

test("il link lo compone il SERVER, una volta sola", () => {
  // ⚠️ La regola sta in `lib/admin/linkTavolo.ts` (16/10/2026): la usano
  // i Réglages e i cartoncini da stampare, e deve restare UNA.
  const api = nudo("src/pages/api/admin/settings.ts");
  assert.match(api, /const linkTavoloBase = await linkBaseTavolo\(request, ambito\);/);
  assert.match(api, /link_tavolo: linkTavoloBase,/);
  const lt = nudo("src/lib/admin/linkTavolo.ts");
  assert.match(lt, /if \(ambito\.modo === "tutte"\) return "";/,
    "con «tutte le sedi» si darebbe un link senza sede: e' il guasto da cui nasce tutto questo");
  assert.match(lt, /urlConSede\(\s*`\$\{indirizzoPubblico\(request\)\}\/table`,\s*ambito\.modo === "sede" \? await nomeBreveSede\(ambito\.id\) : "",?\s*\)/,
    "il link non passa piu' dalla regola comune della sede");
  // Col nome breve, e l'id solo se il nome breve non c'e'.
  assert.match(lt, /find\(\(s\) => s\.id === id\)\?\.slug\?\.trim\(\) \|\| id;/);
  // E i cartoncini stampati usano la stessa.
  assert.match(nudo("src/pages/api/admin/qr.ts"), /linkBaseTavolo\(request, ambito\)/);

  // ⚠️ La pagina lo MOSTRA, non lo compone: una seconda ricetta del link
  // sarebbe la prossima a dimenticarsi `?sede=`.
  const pag = nudo("src/pages/admin/settings.astro");
  assert.match(pag, /campoLink\.value = dati\.link_tavolo \?\? ""/);
  assert.doesNotMatch(pag, /\/table\?sede=/, "la pagina si compone il link da sola");
  // E dichiara il campo nel tipo dei dati, se no astro check non lo vede.
  assert.match(pag, /link_tavolo\?: string/);
});

test("senza link la riga del QR non compare", () => {
  // Un campo vuoto con «Copier» accanto copierebbe il niente.
  const pag = nudo("src/pages/admin/settings.astro");
  assert.match(pag, /const acceso = Boolean\(swTavolo\?\.checked && dati\.link_tavolo\);/);
  assert.match(pag, /if \(rigaLink\) rigaLink\.style\.display = acceso && modoQrOra === "unico" \? "" : "none";/);
});

test("le parole del link del QR esistono in tutte e cinque le lingue", () => {
  for (const k of ["set.ord.tableLink", "set.ord.tableLinkHint", "set.ord.tableLinkCopied", "common.copy"]) {
    for (const l of ADMIN_LANG_CODES) {
      const testo = adminT(l)(k);
      assert.ok(testo && testo !== k, `${k} manca in ${l}`);
    }
  }
});

/* ==================================================================
   CHIUSO: QUANDO RIAPRE
   ================================================================== */

test("chiuso nel pomeriggio: si dice a che ora riapre", () => {
  // Il caso vero del 16/10/2026: una sede aperta solo la sera, alle 15:00.
  const sera = { lunch_active: true, lunch_open: "17:00:00", lunch_close: "23:00:00", dinner_active: false };
  assert.equal(prossimaApertura(sera, "15:00"), "17:00");
  const due = {
    lunch_active: true, lunch_open: "12:00:00", lunch_close: "14:30:00",
    dinner_active: true, dinner_open: "19:00:00", dinner_close: "22:30:00",
  };
  assert.equal(prossimaApertura(due, "10:00"), "12:00", "la prima delle due, non l'ultima");
  assert.equal(prossimaApertura(due, "16:00"), "19:00");
});

test("a fine giornata non si promette niente", () => {
  const due = {
    lunch_active: true, lunch_open: "12:00:00", lunch_close: "14:30:00",
    dinner_active: true, dinner_open: "19:00:00", dinner_close: "22:30:00",
  };
  assert.equal(prossimaApertura(due, "23:00"), null);
  // Una fascia spenta non riapre, e un'ora illeggibile non diventa una promessa.
  assert.equal(prossimaApertura({ ...due, dinner_active: false }, "16:00"), null);
  assert.equal(prossimaApertura({ lunch_active: true, lunch_open: "boh", lunch_close: "14:00" }, "09:00"), null);
  assert.equal(prossimaApertura(null, "09:00"), null);
  assert.equal(prossimaApertura(due, "mezzogiorno"), null);
});

/* ==================================================================
   SCELTA → DATI → PAGAMENTO, e il servizio chiuso

   ⚠️ Chiesto il 16/10/2026: prima il menu, poi chi sei, poi si paga. La
   versione di prima chiedeva tavolo, nome, coperti ed email PRIMA di far
   vedere la carta, apriva la sessione subito (un tavolo «seduto» per chi
   guardava e se ne andava) e chiedeva nome ed email due volte.
   ================================================================== */

test("la sessione al tavolo si apre al momento di pagare, non prima", () => {
  // In OrderApp: dentro `paga()`, prima della chiamata a /api/checkout.
  const iPaga = OAPP.indexOf("async function paga()");
  const iApri = OAPP.indexOf("await tavolo.apriSessione(", iPaga);
  const iCheckout = OAPP.indexOf('conSede("/api/checkout")', iPaga);
  assert.ok(iPaga > 0 && iApri > iPaga, "la sessione non si apre piu' dentro paga()");
  assert.ok(iApri < iCheckout, "si incassa prima di aver aperto la sessione");
  // Se la sessione e' rifiutata, ci si ferma: niente checkout.
  assert.match(OAPP, /if \(!s\.ok\) \{\n\s*setErroreCheckout\(s\.errore\);\n\s*setInvio\(false\);\n\s*return;/);
  // E nella pagina del tavolo non c'e' piu' una schermata che la apra prima.
  assert.doesNotMatch(TORD, /if \(sessione\) \{/);
});

test("nome ed email si chiedono una volta sola", () => {
  // Li chiede OrderApp, come sempre. La pagina del tavolo aggiunge solo
  // tavolo e coperti, e li passa nel pannello dei dati.
  // ⚠️ Fuori dal riquadro della campanella: li' il nome e' quello di chi
  // CHIAMA in una sala senza tavoli, e l'ordine non c'entra.
  const senzaCampanella = TORD.replace(/<form\s+className="tbl-modale-box tbl-chiama-form"[\s\S]*?<\/form>/, "");
  assert.notEqual(senzaCampanella, TORD, "il riquadro del nome della campanella non si trova piu'");
  assert.doesNotMatch(senzaCampanella, /autoComplete="given-name"/, "il nome si chiede due volte");
  assert.doesNotMatch(TORD, /type="email"/, "l'email si chiede due volte");
  assert.match(TORD, /tavolo=\{\{ campi, pronto, emailObbligatoria: avvisa, apriSessione, onVista: setVista \}\}/);
  // Il bottone di pagamento non si accende senza tavolo e coperti.
  assert.match(OAPP, /\(!inSala \|\| tavolo\.pronto\) &&/);
});

test("pronto vuol dire un tavolo che esiste", () => {
  // Un `?table=` storto nel QR lascerebbe un testo che nessun tavolo conferma.
  assert.match(TORD, /const pronto = Number\(persone\) >= 1 && \(!conTavoli \|\| scelto !== null\);/);
  // E al server va l'ID del tavolo scelto, mai il nome.
  assert.match(TORD, /\.\.\.\(conTavoli && scelto \? \{ table: scelto\.id \} : \{\}\)/);
});

test("a servizio chiuso: niente menu, niente barra, modale che dice quando", () => {
  assert.match(TPAG, /statoServizioSala\(ambito\)/);
  assert.match(TPAG, /: servizio\.aperto \? null : \{ riapre: servizio\.riapre, motivo: "orario" \}\}/);
  // Il menu non si monta.
  assert.match(TORD, /\{!chiusoTesto && \(\n\s*<OrderApp/);
  // Nemmeno la barra del tavolo: non c'e' niente da ordinare.
  assert.match(TORD, /const conBarra = conTavoli && !chiusoTesto;/);
  // Il modale dice l'ora, e non si chiude: dietro non c'e' niente da fare.
  assert.match(TORD, /testi\.chiusoRiapre\.replace\("\{ora\}", chiuso\.riapre\)/);
  assert.match(TORD, /role="alertdialog"/);
  assert.match(TORD, /window\.location\.reload\(\)/);
});

test("se chiude mentre si ordina, si apre lo stesso modale", () => {
  // Chi ha aperto il menu alle 14:25 e paga alle 14:35: stessa notizia,
  // stesso modo di dirla — non una riga rossa in fondo al carrello.
  assert.match(TORD, /if \(e\.includes\("ferme"\)\) \{\n\s*setChiusoTesto\(testi\.errChiuso\);/);
});

test("la pagina chiede «aperto?» con la stessa regola delle rotte", () => {
  const opz = nudo("src/lib/ordiniOpzioni.ts");
  const i = opz.indexOf("export async function statoServizioSala");
  assert.ok(i > 0, "statoServizioSala non c'e' piu'");
  const corpo = opz.slice(i, i + 700);
  // Gli stessi tre passi di /api/table-session: fuso, orari di oggi, regola.
  assert.match(corpo, /setZone\(await fusoDi\(ambito\)\)/);
  assert.match(corpo, /configGiornoEffettiva\(ora, ambito\)/);
  assert.match(corpo, /servizioInCorso\(cfg, hhmm\)/);
  // Illeggibile = chiuso, come le rotte: meglio il modale di un rifiuto alla cassa.
  assert.match(corpo, /catch \{\n\s*return \{ aperto: false, riapre: null \};/);
});

test("le parole del modale chiuso esistono in tutte e cinque le lingue", () => {
  for (const l of ["fr", "en", "it", "nl", "es"]) {
    const i = TPAG.indexOf(`\n  ${l}: {`);
    assert.ok(i > 0, `manca la lingua ${l}`);
    const blocco = TPAG.slice(i, i + 1100);
    for (const k of ["chiusoTitolo", "chiusoRiapre", "chiusoOggi", "aggiorna"]) {
      assert.ok(blocco.includes(`${k}:`), `${k} manca in ${l}`);
    }
    // ⚠️ `{ora}` deve esserci, se no l'orario non entra mai nella frase.
    assert.ok(/chiusoRiapre: "[^"]*\{ora\}/.test(blocco), `chiusoRiapre senza {ora} in ${l}`);
  }
});

test("il menu al tavolo ha un vestito di base, e non comanda", () => {
  /* ⚠️ Visto il 16/10/2026: appena il menu e' passato per primo, la carta e'
     uscita coi bottoni grigi del sistema — `order-*` lo veste la pagina
     /order del cliente, che qui non si carica. */
  assert.match(TPAG, /import "\.\.\/components\/TableOrder\.css";/);
  const css = readFileSync("src/components/TableOrder.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // ⚠️ Ogni regola a specificita' ZERO e chiusa dentro `.tbl-pagina`: un sito
  // che ha gia' vestito /order deve vincere con una classe sola, e la sua
  // pagina /order non deve essere toccata.
  // I passi delle animazioni (`from`, `to`) non sono regole della pagina.
  const selettori = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim())
    .filter((sel) => !/^(from|to|\d+%)$/.test(sel));
  assert.ok(selettori.length > 40, "il foglio e' sparito o non si legge");
  // Un pseudo-elemento sta FUORI dalle parentesi (dentro il browser butta la
  // regola intera, in silenzio): e' l'unica cosa ammessa dopo `:where(...)`.
  const fuori = selettori.filter((sel) => !/^:where\(\.tbl-pagina[^]*\)(::[\w-]+)?$/.test(sel));
  assert.deepEqual(
    selettori.filter((sel) => /:where\([^)]*::/.test(sel)), [],
    "un pseudo-elemento dentro :where(): il browser butta via la regola");
  assert.deepEqual(fuori, [], "regole che comandano sul sito o escono dalla pagina del tavolo");
  assert.doesNotMatch(css, /!important/);
  // Al tavolo «choisissez une heure» non vuol dire niente.
  assert.match(TPAG, /fillAll: RIEMPI\[lang\] \?\? RIEMPI\.fr,/);
});

test("sotto il titolo la foto del locale: prima quella della sede", () => {
  assert.equal(immagineDelLocale("https://x.be/jourdan.jpg", ["https://x.be/hero.jpg"]), "https://x.be/jourdan.jpg");
  // La sede non ne ha: la prima immagine del sito che c'e'.
  assert.equal(immagineDelLocale("", ["", "/img/sala.jpg", "https://x.be/h3.jpg"]), "/img/sala.jpg");
  // Niente di valido: nessuna immagine, e nessun riquadro vuoto.
  assert.equal(immagineDelLocale(null, ["javascript:alert(1)", "foto sala"]), "");
  assert.equal(immagineDelLocale(undefined, []), "");
  // Ora e' il RIPIEGO della vetrina: compare solo se nessun piatto ha una foto.
  assert.match(TORD, /return immagine \? \[\{ id: "locale", src: immagine, nome: "" \}\] : \[\];/);
  assert.match(TPAG, /immagine=\{brand\.immagine\}/);
});

test("un piatto con piu' formati apre il riquadro, e le foto dei piatti si vedono", () => {
  assert.match(TPAG, /sceltaFormato="modale"/);
  assert.match(TPAG, /foto=\{true\}/);
});

/* ==================================================================
   LA VETRINA DEI PIATTI E IL RIQUADRO CHE SALE
   ================================================================== */

const P = (id, extra = {}) => ({ id, name: id, image_url: `https://x/${id}.jpg`, is_sold_out: false, variants: [], ...extra });

test("in vetrina solo piatti che si possono ordinare, e con una foto", () => {
  const menu = [{ items: [
    P("a"),
    P("senzafoto", { image_url: null }),
    P("esaurito", { is_sold_out: true }),
    P("formatifiniti", { variants: [{ sold_out: true }, { sold_out: true }] }),
    P("unformato", { variants: [{ sold_out: true }, { sold_out: false }] }),
  ] }];
  assert.deepEqual(piattiInVetrina(menu).map((p) => p.id), ["a", "unformato"]);
});

test("prima i consigliati, poi i best-seller, poi l'ordine della carta", () => {
  const menu = [
    { items: [P("uno"), P("best", { is_bestseller: true })] },
    { items: [P("due"), P("consiglio", { is_suggestion: true }), P("tre")] },
  ];
  assert.deepEqual(piattiInVetrina(menu).map((p) => p.id), ["consiglio", "best", "uno", "due", "tre"]);
});

test("al massimo otto foto: ogni foto e' un download in 4G", () => {
  const menu = [{ items: Array.from({ length: 20 }, (_, i) => P(`p${i}`)) }];
  assert.equal(piattiInVetrina(menu).length, 8);
  // Un piatto in due categorie non gira due volte.
  assert.equal(piattiInVetrina([{ items: [P("x")] }, { items: [P("x")] }]).length, 1);
});

test("la vetrina si ferma al primo tocco, e non gira con «riduci movimento»", () => {
  assert.match(TORD, /onPointerDown=\{\(\) => \{ toccato\.current = true; \}\}/);
  assert.match(TORD, /if \(!el \|\| toccato\.current \|\| document\.hidden\) return;/);
  assert.match(TORD, /prefers-reduced-motion: reduce\)"\)\.matches\) return;/);
  // Il nome in basso a sinistra, sopra la foto.
  assert.match(TORD, /<figcaption className="tbl-vetrina-nome">\{f\.nome\}<\/figcaption>/);
  assert.match(TPAG, /\.tbl-vetrina-nome \{[^}]*left: 0;[^}]*bottom: 0;[^}]*text-align: left;/);
  // Solo sul menu.
  assert.match(TORD, /\{vista === "menu" && <Vetrina foto=\{vetrina\} nomi=\{testi\.titolo\} \/>\}/);
});

test("il riquadro dei formati sale e scende, e aspetta solo se c'e' da aspettare", () => {
  const css = readFileSync("src/components/TableOrder.css", "utf8");
  assert.match(css, /\.order-modal\) \{ animation: tbl-foglio-sale/);
  assert.match(css, /\.is-uscita \.order-modal\) \{ animation: tbl-foglio-scende/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  // ⚠️ OrderApp aspetta la durata che legge dal CSS — e se il sito non ha
  // animazioni chiude SUBITO: i siti in produzione non devono ritrovarsi un
  // ritardo regalato.
  assert.match(OAPP, /if \(!stile \|\| stile\.animationName === "none" \|\| !durata\) \{\n\s*fine\(\);\n\s*return;/);
  assert.match(OAPP, /if \(!itemModale \|\| modaleInUscita\) return;/);
  // ⚠️ Niente `requestAnimationFrame` per chiudere: a scheda nascosta i
  // fotogrammi si fermano e il riquadro non si chiudeva piu'.
  const i = OAPP.indexOf("function chiudiModale()");
  assert.doesNotMatch(OAPP.slice(i, i + 900), /requestAnimationFrame/);
});

test("senza un modo di pagare il cliente lo sa PRIMA di comporre la cena", () => {
  /* ⚠️ Visto il 16/10/2026: dodici piatti nel carrello, «Commander», e solo
     allora «Les commandes en ligne ne sont pas disponibles». La sede non
     aveva ne' la carta pronta ne' il pagamento sul posto: la pagina lo
     sapeva gia' (`pagamento.nessuno`) e non lo diceva. */
  assert.match(TPAG, /chiuso=\{pagamento\.nessuno\n\s*\? \{ riapre: null, motivo: "pagamento" \}/);
  assert.match(TORD, /const pagamentoAssente = chiuso\?\.motivo === "pagamento";/);
  assert.match(TORD, /\? pagamentoAssente\n\s*\? testi\.nonDisponibileTesto/);
  assert.match(TORD, /\{chiusoTitolo\}<\/p>/);
  for (const l of ["fr", "en", "it", "nl", "es"]) {
    const i = TPAG.indexOf(`\n  ${l}: {`);
    const blocco = TPAG.slice(i, i + 1600);
    assert.ok(blocco.includes("nonDisponibileTitolo:") && blocco.includes("nonDisponibileTesto:"), `manca in ${l}`);
  }
});

test("la sede si riconosce dall'id o dal nome breve", () => {
  const SEDI = [
    { id: "5cf85a6a-3342-44c6-9831-d8b8495fed3f", slug: "schaerbeek" },
    { id: "07857cb4-ef91-479c-9234-d9b7763092d4", slug: "jourdan" },
  ];
  // Il nome breve, anche scritto in maiuscolo su un cartoncino.
  assert.equal(riconosciSede(SEDI, "schaerbeek"), SEDI[0].id);
  assert.equal(riconosciSede(SEDI, "Jourdan"), SEDI[1].id);
  // L'id resta valido per sempre: i QR gia' stampati lo usano.
  assert.equal(riconosciSede(SEDI, SEDI[1].id), SEDI[1].id);
  // Sconosciuta o vuota: nessuna, e chi chiama ripiega come sempre.
  assert.equal(riconosciSede(SEDI, "stockel"), null);
  assert.equal(riconosciSede(SEDI, ""), null);
  // ⚠️ L'id ha la precedenza: uno slug uguale a un id non ruba la sede.
  assert.equal(riconosciSede([{ id: "a", slug: "b" }, { id: "b", slug: "c" }], "b"), "b");
});

test("le rotte pubbliche riconoscono la sede in un posto solo", () => {
  const sede = nudo("src/lib/admin/sede.ts");
  assert.match(sede, /const id = riconosciSede\(sedi, chiesta\);\n\s*if \(id\) return sede_\(id\);/);
});

test("nel riepilogo la foto del piatto e il cestino del motore", () => {
  assert.match(TPAG, /carrelloDettagliato=\{true\}/);
  const css = readFileSync("src/components/TableOrder.css", "utf8");
  // Il cestino: rosso spento, poi la pillola rossa piena — gli stessi valori
  // di `.ibtn-danger` nel pannello.
  const motore = readFileSync("src/styles/button.css", "utf8");
  for (const v of ["rgba(237, 28, 36, 0.25)", "rgba(237, 28, 36, 0.35)", "#a3320f"]) {
    assert.ok(motore.includes(v), `il cestino del motore non usa piu' ${v}: allinea anche TableOrder.css`);
  }
  assert.match(css, /\.order-cart-remove\) \{[^}]*background: rgba\(237, 28, 36, \.25\)/);
  assert.match(css, /\.order-cart-remove\.confirm\),[\s\S]{0,80}\{[^}]*border-radius: 999px;[^}]*background: #a3320f/);
  // − e + con un fondo, non solo il bordo.
  assert.match(css, /\.order-cart-line-controls > button\) \{[^}]*background: rgba\(0, 0, 0, \.25\)/);
});

test("indietro da Stripe, al tavolo, riporta al carrello e non annulla", () => {
  /* ⚠️ Visto il 16/10/2026: «indietro» sul pagamento portava a «Commande
     annulée» e a un link al sito, col carrello sparito dalla vista. Al
     tavolo e' un ripensamento, non un annullamento. */
  assert.match(CK, /if \(aTavolo\) \{\n\s*const u = new URL\(`\$\{siteUrl\.replace\(\/\\\/\$\/, ""\)\}\/table`\);/);
  assert.match(CK, /u\.searchParams\.set\("ripresa", "1"\);/);
  assert.match(CK, /cancelUrl: ritornoTavolo,/);
  // La sede torna com'era arrivata (id o nome breve).
  assert.match(CK, /if \(sedeChiesta\) u\.searchParams\.set\(PARAM_SEDE, sedeChiesta\);/);
  // Da asporto non cambia niente: senza cancelUrl resta /order-cancel.
  const stripe = nudo("src/lib/stripe.ts");
  assert.match(stripe, /cancel_url: cancelUrl \?\? `\$\{siteUrl\}\$\{returnBase \?\? prefix\}\/order-cancel/);
});

test("tornando si riapre sui dati, col carrello e la sala di prima", () => {
  assert.match(TPAG, /const ripresa = Astro\.url\.searchParams\.get\("ripresa"\) === "1";/);
  assert.match(TORD, /vistaIniziale=\{ripresa \? "checkout" : "menu"\}/);
  // Solo col carrello pieno: un carrello vuoto non apre un modulo vuoto.
  assert.match(OAPP, /vistaIniziale === "checkout" && \(salvato\.linee \?\? \[\]\)\.length > 0 \? "checkout" : "menu"/);
  // Tavolo e coperti ricordati; il tavolo del QR vince.
  assert.match(TORD, /useState\(tavoloDaUrl \|\| ricordata\.tavolo \|\| ""\)/);
  // `ripresa` si usa una volta e si toglie dall'indirizzo.
  assert.match(TORD, /u\.searchParams\.delete\("ripresa"\);/);
});

test("il tasto indietro del telefono non lascia il bottone in «paiement…»", () => {
  assert.match(OAPP, /if \(e\.persisted\) setInvio\(false\);/);
  assert.match(OAPP, /return \(\) => window\.removeEventListener\("pageshow", ritorno\);/);
});

/* ==================================================================
   I TAVOLI GIA' APERTI DAL QR SI SPENGONO — quelli prenotati no
   ================================================================== */

const DURATE = { perServizio: { soir: 120, midi: 60 }, ripiego: 90 };
const QR = (id, heure, tables, extra = {}) => ({ id, heure, tables, service_key: "soir", status: "seated", source: "qr", ...extra });

test("un tavolo aperto dal QR e' preso, uno prenotato no", () => {
  const righe = [
    QR("a", "19:30:00", ["t3"]),
    // ⚠️ Prenotazione arrivata a T7: chi l'ha prenotato deve poter ordinare
    // dal suo tavolo, quindi T7 NON si spegne.
    { id: "b", heure: "19:00:00", tables: ["t7"], service_key: "soir", status: "seated", source: "web" },
    { id: "c", heure: "20:00:00", tables: ["t8"], service_key: "soir", status: "confirmed", source: "qr" },
  ];
  assert.deepEqual(tavoliPresiAlQr(righe, "20:00", DURATE), ["t3"]);
});

test("il tavolo si libera da solo alla fine della durata del servizio", () => {
  const r = [QR("a", "19:30:00", ["t3"])];
  assert.deepEqual(tavoliPresiAlQr(r, "21:29", DURATE), ["t3"], "dentro le due ore della cena");
  assert.deepEqual(tavoliPresiAlQr(r, "21:30", DURATE), [], "finite le due ore e' di nuovo libero");
  // I minuti aggiunti a mano allungano la tenuta.
  assert.deepEqual(tavoliPresiAlQr([QR("a", "19:30:00", ["t3"], { extra_minutes: 30 })], "21:45", DURATE), ["t3"]);
  // Servizio sconosciuto: vale il ripiego.
  assert.deepEqual(tavoliPresiAlQr([QR("a", "12:00", ["t1"], { service_key: "boh" })], "13:29", DURATE), ["t1"]);
  assert.deepEqual(tavoliPresiAlQr([QR("a", "12:00", ["t1"], { service_key: "boh" })], "13:30", DURATE), []);
});

test("aperto prima di mezzanotte, ancora preso dopo", () => {
  assert.deepEqual(tavoliPresiAlQr([QR("a", "23:30", ["t3"])], "00:15", DURATE), ["t3"]);
  assert.deepEqual(tavoliPresiAlQr([QR("a", "23:30", ["t3"])], "01:30", DURATE), []);
});

test("le durate sono quelle del piano sala, con gli stessi limiti", () => {
  const d = durateDelServizio(JSON.stringify([{ key: "midi", hold: 45 }, { key: "soir", hold: 999 }, { key: "x", hold: 5 }]), "");
  assert.equal(d.ripiego, 90);
  assert.deepEqual(d.perServizio, { midi: 45, soir: 360, x: 15 });
  assert.equal(durateDelServizio("rotto", "120").ripiego, 120);
  assert.deepEqual(durateDelServizio(null, null), { perServizio: {}, ripiego: 90 });
});

test("i tavoli aperti si ACCENDONO, non si spengono: ci si unisce agli amici", () => {
  /* ⚠️ Cambiato il 16/10/2026. Spenti, impedivano al secondo telefono dello
     stesso tavolo di ordinare da dove era seduto; il server aggancia gia' la
     stessa sessione. */
  assert.match(TPAG, /tavoliApertiAdesso\(ambito\)/);
  assert.match(TPAG, /aperti=\{aperti\}/);
  assert.doesNotMatch(TORD, /disabled=\{[^}]*presiDaAltri/, "un tavolo aperto e' tornato spento");
  assert.doesNotMatch(TORD, /presiDaAltri/);
  assert.match(TORD, /\$\{aperto\(t\.id\) \? " tbl-tav--aperto" : ""\}/);
  assert.match(TPAG, /\.tbl-tav--aperto \{ background: var\(--tbl-ink\);/);
  // Il tavolo ricordato resta scelto anche se nel frattempo e' stato aperto.
  assert.match(TORD, /const scelto = sceltoGrezzo;/);
  // Unendosi, «quanti siete» non si chiede: lo dice la riga al suo posto.
  assert.match(TORD, /\{siUnisce && <p className="tbl-unito">\{testi\.tavoloUnito\}<\/p>\}\s*\{!siUnisce && \(/);
  assert.equal((TPAG.match(/\btavoloUnito: "/g) ?? []).length, 5);
  // Nella barra, le iniziali di chi c'e'.
  assert.match(TORD, /<span key=\{i\} className="tbl-avatar">\{i\}<\/span>/);
  // Mai accesi al click su «Payer et commander»: solo dal server, a ordine fatto.
  assert.doesNotMatch(TORD, /mieIniziali/);
  const opzO = nudo("src/lib/ordiniOpzioni.ts");
  assert.match(opzO, /\.filter\(\(r\) => r\.status !== "pending" \|\| r\.payment_method === "onsite"\)/);
  // Nel dubbio non si accende niente.
  const opz = nudo("src/lib/ordiniOpzioni.ts");
  const i = opz.indexOf("export async function tavoliApertiAdesso");
  assert.match(opz.slice(i, i + 1600), /if \(righe\.error\) \{[\s\S]{0,260}console\.error\([\s\S]{0,80}return \[\];/);
});

test("le iniziali: solo chi ha ordinato, solo la lettera, senza doppioni, al massimo quattro", () => {
  const righe = [
    QR("a", "19:30:00", ["t3"], { first_name: "Xavier" }), // ha aperto ma non ha pagato
    QR("b", "19:40:00", ["t5"], { first_name: "Élodie" }),
    QR("c", "19:45:00", ["t6"], { first_name: "Hugo" }),   // tornato indietro da Stripe
  ];
  const ordini = [
    { reservation_id: "a", customer_name: "marc" },
    { reservation_id: "a", customer_name: "Julie" },
    { reservation_id: "a", customer_name: "Marc" }, // doppione: c'e' gia' «M»
    { reservation_id: "a", customer_name: "Nina" },
    { reservation_id: "a", customer_name: "Omar" },
    { reservation_id: "a", customer_name: "Paul" }, // il quinto non entra
    { reservation_id: "b", customer_name: "Élodie" },
    { reservation_id: "zz", customer_name: "Zoe" }, // altra sessione
  ];
  const aperti = tavoliApertiAlQr(righe, "20:00", DURATE, ordini);
  assert.deepEqual(aperti.find((x) => x.id === "t3")?.iniziali, ["M", "J", "N", "O"], "chi ha aperto senza pagare non compare");
  assert.deepEqual(aperti.find((x) => x.id === "t5")?.iniziali, ["É"]);
  assert.equal(aperti.find((x) => x.id === "t6"), undefined, "sessione senza ordini confermati: il tavolo non si accende");
  assert.equal(inizialeDi("  "), "");
  // Mai il nome intero nella lista che arriva ai telefoni.
  assert.ok(aperti.every((x) => x.iniziali.every((i) => [...i].length === 1)));
});

test("il totale sotto le note: l'opzione resta nel motore, spenta sulla pagina del tavolo", () => {
  // ⚠️ Tolto dalla pagina del tavolo il 16/10/2026: il totale c'e' gia' accanto
  // al bottone per pagare, e ripetuto sopra «Vos informations» era un doppione.
  assert.doesNotMatch(TPAG, /totaleSottoLeNote=\{true\}/);
  assert.match(TORD, /totaleSottoLeNote=\{totaleSottoLeNote\}/);
  // Spento di default: i siti in produzione non se lo trovano nudo.
  assert.match(OAPP, /vistaIniziale = "menu", totaleSottoLeNote = false \}/);
  // Lo stesso numero del bottone, sconto compreso: mai due totali diversi.
  assert.match(OAPP, /<strong>\{euro\(scontoCents > 0 \? totaleFinale : totale\)\}<\/strong>/);
});

test("il codice promo e' una domanda: il campo appare solo a casella spuntata", () => {
  assert.match(TPAG, /couponAsk: DOMANDA_COUPON\[lang\] \?\? DOMANDA_COUPON\.fr/);
  for (const l of ["fr", "en", "it", "nl", "es"]) {
    assert.match(TPAG, new RegExp(`const DOMANDA_COUPON[\\s\\S]*?\\b${l}: "`), `manca la domanda in ${l}`);
  }
  // Il campo dipende dalla casella, non solo dal testo.
  assert.match(OAPP, /\(!t\.couponAsk \|\| couponAperto\) && \(/);
});

/* ============================================================
   «APPELER LE SERVEUR»
   ============================================================ */
const CHIAMATA = nudo("src/pages/api/table-call.ts");
const CHIAMATE_ADMIN = nudo("src/pages/api/admin/table-calls.ts");
const NAV = leggi("src/components/admin/AdminNav.astro");

test("la campanella chiede il tavolo e chiama la rotta col punto", () => {
  // Senza tavolo (o nome) gia' noto, la campanella lo chiede.
  assert.match(TORD, /apriScelta\("chiamata"\);\s*\}/);
  assert.match(TORD, /conSede\("\/api\/table-call"\)/);
  assert.match(TORD, /body: JSON\.stringify\("tavolo" in chi \? \{ table: chi\.tavolo\.id \} : \{ name: chi\.nome \}\)/,
    "l'ID del tavolo, mai il suo nome; il nome della persona solo senza tavoli");
  // L'interruttore dei Réglages, non un `true` scritto nella pagina.
  assert.match(TPAG, /chiamata=\{sala\.chiamata\}/);
  // Sul menu e sui dati, mai a servizio chiuso.
  assert.match(TORD, /const campanello = chiamata && !chiusoTesto;/);
});

test("la campanella non cambia di nascosto il tavolo dell'ordine", () => {
  assert.match(TORD, /if \("tavolo" in chi && !scelto\) setTavolo\(chi\.tavolo\.id\);/);
});

test("senza piano sala la campanella chiede il nome, non una griglia vuota", () => {
  assert.match(TORD, /if \(modo === "chiamata" && tavoli\.length === 0\) \{\s*setNomeAperto\(true\);/);
  assert.match(TORD, /disabled=\{nomeChiamata\.trim\(\)\.length < 2 \|\| chiamando\}/);
  for (const k of ["chiamaNomeTitolo", "chiamaNome", "chiamaInvia", "chiamaFattoNome"]) {
    assert.equal((TPAG.match(new RegExp(`\\b${k}: "`, "g")) ?? []).length, 5, `${k}: manca in qualche lingua`);
  }
});

test("la campanella si accende dai Réglages, spenta di ripiego", () => {
  const regole = leggi("src/lib/ordiniRegole.ts");
  assert.match(regole, /orders_table_call: "0",/);
  const opz = leggi("src/lib/ordiniOpzioni.ts");
  assert.match(opz, /chiamata: opz\.tavolo && opz\.chiamata,/, "senza la sala accesa la campanella non c'e'");
  const set = leggi("src/pages/admin/settings.astro");
  assert.match(set, /id="o-table-call"/);
  assert.match(set, /met\("o-table-call", "orders_table_call"\)/);
  assert.match(set, /orders_table_call: \(document\.getElementById\("o-table-call"\)/);
  assert.match(CHIAMATA, /if \(!opz\.attivo \|\| !opz\.chiamata\) return json\(\{ error: "appel non active" \}, 403\)/);
});

test("la barra del carrello lascia il posto alla campanella", () => {
  const css = leggi("src/components/TableOrder.css");
  assert.match(css, /:where\(\.tbl-pagina--campanello \.order-mobcart\) \{ right: calc\(1rem \+ 56px \+ \.6rem\); \}/);
  // Il cerchio e' alto quanto la barra (56px) e poggia sullo stesso fondo.
  assert.match(TPAG, /\.tbl-campanello \{[\s\S]*?bottom: calc\(1rem \+ env\(safe-area-inset-bottom, 0px\)\);[\s\S]*?width: 56px; height: 56px;/);
  assert.match(leggi("src/components/TableOrder.css"), /:where\(\.tbl-pagina \.order-mobcart\) \{[\s\S]*?min-height: 56px;/);
  assert.match(TPAG, /prefers-reduced-motion: reduce\) \{ \.tbl-campanello-giro \{ animation: none; \}/);
});

test("il pallino della campanella non si incolla alla frase", () => {
  assert.match(TORD, /toLocaleUpperCase\(lang\)\}\\u00A0\\u00A0•\\u00A0\\u00A0`/);
});

test("la conferma si annuncia: la zona viva c'e' sempre", () => {
  assert.match(TORD, /<div className="tbl-avviso-zona" role="status">/);
});

test("la rotta pubblica: tavolo vero, servizio aperto, il nome dal database", () => {
  assert.match(CHIAMATA, /ambitoPubblicoChiesto\(request\)/);
  assert.match(CHIAMATA, /if \(!servizioInCorso\(cfg,/);
  assert.match(CHIAMATA, /\(await tavoliDiSala\(ambito\)\)\.find\(\(t\) => t\.id === chiesto\)/);
  assert.match(CHIAMATA, /table_label: tavolo\?\.name \?\? ""/, "il nome del tavolo viene dal database, mai dal browser");
  assert.match(CHIAMATA, /caller_name: tavolo \? "" : nome/, "col tavolo, il nome della persona non finisce sul tablet");
  assert.match(NAV, /String\(T\.chiamataNome \?\? ""\)\.replace\("\{nome\}", esc\(chi\(chiamate\[0\]\)\)\)/, "il nome scritto dal cliente passa da esc");
  // Il doppione non e' un errore per chi ha toccato due volte: «fatto», e quanto manca.
  assert.match(CHIAMATA, /if \(esito\.tipo === "gia"\) return json\(\{ ok: true, gia: true, riprova_tra: esito\.restanti \}\)/);
  assert.match(CHIAMATA, /if \(esito\.tipo === "troppe"\) return json\(\{ error: "trop d'appels" \}, 429\)/);
});

test("il tablet: chiede spesso, non si zittisce al primo giro, toccare = «ci vado»", () => {
  assert.match(CHIAMATE_ADMIN, /verificaStaff\(request\)/);
  assert.match(CHIAMATE_ADMIN, /if \(error\) return json\(\{ calls: \[\] \}\)/);
  assert.match(NAV, /window\.setInterval\(pollChiamate, 8000\)/);
  assert.match(NAV, /sessionStorage\.getItem\(CHIAVE_VISTE\)/);
  assert.match(NAV, /apriToast\(0\)/, "la chiamata non sparisce da sola");
  assert.match(NAV, /suona\(bell\)/);
  assert.match(NAV, /fetch\("\/api\/admin\/table-calls", \{\s*method: "POST"/);
});

test("gli interruttori degli ordini accendono «Enregistrer»", () => {
  // Il guasto del 16/10/2026: toccandoli la barra non compariva, e nessuno salvava.
  const set = leggi("src/pages/admin/settings.astro");
  assert.match(set, /querySelectorAll<HTMLInputElement>\('\.section\[data-tab="cuisine"\] input\[type="checkbox"\]\[id\^="o-"\]'\)\s*\.forEach\(\(el\) => el\.addEventListener\("change", dirty\)\)/);
  // E tutti gli interruttori degli ordini stanno davvero in quella scheda, con quel prefisso.
  for (const id of ["o-pay-online", "o-pay-onsite", "o-coupons", "o-coupons-onsite", "o-table", "o-table-call", "o-table-notify"]) {
    assert.match(set, new RegExp(`<input type="checkbox" id="${id}" />`), `${id} non c'e' piu' o ha cambiato forma`);
  }
});

test("i riquadri del tavolo salgono e scendono, e si chiudono anche senza animazione", () => {
  const css = leggi("src/components/TableOrder.css");
  assert.match(css, /:where\(\.tbl-pagina \.tbl-modale\.is-uscita > \.tbl-modale-box\) \{ animation: tbl-foglio-scende/);
  assert.match(css, /:where\(\.tbl-pagina \.tbl-modale, \.tbl-pagina \.tbl-modale-box\) \{ animation: none; \}/);
  // Si smonta DOPO l'animazione letta dal CSS; senza animazione, subito.
  assert.match(TORD, /if \(!stile \|\| stile\.animationName === "none" \|\| !durata\) \{\s*fine\(\);/);
  assert.doesNotMatch(TORD, /requestAnimationFrame/, "a scheda nascosta i fotogrammi si fermano");
  // Nessuna chiusura secca rimasta: tutte passano dall'animazione.
  assert.doesNotMatch(TORD, /set(SceltaAperta|NomeAperto)\(false\)(?![\s\S]{0,40}setUscita)/);
});

test("scorrendo la barra del tavolo si rimpicciolisce, senza ballare", () => {
  // Due soglie: si stringe oltre 120px, torna grande sotto 30.
  assert.match(TORD, /setCompatta\(\(ora\) => \(ora \? y > 30 : y > 120\)\)/);
  assert.match(TORD, /window\.addEventListener\("scroll", guarda, \{ passive: true \}\)/);
  // ⚠️ Lo spazio nella pagina resta fisso (niente carta che saltella), e
  // si rimpicciolisce con `scale`, non cambiando misura al testo.
  assert.match(TPAG, /\.tbl-barra \{ position: sticky; top: 0; z-index: 12; height: var\(--tbl-barra-piena, auto\);/);
  assert.match(TPAG, /\.tbl-barra--compatta \.tbl-tav--scelto, \.tbl-barra--compatta \.tbl-scegli \{ transform: scale\(\.8\); \}/);
  assert.doesNotMatch(TPAG, /transition:[^;]*font-size/, "il testo che cambia misura a ogni fotogramma scatta");
  // Stretta, l'altezza la dice il CSS: misurarla a ogni fotogramma scattava.
  assert.match(TORD, /if \(!el \|\| compatta\) return;/);
  assert.match(TPAG, /\.tbl-pagina--barra\.tbl-pagina--compatta \{ --tbl-barra-h: calc\(1\.05rem \+ 46px\); \}/);
});

test("tavolo gia' scelto: la campanella chiama subito, senza richiedere", () => {
  assert.match(TORD, /if \(conTavoli && scelto\) \{ void chiama\(\{ tavolo: scelto \}\); return; \}/);
  assert.match(TORD, /if \(!conTavoli && nomeNoto\.length >= 2\) \{ void chiama\(\{ nome: nomeNoto \}\); return; \}/);
  assert.match(TORD, /onClick=\{toccaCampanella\}/);
});

test("il timer della campanella: lo decide il server, sopravvive al ricaricamento", () => {
  assert.match(TORD, /avviaAttesa\(Number\(dati\.riprova_tra\) \|\| attesaChiamata \* 60\);/);
  assert.match(TORD, /ricorda\(CHIAVE_ATTESA_CHIAMATA, String\(fino\)\)/);
  // In attesa un tocco dice quanto manca, e non chiama.
  assert.match(TORD, /if \(restanti > 0\) \{\s*mostraAvviso\(testi\.chiamaAttendi/);
  assert.equal((TPAG.match(/\bchiamaAttendi: "[^"]*\{tempo\}/g) ?? []).length, 5, "chiamaAttendi con {tempo} in tutte le lingue");
  // La rotta risponde il tempo, e conta anche le chiamate gia' sbrigate.
  assert.match(CHIAMATA, /riprova_tra: esito\.restanti/);
  assert.doesNotMatch(CHIAMATA, /\.eq\("status", "open"\)/);
  // I Réglages: quattro valori, e la riga solo con la campanella accesa.
  const set = leggi("src/pages/admin/settings.astro");
  // Gli stessi bottoni del tempo di preparazione, non una tendina.
  assert.match(set, /\{\[1, 3, 5, 10\]\.map\(\(m\) => \(\s*<button type="button" class="prep-btn" data-attesa=\{String\(m\)\}/);
  assert.doesNotMatch(set, /<select id="o-table-call-wait"/);
  assert.match(set, /chiamata_attesa: Number\(/);
  const api = leggi("src/pages/api/admin/settings.ts");
  assert.match(api, /if \(\(ATTESE_CHIAMATA as readonly number\[\]\)\.includes\(v\)\)/);
});

test("sui dati, «Retour au menu» e' una pillola in fondo, accanto alla campanella", () => {
  const css = leggi("src/components/TableOrder.css");
  assert.match(css, /:where\(\.tbl-pagina \.order-wrap:has\(\.order-cart--checkout\) > \.order-filterbar\) \{\s*position: fixed;/);
  assert.match(css, /:where\(\.tbl-pagina--campanello \.order-wrap:has\(\.order-cart--checkout\) > \.order-filterbar\) \{ right: calc\(1rem \+ 56px \+ \.6rem\); \}/);
  // Lo spazio in fondo, perche' il bottone per pagare non finisca sotto la pillola.
  assert.match(css, /:where\(\.tbl-pagina \.order-wrap:has\(\.order-cart--checkout\)\) \{ padding-bottom: 6rem; \}/);
  // Nel colore d'accento, come la pillola del carrello.
  assert.match(css, /\.order-wrap:has\(\.order-cart--checkout\) \.order-tab\) \{[\s\S]*?background: var\(--tbl-ink\); color: var\(--tbl-paper\);/);
});

test("chiudere e riscansionare il QR ritrova tavolo e sessione, ma non domani", () => {
  /* ⚠️ Il guasto del 16/10/2026: con `sessionStorage` la memoria moriva con
     la scheda, e al nuovo scan il cliente vedeva il SUO tavolo spento come
     «gia' aperto da altri». Ora vive quattro ore, poi si cancella. */
  const codice = TORD.split("\n").filter((r) => !/^\s*(\*|\/\*|\/\/)/.test(r)).join("\n");
  assert.doesNotMatch(codice, /sessionStorage/, "torna la memoria che muore con la scheda");
  assert.match(TORD, /const MEMORIA_MS = 4 \* 60 \* 60 \* 1000;/);
  assert.match(TORD, /o\.fino < Date\.now\(\)[\s\S]{0,80}window\.localStorage\.removeItem\(chiave\);/);
  for (const k of ["CHIAVE_SCELTA", "CHIAVE_ATTESA_CHIAMATA", "CHIAVE_NOME_CHIAMATA"]) {
    assert.match(TORD, new RegExp(`ricorda\\(${k}`), `${k} non passa dalla memoria a tempo`);
  }
});
