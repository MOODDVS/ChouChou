/**
 * I CLIENTI — il comportamento, non l'impianto.
 *
 * Il cliente e' del MARCHIO: una persona sola per le tre pizzerie. Ma la sua
 * storia e' fatta di righe che appartengono alle sedi — ordini e prenotazioni
 * — quindi «una persona sola» non e' un fatto, e' una cosa che il codice deve
 * COSTRUIRE ogni volta, fondendo pezzi che arrivano da tre posti.
 *
 * Qui si prova quella fusione. Se sbaglia non da' errore: da' tre schede al
 * posto di una, o una spesa a meta'. E un cliente da 300 € trattato come uno
 * da 40 e' una persona che smette di tornare.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { chiaveCliente, uniscoClienti } from "../src/lib/admin/clientiRegole.ts";

const ord = (o) => ({
  customer_name: null, customer_email: null, customer_phone: null,
  total_cents: 0, created_at: "2026-01-01T12:00:00Z", ...o,
});
const resa = (r) => ({
  first_name: null, last_name: null, email: null, phone: null,
  status: "confirmed", created_at: "2026-01-01T12:00:00Z", ...r,
});
const manuale = (m) => ({
  id: "m1", name: null, email: null, phone: null, hidden: false, ...m,
});
const unisci = (d) => uniscoClienti({ ordini: [], rese: [], manuali: [], ...d });

/* ============================================================
   L'IDENTITA': email, poi telefono, poi nome
   ============================================================ */

test("l'email decide, e non guarda le maiuscole", () => {
  assert.equal(chiaveCliente("Marco@Test.BE", "0470", "Marco"), "marco@test.be");
});

test("senza email vale il telefono; senza telefono, il nome", () => {
  assert.equal(chiaveCliente("", "+32470111222", "Marco"), "+32470111222");
  assert.equal(chiaveCliente("", "", "Marco Rossi"), "marco rossi");
  assert.equal(chiaveCliente("", "", ""), "");
});

/* ============================================================
   LA FUSIONE FRA SEDI — la ragione per cui tutto questo esiste
   ============================================================ */

test("la stessa persona in tre pizzerie e' UNA scheda con la spesa intera", () => {
  // ⚠️ Il test che conta. Le righe arrivano dall'aggregato, quindi gli ordini
  // dei tre punti sono mescolati: devono ricomporsi in una persona sola.
  const c = unisci({
    ordini: [
      ord({ customer_email: "marco@test.be", customer_name: "Marco", total_cents: 4000 }),
      ord({ customer_email: "MARCO@test.be", customer_name: "Marco", total_cents: 12000 }),
      ord({ customer_email: "marco@test.be", customer_name: "Marco Rossi", total_cents: 14000 }),
    ],
  });
  assert.equal(c.length, 1, "la stessa persona e' diventata piu' schede");
  assert.equal(c[0].total_cents, 30000);
  assert.equal(c[0].orders, 3);
});

test("chi ordina in un punto e prenota in un altro resta una persona sola", () => {
  const c = unisci({
    ordini: [ord({ customer_email: "lea@test.be", customer_name: "Lea", total_cents: 5000 })],
    rese: [resa({ email: "lea@test.be", first_name: "Lea", last_name: "D." })],
  });
  assert.equal(c.length, 1);
  assert.equal(c[0].orders, 1);
  assert.equal(c[0].reservations, 1);
  assert.equal(c[0].total_cents, 5000);
});

test("chi ha solo prenotato esiste lo stesso, con zero speso", () => {
  const c = unisci({ rese: [resa({ email: "sara@test.be", first_name: "Sara" })] });
  assert.equal(c.length, 1);
  assert.equal(c[0].orders, 0);
  assert.equal(c[0].total_cents, 0);
  assert.equal(c[0].reservations, 1);
});

test("due persone diverse restano due", () => {
  const c = unisci({
    ordini: [
      ord({ customer_email: "a@test.be", total_cents: 1000 }),
      ord({ customer_email: "b@test.be", total_cents: 2000 }),
    ],
  });
  assert.equal(c.length, 2);
});

/* ============================================================
   I CONTEGGI
   ============================================================ */

test("una prenotazione annullata non conta, ma il cliente resta in lista", () => {
  const c = unisci({
    rese: [
      resa({ email: "lea@test.be", status: "confirmed" }),
      resa({ email: "lea@test.be", status: "cancelled" }),
    ],
  });
  assert.equal(c.length, 1);
  assert.equal(c[0].reservations, 1, "l'annullata e' stata contata");
});

test("un no-show conta come prenotazione E come no-show", () => {
  const c = unisci({ rese: [resa({ email: "lea@test.be", status: "noshow" })] });
  assert.equal(c[0].reservations, 1);
  assert.equal(c[0].noshows, 1);
});

test("l'ultimo ordine e' il piu' recente, la prima attivita' la piu' vecchia", () => {
  const c = unisci({
    ordini: [
      ord({ customer_email: "x@test.be", created_at: "2026-03-01T10:00:00Z" }),
      ord({ customer_email: "x@test.be", created_at: "2026-01-01T10:00:00Z" }),
    ],
    // Una prenotazione ancora piu' vecchia, magari fatta in un altro punto.
    rese: [resa({ email: "x@test.be", created_at: "2025-06-01T10:00:00Z" })],
  });
  assert.equal(c[0].last_order, "2026-03-01T10:00:00Z");
  assert.equal(c[0].first_activity, "2025-06-01T10:00:00Z");
});

test("la lista e' ordinata per spesa, dal piu' alto", () => {
  const c = unisci({
    ordini: [
      ord({ customer_email: "piccolo@test.be", total_cents: 500 }),
      ord({ customer_email: "grande@test.be", total_cents: 90000 }),
      ord({ customer_email: "medio@test.be", total_cents: 3000 }),
    ],
  });
  assert.deepEqual(c.map((x) => x.email), ["grande@test.be", "medio@test.be", "piccolo@test.be"]);
});

/* ============================================================
   LA SCHEDA CURATA vince sull'aggregazione
   ============================================================ */

test("il dato scritto a mano nel modale prevale sui dati degli ordini", () => {
  // ⚠️ Prima riempiva solo i buchi, e correggere un cognome dal modale non
  // si vedeva mai: l'ordine successivo lo riscriveva com'era.
  const c = unisci({
    ordini: [ord({ customer_email: "marco@test.be", customer_name: "marco r", customer_phone: "0470" })],
    manuali: [manuale({ email: "marco@test.be", name: "Marco Rossi", phone: "+32470111222" })],
  });
  assert.equal(c.length, 1);
  assert.equal(c[0].name, "Marco Rossi");
  assert.equal(c[0].phone, "+32470111222");
  assert.equal(c[0].manual, true);
  assert.equal(c[0].id, "m1");
});

test("un cliente nascosto sparisce anche se ha ordini in un'altra sede", () => {
  // ⚠️ Cancellare un cliente lo NASCONDE quando ha attivita': il record
  // manuale con `hidden` deve zittire anche l'aggregazione, altrimenti
  // riappare al primo ricaricamento («serve cancellare due volte»).
  const c = unisci({
    ordini: [ord({ customer_email: "via@test.be", total_cents: 9000 })],
    rese: [resa({ email: "via@test.be" })],
    manuali: [manuale({ email: "via@test.be", hidden: true })],
  });
  assert.deepEqual(c, []);
});

test("bloccato: e' un dato del marchio, non di un punto", () => {
  // `clients` e' una tabella di marchio, quindi il blocco vale ovunque.
  // Questo test lo fissa: se un giorno diventasse per sede, qui si vede.
  const c = unisci({
    ordini: [ord({ customer_email: "bloc@test.be", total_cents: 100 })],
    manuali: [manuale({ email: "bloc@test.be", blocked: true })],
  });
  assert.equal(c[0].blocked, true);
});

test("l'opt-out newsletter si riconosce senza guardare le maiuscole", () => {
  const c = uniscoClienti({
    ordini: [ord({ customer_email: "Stop@Test.be", total_cents: 100 })],
    rese: [], manuali: [], optout: ["stop@test.be"],
  });
  assert.equal(c[0].newsletter_optout, true);
});

/* ============================================================
   I CASI SPORCHI
   ============================================================ */

test("righe senza nessun contatto si scartano, non creano un cliente vuoto", () => {
  const c = unisci({
    ordini: [ord({ total_cents: 5000 })],
    rese: [resa({})],
  });
  assert.deepEqual(c, []);
});

test("gli spazi attorno ai contatti non creano doppioni", () => {
  const c = unisci({
    ordini: [
      ord({ customer_email: "  marco@test.be ", total_cents: 1000 }),
      ord({ customer_email: "marco@test.be", total_cents: 2000 }),
    ],
  });
  assert.equal(c.length, 1);
  assert.equal(c[0].total_cents, 3000);
});

/* ============================================================
   LE RETI — dove si legge, e in quanti posti
   ============================================================ */

test("la storia del cliente si legge sempre sull'AGGREGATO, mai su una sede", () => {
  // ⚠️ E' il difetto trovato il 16/09/2026: la prima pittura sul server usava
  // l'aggregato, l'API la sede selezionata. La pagina compariva con i totali
  // del gruppo e mezzo secondo dopo si riscriveva con quelli di un punto —
  // due verita' sulla stessa persona, e nessun modo di sapere quale valesse.
  for (const f of ["src/lib/admin/caricaClienti.ts", "src/pages/api/admin/clients.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /const ambito = tutteLeSedi\(\);/, `${f}: non legge sull'aggregato`);
    assert.equal(
      /ambitoDiRichiesta\(/.test(src),
      false,
      `${f}: la storia del cliente dipende dalla sede selezionata nell'header`,
    );
  }
});

test("l'aggregazione dei clienti esiste in UN posto solo", () => {
  // ⚠️ Erano 97 righe copiate in due file, con in cima un commento che
  // diceva «copia FEDELE, aggiornala anche qui». Le copie divergono sempre:
  // queste lo avevano gia' fatto. Questa rete impedisce che rinascano.
  for (const f of ["src/lib/admin/caricaClienti.ts", "src/pages/api/admin/clients.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /uniscoClienti\(/, `${f}: non usa la regola comune`);
    assert.equal(
      /const mappa = new Map<string, Cliente>\(\)/.test(src),
      false,
      `${f}: si e' rifatto la sua aggregazione invece di chiamare uniscoClienti`,
    );
    assert.equal(
      /^function chiave\(/m.test(src),
      false,
      `${f}: ha una sua copia della chiave d'identita'`,
    );
  }
});

test("le regole dei clienti non importano niente", () => {
  // Stesso patto di `sedeRegole.ts` e `salaRegole.ts`: pure, provabili senza
  // database, quindi i test girano sulla funzione vera e non su una copia.
  const src = readFileSync("src/lib/admin/clientiRegole.ts", "utf8");
  assert.equal(/^import /m.test(src), false, "clientiRegole.ts ha cominciato a importare qualcosa");
});
