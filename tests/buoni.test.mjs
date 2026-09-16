/**
 * I BUONI REGALO — il comportamento.
 *
 * E' l'unico posto del motore in cui il DENARO attraversa il confine fra
 * due societa'. Il buono si compra ovunque e si spende ovunque — e' la
 * decisione del cliente — quindi una societa' incassa e un'altra serve.
 *
 *   il BUONO e' del marchio     — si compra ovunque e si spende ovunque
 *   la VENDITA e' di un punto   — chi ha incassato
 *   l'USO e' di un punto        — chi ha servito
 *
 * Qui gli errori non danno mai errore, e vanno in due direzioni opposte.
 *
 * Filtrando il buono per sede, un codice comprato a Jourdan risulta
 * INESISTENTE a Stockel: il cliente si sente dire che il suo buono non
 * esiste, e nei log non compare niente perche' non e' successo niente.
 *
 * Non registrando dove si e' venduto, non succede niente per mesi — e poi
 * a fine anno nessuno sa quanto Jourdan deve a Stockel, e non c'e' query
 * che possa ricostruirlo: il fatto non e' stato scritto da nessuna parte.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { inchiostroPdf, hexPdf, suFondoPdf } from "../src/lib/pdfTesto.ts";
import { sedeDiVendita, contoDeiBuoni, relevePunto, giornoLocale } from "../src/lib/buoniRegole.ts";
import {
  sede, SEDE_UNICA, tutteLeSedi, filtroPer, sedeDaScrivere, CLASSIFICA,
} from "../src/lib/admin/sedeRegole.ts";

const STOCKEL = "11111111-1111-1111-1111-111111111111";
const JOURDAN = "22222222-2222-2222-2222-222222222222";
const SCHAERBEEK = "33333333-3333-3333-3333-333333333333";

const buono = (o) => ({ id: "b1", code: "BON-1", initial_cents: 5000, ...o });
const uso = (o) => ({ gift_card_id: "b1", amount_cents: 1000, ...o });
const quotaDi = (conto, id) => conto.quote.find((q) => q.id === id);

/* ============================================================
   CHI INCASSA — `sedeDiVendita`
   ============================================================ */

test("a punto unico non c'e' niente da attribuire: NULL", () => {
  assert.equal(sedeDiVendita(SEDE_UNICA), null);
});

test("con piu' punti, incassa quello da cui si sta creando il buono", () => {
  assert.equal(sedeDiVendita(sede(JOURDAN)), JOURDAN);
});

test("l'aggregato non vende: «tutte» lancia invece di scegliere a caso", () => {
  // Fino al 16/09/2026 questo ramo passava: con «toutes les adresses»
  // selezionata il pagamento usciva dallo Stripe del .env e l'incasso non
  // era di nessuno. Un incasso attribuito a tutti non e' attribuito.
  assert.throws(() => sedeDiVendita(tutteLeSedi()), /sola lettura/);
});

/* ============================================================
   IL BUONO NON SI FILTRA — e questa e' la rete piu' importante
   ============================================================ */

test("il buono resta del marchio: nessun filtro per sede in lettura", () => {
  // Rompere `gift_cards: "marchio"` in "sede" fa diventare rossa questa riga.
  // E' la mutazione che, non vista, farebbe sparire i buoni degli altri punti.
  assert.equal(CLASSIFICA.gift_cards, "marchio");
  assert.equal(filtroPer("gift_cards", sede(STOCKEL)).tipo, "nessuno");
  assert.equal(filtroPer("gift_cards", sede(JOURDAN)).tipo, "nessuno");
});

test("un buono comprato a Jourdan si vede anche da Stockel", () => {
  // La stessa cosa detta come la vive il cliente: il filtro che non c'e'.
  for (const punto of [STOCKEL, JOURDAN, SCHAERBEEK]) {
    assert.equal(filtroPer("gift_cards", sede(punto)).tipo, "nessuno");
  }
});

test("la RIGA del buono non prende una sede: `location_id` resta NULL", () => {
  // `sold_at_location` e `location_id` rispondono a due domande diverse.
  // Questa riga dice che la seconda resta vuota anche quando la prima no.
  assert.equal(sedeDaScrivere("gift_cards", sede(JOURDAN)), null);
  assert.equal(sedeDiVendita(sede(JOURDAN)), JOURDAN);
});

test("l'UTILIZZO invece e' di un punto: si filtra e si scrive", () => {
  assert.equal(CLASSIFICA.gift_card_redemptions, "sede");
  const f = filtroPer("gift_card_redemptions", sede(STOCKEL));
  assert.equal(f.tipo, "sede");
  assert.equal(f.valore, STOCKEL);
  assert.equal(sedeDaScrivere("gift_card_redemptions", sede(STOCKEL)), STOCKEL);
});

/* ============================================================
   IL CONTO FRA LE SOCIETA'
   ============================================================ */

test("chi vende e chi serve finiscono su due righe diverse", () => {
  const c = contoDeiBuoni({
    buoni: [buono({ sold_at_location: JOURDAN })],
    riscatti: [uso({ amount_cents: 3000, location_id: STOCKEL })],
  });
  assert.equal(quotaDi(c, JOURDAN).venduto, 5000);
  assert.equal(quotaDi(c, JOURDAN).speso, 0);
  assert.equal(quotaDi(c, STOCKEL).venduto, 0);
  assert.equal(quotaDi(c, STOCKEL).speso, 3000);
});

test("il saldo dice chi deve a chi", () => {
  // Jourdan ha incassato 50 e servito 0: deve 50 al gruppo.
  // Stockel ha incassato 0 e servito 30: gli spettano 30.
  const c = contoDeiBuoni({
    buoni: [buono({ sold_at_location: JOURDAN })],
    riscatti: [uso({ amount_cents: 3000, location_id: STOCKEL })],
  });
  assert.equal(quotaDi(c, JOURDAN).saldo, 5000);
  assert.equal(quotaDi(c, STOCKEL).saldo, -3000);
});

test("chi deve di piu' sta in cima", () => {
  const c = contoDeiBuoni({
    buoni: [
      buono({ id: "a", initial_cents: 1000, sold_at_location: STOCKEL }),
      buono({ id: "b", initial_cents: 9000, sold_at_location: JOURDAN }),
    ],
    riscatti: [],
  });
  assert.deepEqual(c.quote.map((q) => q.id), [JOURDAN, STOCKEL]);
});

test("un buono non ancora pagato non e' un incasso", () => {
  // Il link di pagamento e' partito, i soldi non sono arrivati. Contarlo
  // vorrebbe dire far pagare a Jourdan un incasso che non ha visto.
  const c = contoDeiBuoni({
    buoni: [buono({ paid: false, sold_at_location: JOURDAN })],
    riscatti: [],
  });
  assert.equal(c.venduto, 0);
  assert.equal(quotaDi(c, JOURDAN), undefined);
});

test("le parti fanno il tutto", () => {
  const c = contoDeiBuoni({
    buoni: [
      buono({ id: "a", initial_cents: 5000, sold_at_location: JOURDAN }),
      buono({ id: "b", initial_cents: 3000, sold_at_location: STOCKEL }),
      buono({ id: "c", initial_cents: 2000, sold_at_location: SCHAERBEEK }),
    ],
    riscatti: [
      uso({ gift_card_id: "a", amount_cents: 1500, location_id: STOCKEL }),
      uso({ gift_card_id: "b", amount_cents: 3000, location_id: SCHAERBEEK }),
    ],
  });
  const sommaV = c.quote.reduce((t, q) => t + q.venduto, 0);
  const sommaS = c.quote.reduce((t, q) => t + q.speso, 0);
  assert.equal(sommaV, c.venduto);
  assert.equal(sommaS, c.speso);
  assert.equal(c.venduto, 10000);
  assert.equal(c.speso, 4500);
});

test("«aperto» e' il debito del gruppo verso i clienti", () => {
  const c = contoDeiBuoni({
    buoni: [buono({ initial_cents: 5000, sold_at_location: JOURDAN })],
    riscatti: [uso({ amount_cents: 2000, location_id: JOURDAN })],
  });
  assert.equal(c.aperto, 3000); // il cliente ha ancora 30 € da spendere
});

test("lo storico senza punto non sparisce: finisce sotto «senza sede»", () => {
  // I buoni venduti prima del 16/09/2026 non hanno un punto ricostruibile.
  // Inventarglielo sarebbe peggio del vuoto: il vuoto si vede.
  const c = contoDeiBuoni({
    buoni: [buono({ sold_at_location: null })],
    riscatti: [uso({ amount_cents: 1000, location_id: undefined })],
  });
  assert.equal(quotaDi(c, null).venduto, 5000);
  assert.equal(quotaDi(c, null).speso, 1000);
});

test("un buono speso piu' di quanto vale si RIPORTA, non fa esplodere la pagina", () => {
  const c = contoDeiBuoni({
    buoni: [buono({ code: "BON-XY", initial_cents: 1000, sold_at_location: JOURDAN })],
    riscatti: [uso({ amount_cents: 1500, location_id: STOCKEL })],
  });
  assert.deepEqual(c.incoerenti, ["BON-XY"]);
  assert.equal(c.speso, 1500); // il conto si fa lo stesso, e dice la verita'
});

test("un utilizzo che punta a un buono sconosciuto non passa in silenzio", () => {
  const c = contoDeiBuoni({
    buoni: [buono({ id: "b1" })],
    riscatti: [uso({ gift_card_id: "fantasma", amount_cents: 500 })],
  });
  assert.deepEqual(c.incoerenti, ["fantasma"]);
});

test("filtrando i riscatti il conto si gonfia — per questo si passano interi", () => {
  // La dimostrazione del perche' `contoDeiBuoni` vuole le due liste intere.
  // Se i riscatti arrivassero filtrati sulla sede selezionata, il punto che
  // ha venduto risulterebbe creditore di soldi gia' spesi altrove.
  const buoni = [buono({ sold_at_location: JOURDAN })];
  const tutti = [
    uso({ amount_cents: 2000, location_id: STOCKEL }),
    uso({ amount_cents: 1000, location_id: JOURDAN }),
  ];
  const interi = contoDeiBuoni({ buoni, riscatti: tutti });
  const filtrati = contoDeiBuoni({ buoni, riscatti: tutti.filter((r) => r.location_id === JOURDAN) });
  assert.equal(interi.aperto, 2000);
  assert.equal(filtrati.aperto, 4000); // 20 € che il cliente ha gia' speso
  assert.notEqual(interi.aperto, filtrati.aperto);
});

test("importi assurdi non rompono il conto", () => {
  const c = contoDeiBuoni({
    buoni: [buono({ initial_cents: -5000, sold_at_location: JOURDAN })],
    riscatti: [
      uso({ amount_cents: null }),
      uso({ amount_cents: NaN }),
      uso({ amount_cents: -300 }),
    ],
  });
  assert.equal(c.venduto, 0);
  assert.equal(c.speso, 0);
});

test("senza buoni e senza usi il conto e' vuoto, non rotto", () => {
  const c = contoDeiBuoni({ buoni: [], riscatti: [] });
  assert.deepEqual(c.quote, []);
  assert.equal(c.venduto, 0);
  assert.equal(c.speso, 0);
  assert.equal(c.aperto, 0);
  assert.deepEqual(c.incoerenti, []);
});

/* ============================================================
   IL FATTO VIENE DAVVERO SCRITTO
   ============================================================ */

/** Via i commenti, ma NON le stringhe: qui si cerca del codice vero.
 *  Si tolgono i blocchi e le righe che COMINCIANO con `//`, cosi' un
 *  `https://` dentro una stringa non mangia il resto della riga. */
function senzaCommenti(testo) {
  return testo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((r) => !/^\s*\/\//.test(r))
    .join("\n");
}

test("creando un buono si scrive CHI HA INCASSATO", () => {
  const api = senzaCommenti(readFileSync("src/pages/api/admin/gift-cards.ts", "utf8"));
  assert.match(api, /sold_at_location:\s*sedeDiVendita\(/);
});

test("il registro dei riscatti si legge SENZA filtro di sede", () => {
  // La cronologia deve tornare con il saldo: 50 caricati, 20 spesi a
  // Jourdan, e da Stockel si deve continuare a vedere quei 20.
  const api = senzaCommenti(readFileSync("src/pages/api/admin/gift-cards.ts", "utf8"));
  const lettura = api.slice(api.indexOf("gift_card_redemptions"));
  assert.ok(
    !/\.eq\(\s*["']location_id["']/.test(lettura),
    "il registro dei riscatti non deve essere filtrato per sede",
  );
});

test("nessuno filtra i buoni per il punto di vendita", () => {
  const api = senzaCommenti(readFileSync("src/pages/api/admin/gift-cards.ts", "utf8"));
  assert.ok(
    !/\.eq\(\s*["']sold_at_location["']/.test(api),
    "`sold_at_location` dice chi ha incassato: non e' una colonna su cui filtrare",
  );
});

/* ============================================================
   LA COLONNA ESISTE E NON DIVENTA UNA COLONNA DI SEDE
   ============================================================ */

/** Il SQL senza i suoi commenti. Stessa lezione, in un'altra lingua: il
 *  15/09/2026 un commento con degli apostrofi italiani ha fatto vedere a
 *  una rete una tabella che non esisteva. */
const sqlNudo = (t) => t.split("\n").map((r) => r.replace(/--.*$/, "")).join("\n");

test("la migrazione aggiunge il punto di vendita ai buoni", () => {
  const sql = sqlNudo(readFileSync("supabase/locations.sql", "utf8"));
  assert.match(sql, /alter table public\.gift_cards[\s\S]{0,120}sold_at_location/);
});

test("i buoni NON sono fra le tabelle a cui si assegna lo storico", () => {
  // `assegna_storico_sede()` riempie i NULL delle tabelle di sede. Se
  // `gift_cards` finisse in quell'elenco, ogni buono del gruppo diventerebbe
  // di un punto solo — e con i buoni sarebbe irreversibile: il cliente si
  // vedrebbe rifiutare un codice valido.
  const sql = sqlNudo(readFileSync("supabase/locations.sql", "utf8"));
  const elenco = sql.slice(sql.indexOf("function public.tabelle_di_sede"));
  const corpo = elenco.slice(0, elenco.indexOf("$$;"));
  assert.ok(!/'gift_cards'/.test(corpo), "gift_cards non e' una tabella di sede");
  assert.ok(/'gift_card_redemptions'/.test(corpo), "l'utilizzo invece lo e'");
});

/* ============================================================
   IL RELEVE' PER IL CONTABILE
   ============================================================ */

const BXL = "Europe/Brussels";
const card = (o) => ({ id: "b1", code: "BON-1", initial_cents: 5000, created_at: "2026-03-10T12:00:00Z", ...o });
const usoIl = (o) => ({ gift_card_id: "b1", amount_cents: 1000, created_at: "2026-03-20T12:00:00Z", ...o });
const rel = (o) => relevePunto({ buoni: [], riscatti: [], punto: STOCKEL, da: "2026-01-01", a: "2026-12-31", fuso: BXL, ...o });

test("il giorno e' quello del ristorante, non quello di Greenwich", () => {
  // Una vendita dell'1 gennaio alle 00:30 a Bruxelles e' ancora il 31
  // dicembre in UTC: tagliando la stringa ISO finirebbe nell'esercizio
  // precedente. Su un documento contabile e' l'errore che poi qualcuno
  // deve spiegare.
  const istante = "2025-12-31T23:30:00Z";
  assert.equal(istante.slice(0, 10), "2025-12-31");   // il taglio ingenuo
  assert.equal(giornoLocale(istante, BXL), "2026-01-01"); // la verita' in sala
});

test("un fuso che non esiste non fa saltare il documento", () => {
  assert.equal(giornoLocale("2026-03-10T12:00:00Z", "Mars/Olympus"), "2026-03-10");
});

test("nel relevé finiscono solo le vendite di questa sede", () => {
  const r = rel({
    buoni: [
      card({ id: "a", code: "NOSTRO", sold_at_location: STOCKEL }),
      card({ id: "b", code: "LORO", sold_at_location: JOURDAN }),
    ],
  });
  assert.deepEqual(r.vendite.map((v) => v.codice), ["NOSTRO"]);
  assert.equal(r.totali.venduto, 5000);
});

test("le date di confine sono comprese", () => {
  const dentro = relevePunto({
    buoni: [card({ sold_at_location: STOCKEL, created_at: "2026-03-01T10:00:00Z" })],
    riscatti: [], punto: STOCKEL, da: "2026-03-01", a: "2026-03-01", fuso: BXL,
  });
  assert.equal(dentro.vendite.length, 1);
  const fuori = relevePunto({
    buoni: [card({ sold_at_location: STOCKEL, created_at: "2026-03-01T10:00:00Z" })],
    riscatti: [], punto: STOCKEL, da: "2026-03-02", a: "2026-03-31", fuso: BXL,
  });
  assert.equal(fuori.vendite.length, 0);
});

test("un buono non pagato si vede, ma non e' cassa", () => {
  const r = rel({ buoni: [card({ sold_at_location: STOCKEL, paid: false })] });
  assert.equal(r.vendite.length, 1);
  assert.equal(r.vendite[0].pagato, false);
  assert.equal(r.totali.venduto, 5000);
  assert.equal(r.totali.incassato, 0);
});

test("chi ha venduto e chi ha servito si leggono separati", () => {
  const r = rel({
    buoni: [
      card({ id: "mio", code: "MIO", sold_at_location: STOCKEL }),
      card({ id: "suo", code: "SUO", sold_at_location: JOURDAN }),
    ],
    riscatti: [
      usoIl({ gift_card_id: "mio", amount_cents: 1000, location_id: STOCKEL }),
      usoIl({ gift_card_id: "suo", amount_cents: 2000, location_id: STOCKEL }),
    ],
  });
  assert.equal(r.totali.usatoQui, 3000);
  assert.equal(r.totali.usatoQuiNostri, 1000);
  assert.equal(r.totali.usatoQuiAltrui, 2000);
});

test("i nostri buoni onorati altrove sono una riga a parte", () => {
  const r = rel({
    buoni: [card({ sold_at_location: STOCKEL })],
    riscatti: [usoIl({ amount_cents: 1500, location_id: JOURDAN })],
  });
  assert.equal(r.totali.usatoQui, 0);
  assert.equal(r.totali.altrove, 1500);
  assert.equal(r.altrove[0].usatoA, JOURDAN);      // dove e' stato speso
  assert.equal(r.altrove[0].vendutoDa, STOCKEL);   // chi l'aveva venduto
});

test("il saldo verso un'altra sede ha il segno giusto", () => {
  const r = rel({
    buoni: [
      card({ id: "mio", sold_at_location: STOCKEL }),
      card({ id: "suo", sold_at_location: JOURDAN }),
    ],
    riscatti: [
      // Abbiamo servito un cliente di Jourdan: Jourdan ci deve.
      usoIl({ gift_card_id: "suo", amount_cents: 2000, location_id: STOCKEL }),
      // Jourdan ha servito un nostro cliente: gli dobbiamo.
      usoIl({ gift_card_id: "mio", amount_cents: 500, location_id: JOURDAN }),
    ],
  });
  const v = r.totali.versoAltre.find((x) => x.id === JOURDAN);
  assert.equal(v.saldo, 1500); // positivo = ci deve
});

test("due movimenti che si compensano non lasciano una riga a zero", () => {
  const r = rel({
    buoni: [
      card({ id: "mio", sold_at_location: STOCKEL }),
      card({ id: "suo", sold_at_location: JOURDAN }),
    ],
    riscatti: [
      usoIl({ gift_card_id: "suo", amount_cents: 1000, location_id: STOCKEL }),
      usoIl({ gift_card_id: "mio", amount_cents: 1000, location_id: JOURDAN }),
    ],
  });
  assert.deepEqual(r.totali.versoAltre, []);
});

test("quello che resta da onorare e' una fotografia, non un periodo", () => {
  // 50 € venduti a marzo, 20 spesi a marzo, 10 a dicembre. Il relevé del
  // solo mese di marzo deve comunque dire che alla fine dell'anno restano
  // 20 €: e' un debito verso il cliente alla data, non un movimento.
  const buoni = [card({ sold_at_location: STOCKEL })];
  const riscatti = [
    usoIl({ amount_cents: 2000, created_at: "2026-03-20T12:00:00Z", location_id: STOCKEL }),
    usoIl({ amount_cents: 1000, created_at: "2026-12-10T12:00:00Z", location_id: JOURDAN }),
  ];
  const marzo = relevePunto({ buoni, riscatti, punto: STOCKEL, da: "2026-03-01", a: "2026-03-31", fuso: BXL });
  assert.equal(marzo.totali.usatoQui, 2000);
  assert.equal(marzo.totali.daOnorare, 3000); // al 31 marzo
  const anno = relevePunto({ buoni, riscatti, punto: STOCKEL, da: "2026-01-01", a: "2026-12-31", fuso: BXL });
  assert.equal(anno.totali.daOnorare, 2000); // al 31 dicembre
});

test("un buono venduto dopo la data di fine non e' ancora un debito", () => {
  const r = relevePunto({
    buoni: [card({ sold_at_location: STOCKEL, created_at: "2026-06-01T10:00:00Z" })],
    riscatti: [], punto: STOCKEL, da: "2026-01-01", a: "2026-03-31", fuso: BXL,
  });
  assert.equal(r.totali.daOnorare, 0);
});

test("un buono non pagato non e' un debito verso il cliente", () => {
  // Non ha ancora dato niente: non gli si deve niente.
  const r = rel({ buoni: [card({ sold_at_location: STOCKEL, paid: false })] });
  assert.equal(r.totali.daOnorare, 0);
});

test("a sede unica il documento resta valido e non parla di confini", () => {
  const r = relevePunto({
    buoni: [card({ sold_at_location: null })],
    riscatti: [usoIl({ amount_cents: 1000, location_id: null })],
    punto: null, da: "2026-01-01", a: "2026-12-31", fuso: BXL,
  });
  assert.equal(r.totali.venduto, 5000);
  assert.equal(r.totali.usatoQui, 1000);
  assert.equal(r.totali.usatoQuiNostri, 1000);
  assert.deepEqual(r.totali.versoAltre, []);
  assert.deepEqual(r.altrove, []);
});

test("filtrando i riscatti la meta' interessante del relevé sparisce", () => {
  // La dimostrazione del perche' l'endpoint legge le due liste INTERE: se
  // chiedesse al database solo le righe di questa sede, «i nostri buoni
  // usati altrove» sarebbe sempre zero — e uno zero sembra un dato, non un
  // buco. Nessun errore, nessun log, e un contabile che non torna.
  const buoni = [card({ sold_at_location: STOCKEL })];
  const tutti = [usoIl({ amount_cents: 1500, location_id: JOURDAN })];
  const interi = relevePunto({ buoni, riscatti: tutti, punto: STOCKEL, da: "2026-01-01", a: "2026-12-31", fuso: BXL });
  const mutilati = relevePunto({
    buoni,
    riscatti: tutti.filter((r) => r.location_id === STOCKEL),
    punto: STOCKEL, da: "2026-01-01", a: "2026-12-31", fuso: BXL,
  });
  assert.equal(interi.totali.altrove, 1500);
  assert.equal(mutilati.totali.altrove, 0);
  assert.equal(mutilati.totali.daOnorare, 5000); // e il debito risulta intero
});

test("il relevé si costruisce senza dati e non esplode", () => {
  const r = rel({});
  assert.deepEqual(r.vendite, []);
  assert.deepEqual(r.usi, []);
  assert.deepEqual(r.altrove, []);
  assert.equal(r.totali.daOnorare, 0);
});

test("le due funzioni del PDF stanno in un posto solo", () => {
  // `euro` e `pulisci` erano sul punto di diventare due copie. pdf-lib con i
  // font standard LANCIA su un carattere fuori WinAnsi — non fa un
  // quadratino, non produce il PDF — quindi due versioni che divergono
  // vogliono dire un documento che a volte non esce.
  const bon = readFileSync("src/pages/api/bon-pdf.ts", "utf8");
  const rep = readFileSync("src/pages/api/admin/gift-cards-pdf.ts", "utf8");
  for (const f of [bon, rep]) assert.match(f, /from "(\.\.\/)+lib\/pdfTesto"/);
  assert.ok(!/function pulisci\s*\(/.test(bon), "nessuna copia locale di pulisci");
});

test("i PDF usano i colori dichiarati dal cliente, non tre costanti", () => {
  // Il 16/09/2026 il buono regalo di ogni ristorante usciva col grigio e
  // l'oro di un ALTRO cliente: tre `rgb(...)` scritti a mano e mai piu' visti.
  // Non dava errore, non finiva in nessun log — si vedeva solo aprendo il
  // PDF, e nessuno apre il PDF di un cliente che non e' il suo.
  for (const f of ["src/pages/api/bon-pdf.ts", "src/pages/api/admin/gift-cards-pdf.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /temaEmail\(\)/, `${f} non legge il tema del cliente`);
    assert.ok(
      !/rgb\(0\.874,\s*0\.671,\s*0\.306\)/.test(src),
      `${f} ha ancora l'accento di un altro ristorante scritto a mano`,
    );
  }
});

test("un accento chiaro resta leggibile sulla carta bianca", () => {
  // Un tema scuro dichiara un accento chiaro perche' li' sta su fondo nero.
  // Stampato tale e quale sparisce: sulla carta si scurisce quanto basta.
  const chiaro = inchiostroPdf("#ffe08a");
  assert.ok(chiaro.r < 1 && chiaro.g < 0.9, "un giallo pallido va scurito");
  const gia = inchiostroPdf("#1a1a1a");
  assert.deepEqual(gia, hexPdf("#1a1a1a"), "un colore gia' scuro non si tocca");
});

test("il testo sopra la banda si legge in tutti e due i versi", () => {
  assert.deepEqual(suFondoPdf("#101010"), { r: 1, g: 1, b: 1 });      // fondo scuro -> bianco
  assert.equal(suFondoPdf("#ffffff").r < 0.2, true);                  // fondo chiaro -> quasi nero
  assert.deepEqual(suFondoPdf("non-un-colore"), { r: 1, g: 1, b: 1 }); // ignoto -> nero, testo bianco
});
