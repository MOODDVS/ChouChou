/**
 * LA COLONNA «COMMANDES» — i soldi entrati, quelli che devono entrare.
 *
 * ⚠️ IL GUASTO CHE QUESTE PROVE TENGONO CHIUSO (08/10/2026). «Incassato»
 * voleva dire `total_cents` in QUATTRO posti — la colonna della Accueil, la
 * pastiglia della pagina Commandes, le statistiche e la mail del mattino — e
 * in tutti e quattro era sbagliato per gli stessi due motivi:
 *
 *   - un RIMBORSO non tornava indietro: `refunded_cents` arrivava nella
 *     risposta dell'API e nessuno lo leggeva, cosi' un ordine da 60 €
 *     rimborsato per intero restava 60 € di incasso su ogni schermo, mentre la
 *     card della pagina Commandes diceva «↩ Remboursé» su quella stessa riga;
 *   - un SUPPLEMENTO DOVUTO non era ancora entrato: una modifica al rialzo
 *     alza il totale e segna la differenza da farsi dare al banco. Contata
 *     come incassata, la giornata diceva di aver preso soldi che qualcuno
 *     deve ancora pagare — e il promemoria per chiederli non c'era.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  entrato, incassato, righeIncassate, panierMedio, restaDaIncassare,
  daServire, fatti, statoOrdine, piattiVeri, notaCliente,
  rimborsato, rimborsi, conRimborso,
} from "../src/lib/admin/ordiniConti.ts";
import { euroDa } from "../src/lib/soldi.ts";

/* Una giornata come quella che ha fatto nascere queste prove. */
const GIORNATA = [
  { status: "paid", total_cents: 4500 },
  // Ritirato, e meta' rimborsata: il piatto era sbagliato.
  { status: "done", total_cents: 6000, refunded_cents: 3000 },
  // Pagato online, poi aumentato: 1.000 da farsi dare al banco.
  { status: "paid", total_cents: 5000, supplement_due_cents: 1000 },
  // Aspetta che il cliente paghi il link.
  { status: "pending", total_cents: 2500, payment_method: null },
  // Si incassa al banco al ritiro.
  { status: "pending", total_cents: 3000, payment_method: "onsite" },
  // Annullato: non e' mai entrato niente.
  { status: "cancelled", total_cents: 8000 },
];

test("un rimborso esce dall'incasso, un supplemento dovuto non ci entra", () => {
  assert.equal(entrato({ status: "paid", total_cents: 6000 }), 6000);
  assert.equal(entrato({ status: "done", total_cents: 6000, refunded_cents: 6000 }), 0, "rimborsato per intero");
  assert.equal(entrato({ status: "done", total_cents: 6000, refunded_cents: 3000 }), 3000);
  assert.equal(entrato({ status: "paid", total_cents: 5000, supplement_due_cents: 1000 }), 4000);
  // ⚠️ `refund_due_cents` NON si sottrae: e' un rimborso deciso e non ancora
  // fatto, e quel denaro e' ancora nel cassetto. Sottrarlo adesso e poi di
  // nuovo quando esce vorrebbe dire contarlo due volte.
  assert.equal(entrato({ status: "paid", total_cents: 5000, refund_due_cents: 2000 }), 5000);
  // Mai negativo: un rimborso piu' grande del totale (riga ritoccata a mano)
  // si mangerebbe l'incasso di un altro ordine.
  assert.equal(entrato({ status: "done", total_cents: 1000, refunded_cents: 4000 }), 0);
  // Campi assenti o illeggibili: zero, non `NaN` — un `NaN` in mezzo a una
  // somma la azzera tutta, e la colonna scriverebbe «NaN €».
  assert.equal(entrato({ status: "paid", total_cents: null }), 0);
  assert.equal(entrato({ status: "paid", total_cents: "abc" }), 0);
});

test("l'incasso della giornata: solo i soldi davvero entrati", () => {
  // 4500 + 3000 + 4000 = 11500. Fuori il pending (niente e' entrato) e
  // l'annullato.
  assert.equal(incassato(GIORNATA), 11500);
  assert.equal(righeIncassate(GIORNATA).length, 3);
  assert.equal(incassato([]), 0);
  assert.equal(incassato(null), 0);
});

test("il carrello medio e' un trattino finche' non si e' venduto niente", () => {
  // ⚠️ «0,00 €» sembra un dato — vuol dire «si e' venduto a prezzo zero» —
  // mentre la verita' e' che la serata non e' cominciata.
  assert.equal(panierMedio([]), null);
  assert.equal(panierMedio([{ status: "pending", total_cents: 3000 }]), null, "un pending non e' una vendita");
  assert.equal(panierMedio(GIORNATA), Math.round(11500 / 3));
});

test("quanto resta da incassare, e da chi", () => {
  const r = restaDaIncassare(GIORNATA);
  // 2500 (link) + 3000 (banco) + 1000 (supplemento dovuto) = 6500
  assert.equal(r.importo, 6500);
  assert.equal(r.righe, 3);
  // ⚠️ Il supplemento sta col banco: e' la differenza che il cliente paga al
  // ritiro, e prima non era in nessun numero di nessuno schermo.
  assert.equal(r.banco, 2);
  assert.equal(r.linkPagamento, 1);
});

test("«au comptoir» solo se li si incassa davvero al banco", () => {
  // Un pending senza metodo aspetta il cliente: dirlo «al banco» manda
  // qualcuno ad aspettare soldi che devono arrivare da Internet.
  const solo = restaDaIncassare([{ status: "pending", total_cents: 2000 }]);
  assert.equal(solo.banco, 0);
  assert.equal(solo.linkPagamento, 1);
  const banco = restaDaIncassare([{ status: "pending", total_cents: 2000, payment_method: "onsite" }]);
  assert.equal(banco.banco, 1);
  assert.equal(banco.linkPagamento, 0);
  // Una giornata senza niente da incassare: la colonna scrive un trattino.
  assert.deepEqual(restaDaIncassare([{ status: "done", total_cents: 1000 }]),
    { importo: 0, righe: 0, banco: 0, linkPagamento: 0 });
});

test("«da fare» e «spenti» sono due elenchi che si chiudono esattamente", () => {
  const a = daServire(GIORNATA), b = fatti(GIORNATA);
  assert.equal(a.length + b.length, GIORNATA.length, "nessuna card puo' sparire da entrambi");
  assert.deepEqual(a.map((o) => o.status), ["paid", "paid", "pending", "pending"]);
  assert.deepEqual(b.map((o) => o.status), ["done", "cancelled"]);
  // ⚠️ Uno stato che non conosciamo resta DA FARE: coi due filtri gemelli
  // scritti a mano non compariva ne' sopra ne' sotto, e un ordine da preparare
  // non si vedeva da nessuna parte.
  const strano = [{ status: "en_preparation", total_cents: 1000 }];
  assert.equal(daServire(strano).length, 1);
  assert.equal(fatti(strano).length, 0);
});

test("uno stato ignoto non diventa «pagato»", () => {
  // La pastiglia della colonna ricadeva su «Payée» per OGNI stato che non
  // fosse `done` o `pending`: un annullato si leggeva «pagato».
  assert.equal(statoOrdine("paid"), "paid");
  assert.equal(statoOrdine("cancelled"), "cancelled");
  assert.equal(statoOrdine("en_preparation"), null);
  assert.equal(statoOrdine(null), null);
});

test("i soldi scritti: una riga, e mai «NaN €»", () => {
  assert.equal(euroDa(1250, "fr-BE").replace(/ | /g, " "), "12,50 €");
  assert.equal(euroDa(null, "fr-BE").replace(/ | /g, " "), "0,00 €");
  assert.equal(euroDa("abc", "fr-BE").replace(/ | /g, " "), "0,00 €");
});

/* ---------- le guardie sul codice delle pagine ---------- */

const HOME = readFileSync(new URL("../src/pages/admin/index.astro", import.meta.url), "utf8");
const PAGINA = readFileSync(new URL("../src/pages/admin/orders.astro", import.meta.url), "utf8");
const STATS = readFileSync(new URL("../src/lib/admin/calcolaStats.ts", import.meta.url), "utf8");
const MAIL = readFileSync(new URL("../src/lib/admin/dailyBrief.ts", import.meta.url), "utf8");

test("guardia · i quattro schermi chiedono l'incasso allo stesso modulo", () => {
  for (const [nome, src] of [["Accueil", HOME], ["Commandes", PAGINA], ["Statistiques", STATS], ["mail", MAIL]]) {
    assert.ok(/ordiniConti/.test(src), `${nome} importa ordiniConti`);
    // La somma di `total_cents` scritta a mano: era la riga sbagliata in tutti
    // e quattro i posti.
    assert.ok(
      !/\+ \(?o\.total_cents/.test(src) && !/\+= o\.total_cents/.test(src),
      `${nome} non somma piu' total_cents a mano`,
    );
  }
});

test("guardia · «euro» sta in un posto solo", () => {
  // Era la stessa funzione in cinque `<script>` di pannello.
  for (const f of ["index", "orders", "clients", "menu", "stats"]) {
    const src = readFileSync(new URL(`../src/pages/admin/${f}.astro`, import.meta.url), "utf8");
    assert.ok(!/function euro\(cents/.test(src), `${f}.astro non ridichiara euro()`);
    assert.ok(/euroDa/.test(src), `${f}.astro usa lib/soldi`);
  }
});

/* ---------- la riga finta della nota del cliente ---------- */

test("la nota del cliente non e' un piatto", () => {
  // ⚠️ Dentro `items` il checkout mette una riga finta per la nota:
  // `id: "note"`, `qty: 0`. Nove posti la saltavano con un filtro scritto a
  // mano; la riga dei piatti della colonna no, e scriveva «0× NOTE CLIENT» in
  // testa all'elenco.
  const items = [
    { id: "note", name: "NOTE CLIENT", qty: 0, notes: "sans oignons" },
    { id: "p1", name: "Margherita", qty: 2 },
    // Una riga a quantita' zero non e' un piatto: stampata diventa
    // «0× Diavola» su un ticket che qualcuno deve preparare.
    { id: "p2", name: "Diavola", qty: 0 },
  ];
  assert.deepEqual(piattiVeri(items).map((i) => i.name), ["Margherita"]);
  assert.equal(notaCliente(items), "sans oignons");
  assert.equal(notaCliente([{ id: "p1", name: "Margherita", qty: 1 }]), null);
  // Una nota vuota e' come non averla: niente fumetto sulla card.
  assert.equal(notaCliente([{ id: "note", qty: 0, notes: "   " }]), null);
  assert.deepEqual(piattiVeri(null), []);
});

test("guardia · la riga della nota si salta in un posto solo", () => {
  for (const [nome, src] of [
    ["Accueil", HOME], ["Commandes", PAGINA], ["Statistiques", STATS],
    ["coda di stampa", readFileSync(new URL("../src/lib/stampaCoda.ts", import.meta.url), "utf8")],
    ["ticket", readFileSync(new URL("../src/lib/stampaRegole.ts", import.meta.url), "utf8")],
  ]) {
    assert.ok(/piattiVeri\(/.test(src), `${nome} usa piattiVeri`);
    assert.ok(!/!== "note" && Number\(i\?\.qty/.test(src), `${nome} non riscrive il filtro`);
  }
});

test("i soldi RESI si contano, non solo si sottraggono", () => {
  // ⚠️ `entrato()` toglie il rimborso e poi lo dimentica: il totale resta
  // giusto, ma quanto sia tornato indietro non lo dice nessuno. Una serata da
  // 1000 € con 300 € resi si leggeva uguale a una da 700 € senza un rimborso,
  // e sono due serate diverse: la prima ha avuto tre clienti scontenti.
  const righe = [
    { status: "paid", total_cents: 6000, refunded_cents: 6000 },   // reso tutto
    { status: "done", total_cents: 4000, refunded_cents: 1000 },   // reso in parte
    { status: "paid", total_cents: 2500 },                          // niente
    { status: "cancelled", total_cents: 9000, refunded_cents: 9000 }, // mai incassato
  ];
  assert.equal(rimborsi(righe), 7000, "i resi del periodo");
  assert.equal(conRimborso(righe).length, 2, "sono DUE ordini, non tre: l'annullato non era un incasso");
  // ⚠️ L'annullato non entra ne' nell'incasso ne' nei resi: sono le STESSE
  // righe (`paid`/`done`), altrimenti si confrontano due insiemi diversi e la
  // percentuale di reso puo' passare il cento.
  assert.equal(incassato(righe), 0 + 3000 + 2500, "l'incasso guarda le stesse righe");
  assert.ok(rimborsi(righe) <= righe.reduce((s, o) => s + (o.status === "cancelled" ? 0 : o.total_cents), 0));
  // Un rimborso piu' grande del totale (riga ritoccata a mano) non inventa
  // soldi resi che non sono mai stati incassati.
  assert.equal(rimborsato({ status: "paid", total_cents: 1000, refunded_cents: 5000 }), 1000);
  assert.equal(rimborsato({ status: "paid", total_cents: 1000, refunded_cents: -5000 }), 0);
  assert.equal(rimborsato({ status: "paid", total_cents: 1000 }), 0);
  assert.equal(rimborsi(null), 0);
});
