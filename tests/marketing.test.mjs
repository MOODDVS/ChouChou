/**
 * MARKETING — il comportamento delle tre schede che restano.
 * (I buoni regalo hanno il loro file: tests/buoni.test.mjs.)
 *
 * Tutte e tre parlano al CLIENTE, e qui l'errore non lo vede il ristoratore:
 * lo vede chi paga.
 *
 *   il COUPON e' del marchio   — lo sconto esce dalla cassa di chi serve,
 *                                ma il limite d'uso e' del gruppo
 *   il POP-UP e' misto         — un annuncio del gruppo o di un punto solo
 *   la RUBRICA e' del marchio  — chi ordina a Stockel e prenota a Jourdan
 *                                e' una persona, non due
 *
 * Nessuna di queste tre aveva un solo test prima del 16/09/2026. Il motivo
 * non era la pigrizia: le regole erano sepolte dentro file che importano
 * Supabase, Resend e l'orologio, e per provarle sarebbe servito un
 * database. Adesso stanno in moduli che non importano niente.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { DateTime } from "luxon";
import { calcolaScontoCoupon, normalizzaCodice, couponValePer } from "../src/lib/coupons.ts";
import { scegliPopup, popupInOrario, titoloPopup } from "../src/lib/popupRegole.ts";
import {
  filtraRubrica, parseSegment, GIORNI_NUOVO, TOP,
} from "../src/lib/newsletterRegole.ts";
import { CLASSIFICA, filtroPer, sede, SEDE_UNICA } from "../src/lib/admin/sedeRegole.ts";

const STOCKEL = "11111111-1111-1111-1111-111111111111";
const JOURDAN = "22222222-2222-2222-2222-222222222222";

/* ============================================================
   I COUPON — lo sconto e' denaro
   ============================================================ */

const cou = (o) => ({
  id: "c1", code: "TEST", code_norm: "test", description: null,
  discount_type: "percent", discount_value: 10,
  max_discount_cents: null, min_spend_cents: null,
  schedule_kind: "always", date_start: null, date_end: null,
  days: null, hour_start: null, hour_end: null,
  per_customer_limit: null, global_limit: null,
  categories: [], combine_with_promo: "stack",
  new_customers_only: false, active: true, ...o,
});
const OVUNQUE = sede(STOCKEL); // ordina da Stockel: un coupon senza restrizioni vale
const linea = (o) => ({ price_cents: 1000, is_promo: false, category: "pizze", qty: 1, ...o });
// Mercoledì 18 marzo 2026, 13:00 a Bruxelles.
const MERCOLEDI = DateTime.fromISO("2026-03-18T13:00", { zone: "Europe/Brussels" });

test("il 10% di 30 € fa 3 €", () => {
  const r = calcolaScontoCoupon(cou(), [linea({ price_cents: 1000, qty: 3 })], MERCOLEDI, OVUNQUE);
  assert.equal(r.discount_cents, 300);
});

test("uno sconto fisso non puo' superare il carrello", () => {
  // Altrimenti il cliente finirebbe a credito: il ristorante gli deve dei soldi.
  const r = calcolaScontoCoupon(
    cou({ discount_type: "fixed", discount_value: 5000 }),
    [linea({ price_cents: 1200 })],
    MERCOLEDI,
  );
  assert.equal(r.discount_cents, 1200);
});

test("il tetto massimo vince sulla percentuale", () => {
  const r = calcolaScontoCoupon(
    cou({ discount_value: 50, max_discount_cents: 500 }),
    [linea({ price_cents: 10000 })],
    MERCOLEDI,
  );
  assert.equal(r.discount_cents, 500); // 50 € di sconto sarebbero stati
});

test("una percentuale oltre 100 non regala il ristorante", () => {
  const r = calcolaScontoCoupon(
    cou({ discount_value: 250 }),
    [linea({ price_cents: 2000 })],
    MERCOLEDI,
  );
  assert.equal(r.discount_cents, 2000); // non 5000
});

test("un coupon spento non sconta niente", () => {
  const r = calcolaScontoCoupon(cou({ active: false }), [linea()], MERCOLEDI, OVUNQUE);
  assert.equal(r.discount_cents, 0);
  assert.ok(r.error);
});

test("la spesa minima guarda il carrello INTERO, non le righe idonee", () => {
  // 30 € di spesa, di cui solo 10 in pizze. Il minimo di 20 e' raggiunto.
  const r = calcolaScontoCoupon(
    cou({ min_spend_cents: 2000, categories: ["pizze"] }),
    [linea({ price_cents: 1000 }), linea({ price_cents: 2000, category: "vini" })],
    MERCOLEDI,
  );
  assert.equal(r.discount_cents, 100); // 10% di 10 €, non di 30
});

test("sotto la spesa minima il coupon lo dice, non sconta zero in silenzio", () => {
  const r = calcolaScontoCoupon(cou({ min_spend_cents: 5000 }), [linea()], MERCOLEDI, OVUNQUE);
  assert.equal(r.discount_cents, 0);
  assert.match(r.error ?? "", /50/); // il messaggio contiene la cifra che manca
});

test("«exclude» toglie le promo dal calcolo, «block» rifiuta tutto", () => {
  const carrello = [linea({ price_cents: 1000 }), linea({ price_cents: 1000, is_promo: true })];
  const escluse = calcolaScontoCoupon(cou({ combine_with_promo: "exclude" }), carrello, MERCOLEDI, OVUNQUE);
  assert.equal(escluse.discount_cents, 100); // 10% della sola riga piena
  const bloccato = calcolaScontoCoupon(cou({ combine_with_promo: "block" }), carrello, MERCOLEDI, OVUNQUE);
  assert.equal(bloccato.discount_cents, 0);
  assert.ok(bloccato.error);
});

test("«block» guarda solo le righe IDONEE, non tutto il carrello", () => {
  // Coupon sulle pizze, promo su un vino: la promo non c'entra niente.
  const r = calcolaScontoCoupon(
    cou({ combine_with_promo: "block", categories: ["pizze"] }),
    [linea({ price_cents: 1000 }), linea({ price_cents: 3000, category: "vini", is_promo: true })],
    MERCOLEDI,
  );
  assert.equal(r.discount_cents, 100);
});

test("fuori dall'intervallo di date il coupon non vale", () => {
  const passato = cou({ schedule_kind: "dates", date_start: "2026-01-01", date_end: "2026-01-31" });
  assert.equal(calcolaScontoCoupon(passato, [linea()], MERCOLEDI, OVUNQUE).discount_cents, 0);
  const dentro = cou({ schedule_kind: "dates", date_start: "2026-03-01", date_end: "2026-03-31" });
  assert.equal(calcolaScontoCoupon(dentro, [linea()], MERCOLEDI, OVUNQUE).discount_cents, 100);
});

test("l'ultimo giorno dell'intervallo e' compreso", () => {
  const c = cou({ schedule_kind: "dates", date_start: "2026-03-01", date_end: "2026-03-18" });
  assert.equal(calcolaScontoCoupon(c, [linea()], MERCOLEDI, OVUNQUE).discount_cents, 100);
});

test("il giorno della settimana usa la numerazione dell'admin (0 = domenica)", () => {
  // ⚠️ luxon conta 1=lunedi'…7=domenica, l'admin 0=domenica…6=sabato. Se la
  // conversione saltasse, un coupon del mercoledi' varrebbe di giovedi' e
  // nessuno capirebbe perche'.
  const mercoledi = cou({ schedule_kind: "weekly", days: [3] });
  assert.equal(calcolaScontoCoupon(mercoledi, [linea()], MERCOLEDI, OVUNQUE).discount_cents, 100);
  const giovedi = cou({ schedule_kind: "weekly", days: [4] });
  assert.equal(calcolaScontoCoupon(giovedi, [linea()], MERCOLEDI, OVUNQUE).discount_cents, 0);
});

test("la domenica non diventa lunedi'", () => {
  const domenica = DateTime.fromISO("2026-03-22T13:00", { zone: "Europe/Brussels" });
  assert.equal(calcolaScontoCoupon(cou({ schedule_kind: "weekly", days: [0] }), [linea()], domenica, OVUNQUE).discount_cents, 100);
  assert.equal(calcolaScontoCoupon(cou({ schedule_kind: "weekly", days: [1] }), [linea()], domenica, OVUNQUE).discount_cents, 0);
});

test("la fascia oraria comprende i due estremi", () => {
  const c = cou({ schedule_kind: "weekly", days: [3], hour_start: "13:00", hour_end: "15:00" });
  assert.equal(calcolaScontoCoupon(c, [linea()], MERCOLEDI, OVUNQUE).discount_cents, 100);
  const tardi = DateTime.fromISO("2026-03-18T15:01", { zone: "Europe/Brussels" });
  assert.equal(calcolaScontoCoupon(c, [linea()], tardi, OVUNQUE).discount_cents, 0);
});

test("un coupon su una categoria che non c'e' nel carrello lo dice", () => {
  const r = calcolaScontoCoupon(cou({ categories: ["dolci"] }), [linea()], MERCOLEDI, OVUNQUE);
  assert.equal(r.discount_cents, 0);
  assert.ok(r.error);
});

test("il codice si confronta senza maiuscole ne' spazi", () => {
  assert.equal(normalizzaCodice("  BeNvEnUtO "), "benvenuto");
});

/* ---- il coupon e le tre societa' ---- */

test("la RIGA del coupon resta del marchio", () => {
  // ⚠️ E' la validita' a essere ristretta, non la riga. Se `coupons`
  // diventasse una tabella di sede, il responsabile di un punto non
  // vedrebbe piu' i codici del gruppo e ne creerebbe di doppi con lo stesso
  // nome — e `code_norm` e' unico, quindi il secondo fallirebbe con un
  // errore che non spiega niente a chi lo legge.
  assert.equal(CLASSIFICA.coupons, "marchio");
  assert.equal(filtroPer("coupons", sede(STOCKEL)).tipo, "nessuno");
});

/* ---- dove vale un codice ---- */

test("senza scelta il codice vale in ogni punto", () => {
  for (const c of [{ locations: [] }, { locations: null }, {}]) {
    assert.equal(couponValePer(c, sede(STOCKEL)), true);
    assert.equal(couponValePer(c, sede(JOURDAN)), true);
  }
});

test("un codice riservato a un punto non vale negli altri", () => {
  const solo = { locations: [STOCKEL] };
  assert.equal(couponValePer(solo, sede(STOCKEL)), true);
  assert.equal(couponValePer(solo, sede(JOURDAN)), false);
});

test("due punti su tre si possono scegliere", () => {
  // E' il motivo per cui e' un elenco e non una colonna `location_id`:
  // «Jourdan e Stockel ma non Schaerbeek» non si scrive con una colonna sola.
  const SCHAERBEEK = "33333333-3333-3333-3333-333333333333";
  const due = { locations: [STOCKEL, JOURDAN] };
  assert.equal(couponValePer(due, sede(STOCKEL)), true);
  assert.equal(couponValePer(due, sede(JOURDAN)), true);
  assert.equal(couponValePer(due, sede(SCHAERBEEK)), false);
});

test("a punto unico non c'e' niente da restringere", () => {
  assert.equal(couponValePer({ locations: [STOCKEL] }, SEDE_UNICA), true);
});

test("un id rimasto di una sede cancellata non blocca il codice dove valeva", () => {
  // Postgres non sa mettere una chiave esterna su un elemento di array:
  // cancellata la sede, il suo id resta li'. Trattarlo come «un punto che
  // non e' questo» e' l'unica lettura che non toglie niente a nessuno.
  const c = { locations: [STOCKEL, "99999999-9999-9999-9999-999999999999"] };
  assert.equal(couponValePer(c, sede(STOCKEL)), true);
  assert.equal(couponValePer(c, sede(JOURDAN)), false);
});

test("lo sconto non esce dalla cassa di un punto escluso", () => {
  // La prova che la regola e' COLLEGATA al calcolo, non solo scritta:
  // e' la riga che impedisce a una societa' di pagare la promozione di
  // un'altra.
  const c = cou({ locations: [JOURDAN] });
  assert.equal(calcolaScontoCoupon(c, [linea()], MERCOLEDI, sede(STOCKEL)).discount_cents, 0);
  assert.equal(calcolaScontoCoupon(c, [linea()], MERCOLEDI, sede(JOURDAN)).discount_cents, 100);
});

test("«non vale qui» si dice prima di «non vale oggi»", () => {
  // A chi ordina dal punto sbagliato, sapere che il codice non vale LI'
  // e' utile; «non vale oggi» lo manderebbe a riprovare domani.
  const c = cou({ locations: [JOURDAN], schedule_kind: "dates", date_start: "2020-01-01", date_end: "2020-12-31" });
  const r = calcolaScontoCoupon(c, [linea()], MERCOLEDI, sede(STOCKEL));
  assert.match(r.error ?? "", /adresse|location|sede|vestiging|direcci/i);
});

test("ogni punto di chiamata dice da dove si sta ordinando", () => {
  // ⚠️ `ambito` e' obbligatorio e sta PRIMA di `lang` apposta: in fondo e
  // facoltativo sarebbe stato dimenticato in una chiamata su due, e uno
  // sconto riservato sarebbe uscito dalla cassa sbagliata in silenzio.
  for (const f of ["src/pages/api/coupon.ts", "src/pages/api/checkout.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /calcolaScontoCoupon\([^)]*ambito/,
      `${f} non dice a quale punto appartiene l'ordine`);
  }
});

test("l'admin conta gli utilizzi come il motore li fa rispettare", () => {
  // ⚠️ Il difetto trovato il 16/09/2026: l'elenco contava gli ordini della
  // SEDE SELEZIONATA, il limite quelli di tutte. Un codice da 100 usato 40
  // volte a Schaerbeek, 35 a Jourdan e 25 a Stockel appariva «40 / 100» ed
  // era gia' esaurito. Due conti della stessa cosa divergono sempre.
  const src = readFileSync("src/pages/api/admin/coupons.ts", "utf8");
  const blocco = src.slice(src.indexOf("const usi = new Map"));
  assert.match(blocco, /leggi\("orders",\s*tutteLeSedi\(\)/);
  assert.ok(!/leggi\("orders",\s*ambito/.test(src), "il conteggio non torni alla sede selezionata");
});

test("il limite d'uso di un coupon conta gli ordini di TUTTE le sedi", () => {
  // Un coupon «primi 100 clienti» e' del marchio: se il conteggio fosse
  // filtrato sulla sede, diventerebbe «primi 100 per punto» — trecento
  // sconti invece di cento, e nessuno se ne accorgerebbe fino al conto.
  // Il conteggio vive in `verificaLimitiUso`, che legge `orders` NUDA
  // apposta: questa rete difende quella nudita'.
  const src = readFileSync("src/lib/coupons.ts", "utf8");
  const blocco = src.slice(src.indexOf("export async function verificaLimitiUso"));
  assert.ok(!/location_id/.test(blocco), "il limite del coupon non si filtra per sede");
  assert.ok(/coupon_id/.test(blocco) && /"paid"/.test(blocco), "si contano gli ordini pagati con QUEL coupon");
});

test("«solo nuovi clienti» vuol dire nuovo per il gruppo, non per il punto", () => {
  // Il cliente e' del marchio: chi ha gia' ordinato a Jourdan non e' nuovo
  // a Stockel, anche se Stockel non l'ha mai visto.
  assert.equal(CLASSIFICA.clients, "marchio");
  const src = readFileSync("src/lib/coupons.ts", "utf8");
  const blocco = src.slice(src.indexOf("new_customers_only"), src.indexOf("per_customer_limit"));
  assert.ok(!/location_id/.test(blocco));
});

/* ============================================================
   I POP-UP — quale vince, e in che lingua
   ============================================================ */

const pop = (o) => ({
  id: "p1", title: "Ciao", title_en: null, title_i18n: null,
  pages: ["home"], schedule_kind: "always",
  date_start: null, date_end: null, days: null, hour_start: null, hour_end: null, ...o,
});
const adesso = (o) => ({ slug: "home", lang: "fr", oggi: "2026-03-18", hhmm: "13:00", giorno: 3, ...o });

test("vince il primo dell'elenco, cioe' il piu' recente", () => {
  // Due pop-up validi sulla stessa pagina sarebbero due finestre da chiudere.
  const scelto = scegliPopup([pop({ id: "nuovo" }), pop({ id: "vecchio" })], adesso());
  assert.equal(scelto.id, "nuovo");
});

test("un pop-up di un'altra pagina non compare", () => {
  assert.equal(scegliPopup([pop({ pages: ["menu"] })], adesso()), null);
});

test("senza titolo in quella lingua il pop-up non si mostra", () => {
  // Meglio niente che una finestra vuota, o in francese a un cliente inglese.
  const p = pop({ title: "Bonjour", title_en: null });
  assert.equal(scegliPopup([p], adesso({ lang: "en" })), null);
  assert.equal(scegliPopup([p], adesso({ lang: "fr" })).id, "p1");
});

test("title_i18n vince sulle colonne storiche", () => {
  const p = pop({ title: "Vecchio", title_i18n: { fr: "Nuovo" } });
  assert.equal(titoloPopup(p, "fr"), "Nuovo");
});

test("una lingua senza traduzione non ripiega sul francese", () => {
  const p = pop({ title: "Bonjour", title_i18n: { fr: "Bonjour" } });
  assert.equal(titoloPopup(p, "nl"), "");
  assert.equal(scegliPopup([p], adesso({ lang: "nl" })), null);
});

test("una programmazione a date SENZA date non vale sempre: non vale mai", () => {
  // Chi ha scelto «fra due date» e le ha lasciate vuote ha lasciato il
  // lavoro a meta'. Trattarlo come «sempre» vuol dire pubblicare per
  // sbaglio un annuncio che non era pronto.
  assert.equal(popupInOrario(pop({ schedule_kind: "dates" }), adesso()), false);
  assert.equal(popupInOrario(pop({ schedule_kind: "dates", date_start: "2026-03-01" }), adesso()), false);
});

test("le date del pop-up comprendono i due estremi", () => {
  const p = pop({ schedule_kind: "dates", date_start: "2026-03-18", date_end: "2026-03-18" });
  assert.equal(popupInOrario(p, adesso()), true);
  assert.equal(popupInOrario(p, adesso({ oggi: "2026-03-19" })), false);
});

test("il pop-up settimanale vuole il giorno E l'ora", () => {
  const p = pop({ schedule_kind: "weekly", days: [3], hour_start: "12:00", hour_end: "14:00" });
  assert.equal(popupInOrario(p, adesso()), true);
  assert.equal(popupInOrario(p, adesso({ giorno: 4 })), false);
  assert.equal(popupInOrario(p, adesso({ hhmm: "14:01" })), false);
});

test("un settimanale senza ore non vale", () => {
  assert.equal(popupInOrario(pop({ schedule_kind: "weekly", days: [3] }), adesso()), false);
});

test("le ore con i secondi si confrontano lo stesso", () => {
  // Postgres rende "12:00:00": confrontato com'e', "13:00" > "12:00:00"
  // funziona per caso ma "09:30" vs "09:30:00" no. Si taglia a HH:mm.
  const p = pop({ schedule_kind: "weekly", days: [3], hour_start: "13:00:00", hour_end: "15:00:00" });
  assert.equal(popupInOrario(p, adesso({ hhmm: "13:00" })), true);
});

test("il pop-up e' misto: quello del gruppo si vede da ogni punto", () => {
  assert.equal(CLASSIFICA.popups, "mista");
  const f = filtroPer("popups", sede(JOURDAN));
  assert.equal(f.tipo, "sede-o-marchio");
  assert.match(f.espressione, /location_id\.is\.null/);
});

/* ============================================================
   LA NEWSLETTER — chi riceve cosa
   ============================================================ */

const ORA = Date.parse("2026-03-18T12:00:00Z");
const giorniFa = (n) => new Date(ORA - n * 86400000).toISOString();
const profilo = (o) => ({ first: giorniFa(100), spesa: 0, ordini: false, rese: false, lang: "", langAt: "", ...o });
const rubrica = (obj) => new Map(Object.entries(obj));

test("chi non ha mai detto la sua lingua e' francofono", () => {
  // Il francese e' la lingua del sito: meglio una mail nella lingua di casa
  // che nessuna mail. E' la scelta, e va scritta.
  const r = rubrica({ "muto@x.be": profilo(), "en@x.be": profilo({ lang: "en" }) });
  assert.deepEqual(filtraRubrica(r, "fr", "tous", ORA), ["muto@x.be"]);
});

test("«en» vuol dire tutte le lingue che non sono il francese", () => {
  const r = rubrica({
    "nl@x.be": profilo({ lang: "nl" }),
    "it@x.be": profilo({ lang: "it" }),
    "fr@x.be": profilo({ lang: "fr" }),
    "muto@x.be": profilo(),
  });
  assert.deepEqual(filtraRubrica(r, "en", "tous", ORA).sort(), ["it@x.be", "nl@x.be"]);
});

test("il top 50 e' il top 50 DI QUELLA lingua", () => {
  // Non i francofoni presi dal top 50 generale: sarebbero cinque nomi.
  const r = rubrica({
    "ricco-en@x.be": profilo({ lang: "en", spesa: 100000 }),
    "fr1@x.be": profilo({ spesa: 500 }),
    "fr2@x.be": profilo({ spesa: 900 }),
  });
  assert.deepEqual(filtraRubrica(r, "fr", "top50", ORA), ["fr2@x.be", "fr1@x.be"]);
});

test("chi non ha mai speso niente non sta nel top", () => {
  const r = rubrica({ "a@x.be": profilo({ spesa: 0 }), "b@x.be": profilo({ spesa: 100 }) });
  assert.deepEqual(filtraRubrica(r, "tous", "top50", ORA), ["b@x.be"]);
});

test("il top si ferma a 50", () => {
  const molti = {};
  for (let i = 0; i < 80; i++) molti[`c${i}@x.be`] = profilo({ spesa: i + 1 });
  assert.equal(filtraRubrica(rubrica(molti), "tous", "top50", ORA).length, TOP);
});

test("«nuovo» dura quattordici giorni, e il quattordicesimo e' ancora dentro", () => {
  const r = rubrica({
    "ieri@x.be": profilo({ first: giorniFa(1) }),
    "quasi@x.be": profilo({ first: giorniFa(GIORNI_NUOVO - 1) }),
    "vecchio@x.be": profilo({ first: giorniFa(GIORNI_NUOVO + 1) }),
  });
  assert.deepEqual(filtraRubrica(r, "tous", "nouveaux", ORA).sort(), ["ieri@x.be", "quasi@x.be"]);
});

test("chi non ha una prima attivita' non e' «nuovo»", () => {
  // Senza data non si sa: e chiamare nuovo chi non si sa vuol dire mandare
  // il benvenuto a un cliente di dieci anni fa.
  assert.deepEqual(filtraRubrica(rubrica({ "x@x.be": profilo({ first: null }) }), "tous", "nouveaux", ORA), []);
});

test("«resa» e «commande» separano chi prenota da chi ordina", () => {
  const r = rubrica({
    "solo-resa@x.be": profilo({ rese: true }),
    "solo-ord@x.be": profilo({ ordini: true }),
    "tutti-e-due@x.be": profilo({ rese: true, ordini: true }),
  });
  assert.deepEqual(filtraRubrica(r, "tous", "resa", ORA).sort(), ["solo-resa@x.be", "tutti-e-due@x.be"]);
  assert.deepEqual(filtraRubrica(r, "tous", "commande", ORA).sort(), ["solo-ord@x.be", "tutti-e-due@x.be"]);
});

test("un segmento vecchio senza «:» si legge come gruppo, non come lingua", () => {
  // ⚠️ Era salvato cosi' prima che i segmenti avessero una lingua. Letto
  // come lingua, un invio programmato l'anno scorso partirebbe oggi a
  // TUTTA la rubrica invece che al top 50.
  assert.deepEqual(parseSegment("top50"), { lang: "tous", group: "top50" });
  assert.deepEqual(parseSegment("fr:top50"), { lang: "fr", group: "top50" });
});

test("un segmento incomprensibile diventa «tutti», non un errore", () => {
  assert.deepEqual(parseSegment("pinco:pallino"), { lang: "tous", group: "tous" });
  assert.deepEqual(parseSegment(""), { lang: "tous", group: "tous" });
  assert.deepEqual(parseSegment(null), { lang: "tous", group: "tous" });
});

/* ---- la rubrica e le tre societa' ---- */

test("la rubrica si legge su TUTTE le sedi, mai su quella selezionata", () => {
  // Con la sede selezionata un invio «a tutti» partirebbe a un terzo della
  // rubrica, e il conteggio direbbe un numero plausibile: nessun errore,
  // duemila persone che non ricevono niente.
  const src = readFileSync("src/lib/newsletterSend.ts", "utf8");
  // ⚠️ Niente `[^)]*` per leggere l'argomento: `tutteLeSedi()` ha le sue
  // parentesi dentro, e la classe negata si fermerebbe alla prima —
  // la rete resterebbe verde su qualunque cosa. Si contano, non si leggono.
  const tutte = (src.match(/\brubrica\(/g) ?? []).length;
  const giuste = (src.match(/\brubrica\(tutteLeSedi\(\)\)/g) ?? []).length;
  assert.ok(tutte >= 3, "le chiamate a rubrica() sono sparite: rete da aggiornare");
  assert.equal(giuste, tutte - 1, "ogni chiamata a rubrica() passa tutteLeSedi() (la meno e' la dichiarazione)");
  assert.ok(!/ambitoPubblico/.test(src), "ambitoPubblico rende la PRIMA sede: mai in un invio");
});

test("la disiscrizione vale per tutto il gruppo", () => {
  // Il consenso segue la persona, non il punto vendita: chi si disiscrive
  // non deve risentirsi arrivare la stessa newsletter dall'altra pizzeria.
  assert.equal(CLASSIFICA.newsletter_optout, "marchio");
  assert.equal(filtroPer("newsletter_optout", sede(STOCKEL)).tipo, "nessuno");
});

test("i crediti d'invio sono del gruppo, non di un punto", () => {
  assert.equal(CLASSIFICA.newsletter_credits, "marchio");
  assert.equal(CLASSIFICA.newsletter_log, "marchio");
  assert.equal(CLASSIFICA.newsletter_schedule, "marchio");
});

/* ============================================================
   LE REGOLE RESTANO PROVABILI
   ============================================================ */

test("i moduli di regole non importano niente che serva un database", () => {
  // E' il patto che rende questi test dei test veri: girano sulla funzione
  // vera, non su una copia scritta apposta. Il giorno che uno di questi
  // file importasse Supabase, il file diventerebbe non provabile e questi
  // test morirebbero — meglio saperlo subito.
  for (const f of ["src/lib/popupRegole.ts", "src/lib/newsletterRegole.ts"]) {
    const src = readFileSync(f, "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]*;/gm)].map((m) => m[0]);
    assert.deepEqual(imports, [], `${f} non deve importare niente: ${imports.join(" ")}`);
  }
});

test("la scelta del pop-up sta in un posto solo", () => {
  // `popups.ts` deve CHIAMARE la regola, non averne una sua copia.
  const src = readFileSync("src/lib/popups.ts", "utf8");
  assert.match(src, /scegliPopup\(/);
  assert.ok(!/schedule_kind === "weekly"/.test(src), "la programmazione e' tornata dentro popups.ts");
});
