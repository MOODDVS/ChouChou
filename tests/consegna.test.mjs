/**
 * LA CONSEGNA — l'interruttore, l'indirizzo, e dove si legge.
 *
 * ⚠️ Il guasto da tenere lontano e' uno solo, e silenzioso: un ordine da
 * consegnare che il motore tratta come un ritiro. Il sacchetto resta sul
 * banco, il cliente aspetta a casa, e nessun errore lo dice a nessuno.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { indirizzoDaRichiesta, indirizzoDaRiga, rigaIndirizzo, linkMappa } from "../src/lib/consegnaRegole.ts";
import { servizioDi, aConsegna, alTavolo, avvisaChePronto, RIPIEGO_ORDINI, acceso } from "../src/lib/ordiniRegole.ts";
import { ticketCucina, doveVa, ordineDaRiga } from "../src/lib/stampaRegole.ts";

const leggi = (f) => readFileSync(f, "utf8");
const nudo = (f) => leggi(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const BUONO = { via: "  Rue de la Loi ", numero: "16", box: "3", cap: "1000", comune: "Bruxelles", note: "3e étage" };

test("spenta di ripiego: nessun sito cambia il giorno del merge", () => {
  assert.equal(RIPIEGO_ORDINI.orders_delivery, "0");
  assert.equal(acceso(undefined, "orders_delivery"), false);
  assert.equal(acceso("1", "orders_delivery"), true);
});

test("il servizio: consegna, tavolo, e tutto il resto e' ritiro", () => {
  assert.equal(servizioDi("delivery"), "delivery");
  assert.equal(servizioDi("table"), "table");
  assert.equal(servizioDi(undefined), "pickup");
  assert.equal(servizioDi("drone"), "pickup");
  assert.equal(aConsegna("delivery"), true);
  assert.equal(alTavolo("delivery"), false, "una consegna non e' in sala");
});

test("l'indirizzo: completo o niente", () => {
  const ind = indirizzoDaRichiesta(BUONO);
  assert.ok(ind);
  assert.equal(ind.via, "Rue de la Loi");
  assert.equal(rigaIndirizzo(ind), "Rue de la Loi 16/3, 1000 Bruxelles");
  assert.equal(rigaIndirizzo({ ...ind, box: "" }), "Rue de la Loi 16, 1000 Bruxelles");
  assert.match(linkMappa(ind), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Rue%20de%20la%20Loi/);
  // ⚠️ Senza numero, senza comune o con un CAP illeggibile: niente indirizzo.
  for (const manca of ["via", "numero", "comune", "cap"]) {
    assert.equal(indirizzoDaRichiesta({ ...BUONO, [manca]: "" }), null, `senza ${manca} non e' un indirizzo`);
  }
  assert.equal(indirizzoDaRichiesta({ ...BUONO, cap: "1" }), null);
  assert.equal(indirizzoDaRichiesta(null), null);
  assert.equal(indirizzoDaRichiesta("Rue de la Loi 16"), null);
  // Le misure: un campo enorme non riempie il ticket.
  assert.ok(indirizzoDaRichiesta({ ...BUONO, numero: "9".repeat(500) }).numero.length <= 12);
  // Dal database: oggetto, stringa JSON, o niente.
  assert.equal(indirizzoDaRiga(JSON.stringify(BUONO)).cap, "1000");
  assert.equal(indirizzoDaRiga("{storto"), null);
  assert.equal(indirizzoDaRiga(null), null);
});

test("niente «c'est prêt, venez la chercher» a chi aspetta a casa", () => {
  const adesso = Date.now();
  const iso = new Date(adesso).toISOString();
  assert.equal(avvisaChePronto(iso, adesso, "pickup"), true);
  assert.equal(avvisaChePronto(iso, adesso, "delivery"), false);
});

test("il ticket dice CONSEGNA in cima e l'indirizzo in fondo", () => {
  const dati = ordineDaRiga(
    { id: "abcd-1234", customer_name: "Julie", customer_phone: "0470", service: "delivery", delivery_address: BUONO, items: [{ name: "Margherita", qty: 1 }] },
    "19:30",
  );
  assert.equal(dati.servizio, "delivery");
  assert.equal(dati.indirizzo, "Rue de la Loi 16/3, 1000 Bruxelles");
  assert.equal(doveVa(dati).breve, "CONSEGNA 19:30");
  const righe = ticketCucina(dati).map((r) => r.testo);
  assert.ok(righe.some((t) => t.includes("CONSEGNA 19:30")));
  const iInd = righe.indexOf("Rue de la Loi 16/3, 1000 Bruxelles");
  assert.ok(iInd > righe.indexOf("0470"), "l'indirizzo sta sotto il telefono");
  assert.ok(righe.includes("3e étage"));
  // Un ritiro resta com'era.
  const ritiro = ordineDaRiga({ id: "x", customer_name: "Marc", items: [] }, "19:30");
  assert.equal(doveVa(ritiro).breve, "RITIRO 19:30");
  assert.equal(ritiro.indirizzo, undefined);
});

test("il checkout ricontrolla interruttore e indirizzo, e non ripiega sul ritiro", () => {
  const co = nudo("src/pages/api/checkout.ts");
  assert.match(co, /indirizzo = indirizzoDaRichiesta\(body\.delivery\);\n\s*if \(!indirizzo\) return err\(400/);
  assert.match(co, /if \(consegna && !modi\.consegna\)/);
  assert.match(co, /service: "delivery", delivery_address: indirizzo/);
});

test("Réglages non accende la consegna senza la #84", () => {
  const st = nudo("src/pages/api/admin/settings.ts");
  assert.match(st, /mappa\.get\("orders_delivery"\) === "1"[\s\S]{0,200}"delivery_address"[\s\S]{0,120}err\.deliveryMigration/);
});

test("il carrello chiede la consegna da solo, non alla pagina del cliente", () => {
  const app = nudo("src/components/OrderApp.tsx");
  assert.match(app, /conSede\("\/api\/order-options"\)/);
  assert.match(app, /service: "delivery", delivery: indirizzo/);
  // ⚠️ Senza indirizzo completo il bottone resta spento.
  assert.match(app, /\(!aConsegna \|\| indirizzoOk\) &&/);
});

test("email, Slack, conferma e lista leggono la consegna", () => {
  const n = nudo("src/lib/notifications.ts");
  assert.match(n, /consegna\?: \{ indirizzo: string; mappa: string; note: string \} \| null;/);
  assert.equal((n.match(/subject: \(num, ora\) => `/g) ?? []).length, 10, "5 lingue cliente + 5 cucina");
  const co = nudo("src/lib/confermaOrdine.ts");
  assert.match(co, /consegnaDellOrdine\(String\(ordine\.id\), ordine\.location_id \?\? null\)/);
  assert.match(nudo("src/pages/api/admin/orders.ts"), /EXTRA_84 = ", delivery_address"/);
  assert.match(nudo("src/pages/api/print/[token].ts"), /service, table_label, delivery_address/);
});
