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
  assert.match(n, /consegna\?: \{ indirizzo: string; mappa: string; note: string; costo_cents\?: number \} \| null;/);
  assert.equal((n.match(/subject: \(num, ora\) => `/g) ?? []).length, 10, "5 lingue cliente + 5 cucina");
  const co = nudo("src/lib/confermaOrdine.ts");
  assert.match(co, /consegnaDellOrdine\(String\(ordine\.id\), ordine\.location_id \?\? null\)/);
  assert.match(nudo("src/pages/api/admin/orders.ts"), /EXTRA_84 = ", delivery_address"/);
  assert.match(nudo("src/pages/api/print/[token].ts"), /service, table_label, delivery_address/);
});

/* ───────── Punto 5: spesa minima e consegna gratuita ───────── */
import { sogliaCents, euroInCents, mancaAlMinimo } from "../src/lib/consegnaRegole.ts";

test("le soglie: euro scritti dal ristoratore, centesimi nel database", () => {
  assert.equal(euroInCents("50"), 5000);
  assert.equal(euroInCents("49,90"), 4990);
  assert.equal(euroInCents("49.9"), 4990);
  assert.equal(euroInCents(""), 0, "vuoto = nessuna soglia");
  // ⚠️ Illeggibile → null, cioe' rifiutato: mai «nessun minimo» per sbaglio.
  assert.equal(euroInCents("cinquante"), null);
  assert.equal(euroInCents("-5"), null);
  assert.equal(euroInCents("50,999"), null);
  assert.equal(euroInCents("100000000"), null);
  // Rilette dal database: storte → nessuna soglia, mai un blocco.
  assert.equal(sogliaCents("5000"), 5000);
  assert.equal(sogliaCents(undefined), 0);
  assert.equal(sogliaCents("abc"), 0);
  assert.equal(sogliaCents("-1"), 0);
});

test("quanto manca al minimo", () => {
  assert.equal(mancaAlMinimo(3800, 5000), 1200);
  assert.equal(mancaAlMinimo(5000, 5000), 0);
  assert.equal(mancaAlMinimo(8000, 5000), 0);
  assert.equal(mancaAlMinimo(800, 0), 0, "nessun minimo");
});

test("il minimo vale sui piatti scontati, nel carrello e nel checkout", () => {
  const co = nudo("src/pages/api/checkout.ts");
  // Dopo il codice promo: si misura su `totaleIncassato`.
  assert.match(co, /const \{ minimo, gratis, costo(, zone)? \} = await soglieConsegna\(ambitoPub\);[\s\S]{0,1400}const manca = mancaAlMinimo\(totaleIncassato, minimo\);/);
  const app = nudo("src/components/OrderApp.tsx");
  assert.match(app, /const mancaMinimo = aConsegna && soglie\.minimo > 0 \? Math\.max\(0, soglie\.minimo - totaleFinale\) : 0;/);
  assert.match(app, /mancaMinimo === 0 &&/);
  // Il PUT rifiuta un importo illeggibile invece di azzerarlo.
  assert.match(nudo("src/pages/api/admin/settings.ts"), /if \(c === null\) return json\(\{ error: await msg\("err\.deliveryAmount"\) \}, 400\);/);
});

/* ───────── Punto 7: il costo della consegna ───────── */
import { costoConsegna } from "../src/lib/consegnaRegole.ts";

test("il costo: quello del ristoratore, gratis sopra la soglia", () => {
  assert.equal(costoConsegna(3000, 350, 0), 350);
  assert.equal(costoConsegna(3000, 350, 10000), 350);
  assert.equal(costoConsegna(10000, 350, 10000), 0, "alla soglia esatta e' gia' gratis");
  assert.equal(costoConsegna(12000, 350, 10000), 0);
  assert.equal(costoConsegna(3000, 0, 10000), 0, "nessun costo, nessuna soglia da guardare");
});

test("il server decide il costo, lo somma al totale e lo salva a parte", () => {
  const co = nudo("src/pages/api/checkout.ts");
  assert.match(co, /costoCons = costoConsegna\(totaleIncassato, (costo|costoBaseZona\(zona, costo\)), gratis\);/);
  assert.match(co, /total_cents: totaleIncassato \+ costoCons( \+ mancia)?,/);
  assert.match(co, /\.\.\.\(costoCons > 0 \? \{ delivery_fee_cents: costoCons \} : \{\}\),/);
  // Una voce sua su Stripe: la ricevuta la mostra separata.
  assert.match(co, /voci\.push\(\{ name: TXT_VOCE\[lang\] \?\? TXT_VOCE\.fr, price_cents: costoCons, qty: 1 \}\);/);
  // Il carrello mostra lo stesso numero con la stessa regola.
  const app = nudo("src/components/OrderApp.tsx");
  assert.match(app, /const costoCons = aConsegna \? costoConsegna\(totaleFinale, (soglie\.costo|costoBase), soglie\.gratis\) : 0;/);
});

test("modificare un ordine non toglie la consegna dal totale", () => {
  const ord = nudo("src/pages/api/admin/orders.ts");
  assert.match(ord, /const totale = itemsOrdine\.reduce\(\(t, i\) => t \+ i\.price_cents \* i\.qty, 0\) \+ fuoriPiatti;/);
});

test("Réglages non mette un costo senza la #85", () => {
  const st = nudo("src/pages/api/admin/settings.ts");
  assert.match(st, /campo === "consegna_costo" && c > 0[\s\S]{0,160}"delivery_fee_cents"[\s\S]{0,120}err\.deliveryMigration/);
});

/* ───────── Punto 2: il tempo della consegna ───────── */
import { ritardoConsegna, preavvisoConsegna, RITARDI_CONSEGNA } from "../src/lib/consegnaRegole.ts";

test("il tragitto: quattro scelte, 45 di ripiego, mai 0", () => {
  assert.deepEqual([...RITARDI_CONSEGNA], [30, 45, 60, 90]);
  assert.equal(ritardoConsegna("60"), 60);
  assert.equal(ritardoConsegna(undefined), 45);
  assert.equal(ritardoConsegna("0"), 45);
  assert.equal(ritardoConsegna("37"), 45);
  assert.equal(preavvisoConsegna(15, 45), 60, "preparazione + tragitto");
  assert.equal(preavvisoConsegna("x", 30), 30);
});

test("sito e checkout usano lo stesso preavviso per la consegna", () => {
  const api = nudo("src/lib/slotsApi.ts");
  assert.match(api, /export async function preavvisoDelServizio\(/);
  assert.match(api, /calcolaSlotGiorno\(\n\s*ora,\n\s*config,\n\s*fuso,\n\s*await preavvisoDelServizio\(consegna, config\.prep_time_minutes, ambito\),/);
  const co = nudo("src/pages/api/checkout.ts");
  assert.match(co, /await preavvisoDelServizio\(consegna, config\.prep_time_minutes, ambitoPub\),/);
  assert.match(nudo("src/pages/api/slots.ts"), /const consegna = url\.searchParams\.get\("service"\) === "delivery";/);
  // Il selettore chiede gli orari del servizio scelto e li richiede cambiandolo.
  const sp = nudo("src/components/SlotPicker.tsx");
  assert.match(sp, /\}, \[sede, servizio\]\);/);
  assert.match(nudo("src/components/OrderApp.tsx"), /servizio=\{aConsegna \? "consegna" : "ritiro"\}/);
});

/* ───────── Punto 4: i fattorini ───────── */
import { maxConsegne, occupaFattorino, contaPerOrario, orariLiberi } from "../src/lib/consegnaRegole.ts";

test("il limite: intero 1–50, altrimenti nessun limite", () => {
  assert.equal(maxConsegne("2"), 2);
  assert.equal(maxConsegne(""), 0);
  assert.equal(maxConsegne("0"), 0);
  assert.equal(maxConsegne("due"), 0);
  assert.equal(maxConsegne("2.5"), 0);
  assert.equal(maxConsegne("80"), 0);
});

test("chi occupa un fattorino", () => {
  const adesso = Date.parse("2026-10-18T18:00:00Z");
  assert.equal(occupaFattorino({ status: "paid" }, adesso), true);
  assert.equal(occupaFattorino({ status: "done" }, adesso), true);
  assert.equal(occupaFattorino({ status: "cancelled" }, adesso), false);
  assert.equal(occupaFattorino({ status: "pending", payment_method: "onsite" }, adesso), true, "da incassare alla porta");
  assert.equal(occupaFattorino({ status: "pending", created_at: "2026-10-18T17:50:00Z" }, adesso), true, "su Stripe da 10 minuti");
  assert.equal(occupaFattorino({ status: "pending", created_at: "2026-10-18T17:00:00Z" }, adesso), false, "carrello abbandonato");
});

test("conteggio per orario e orari liberi", () => {
  const adesso = Date.parse("2026-10-18T18:00:00Z");
  // Bruxelles in ottobre = UTC+2: 17:30Z = 19:30.
  const righe = [
    { pickup_time: "2026-10-18T17:30:00Z", status: "paid" },
    { pickup_time: "2026-10-18T17:30:00Z", status: "pending", payment_method: "onsite" },
    { pickup_time: "2026-10-18T17:45:00Z", status: "paid" },
    { pickup_time: "2026-10-18T17:45:00Z", status: "cancelled" },
  ];
  const conti = contaPerOrario(righe, "Europe/Brussels", adesso);
  assert.equal(conti.get("19:30"), 2);
  assert.equal(conti.get("19:45"), 1);
  assert.deepEqual(orariLiberi(["19:15", "19:30", "19:45"], conti, 2), ["19:15", "19:45"]);
  assert.deepEqual(orariLiberi(["19:30"], conti, 0), ["19:30"], "nessun limite");
});

test("sito e checkout tolgono gli orari pieni con la stessa funzione", () => {
  const api = nudo("src/lib/slotsApi.ts");
  assert.match(api, /export async function soloOrariLiberi\(/);
  assert.match(api, /const lunch = await soloOrariLiberi\(grezzi\.lunch, consegna, ambito, ora\);/);
  const co = nudo("src/pages/api/checkout.ts");
  assert.match(co, /if \(consegna && \(await soloOrariLiberi\(\[body\.slot\], true, ambitoPub, giornoRitiro\)\)\.length === 0\)/);
});

/* ───────── Punto 6: le zone ───────── */
import { capPulito, zoneDaConfig, zoneDaPagina, zonaDelCap, costoBaseZona } from "../src/lib/consegnaRegole.ts";

test("nessuna zona = si consegna ovunque, al costo unico", () => {
  assert.equal(zonaDelCap([], "1180"), "ovunque");
  assert.equal(costoBaseZona("ovunque", 350), 350);
  assert.deepEqual(zoneDaConfig(""), []);
  assert.deepEqual(zoneDaConfig("{storto"), [], "JSON rovinato non ferma le consegne");
});

test("le zone scritte in Réglages", () => {
  const r = zoneDaPagina([
    { nome: "Centre", cap: "1000, 1040;1050", costo: "2,50" },
    { nome: "Sud", cap: "1180 1190", costo: "" },
    { nome: "", cap: "", costo: "" }, // riga vuota appena aggiunta
  ]);
  assert.ok("zone" in r);
  assert.equal(r.zone.length, 2);
  assert.deepEqual(r.zone[0], { nome: "Centre", cap: ["1000", "1040", "1050"], costo_cents: 250 });
  assert.equal(r.zone[1].costo_cents, null, "vuoto = costo unico");
  // Errori detti col pezzo sbagliato.
  assert.deepEqual(zoneDaPagina([{ nome: "A", cap: "1o", costo: "" }]), { errore: "cap", dettaglio: "1o" });
  assert.deepEqual(zoneDaPagina([{ nome: "A", cap: "1000", costo: "" }, { nome: "B", cap: "1000", costo: "" }]), { errore: "doppio", dettaglio: "1000" });
  assert.deepEqual(zoneDaPagina([{ nome: "A", cap: "1000", costo: "due" }]), { errore: "costo", dettaglio: "due" });
  assert.deepEqual(zoneDaPagina([{ nome: "A", cap: "", costo: "3" }]), { errore: "cap", dettaglio: "A" });
});

test("la zona di un codice postale, e il suo costo", () => {
  const zone = zoneDaConfig(JSON.stringify([
    { nome: "Centre", cap: ["1000", "1040"], costo_cents: 250 },
    { nome: "Sud", cap: ["1180"], costo_cents: null },
  ]));
  assert.equal(zonaDelCap(zone, " 1040 ").nome, "Centre");
  assert.equal(zonaDelCap(zone, "1210"), null, "fuori zona");
  assert.equal(zonaDelCap(zone, ""), null);
  assert.equal(costoBaseZona(zonaDelCap(zone, "1000"), 400), 250, "il costo della zona sostituisce quello unico");
  assert.equal(costoBaseZona(zonaDelCap(zone, "1180"), 400), 400, "zona senza costo = costo unico");
  assert.equal(capPulito("w1a 1aa"), "W1A 1AA");
});

test("checkout e carrello rifiutano un codice fuori zona", () => {
  const co = nudo("src/pages/api/checkout.ts");
  assert.match(co, /const zona = zonaDelCap\(zone, indirizzo\?\.cap\);\n\s*if \(!zona\) \{/);
  assert.match(co, /costoCons = costoConsegna\(totaleIncassato, costoBaseZona\(zona, costo\), gratis\);/);
  const app = nudo("src/components/OrderApp.tsx");
  assert.match(app, /!fuoriZona &&/);
  assert.match(app, /const costoCons = aConsegna \? costoConsegna\(totaleFinale, costoBase, soglie\.gratis\) : 0;/);
});

test("con le zone il codice postale si sceglie da un menu, senza resta libero", () => {
  const app = nudo("src/components/OrderApp.tsx");
  assert.match(app, /\{opzioniCap\.length > 0 \? \(\n\s*<select/);
  assert.match(app, /o\.nome \? `\$\{o\.cap\} — \$\{o\.nome\}` : o\.cap/);
  // Il nome della zona arriva al carrello: e' quello che il cliente legge.
  assert.match(nudo("src/pages/api/order-options.ts"), /zone: soglie\.zone\.map\(\(z\) => \(\{ nome: z\.nome, cap: z\.cap, costo_cents: z\.costo_cents \}\)\),/);
});

/* ───────── Punto 9: le altre email di una consegna ───────── */
test("annullo, ritardo e modifica di una consegna parlano di consegna", () => {
  const n = nudo("src/lib/notifications.ts");
  // Cinque lingue, tutte le voci.
  for (const voce of ["annLabel", "ritSubject", "ritTitle", "ritIntro", "ritEtichetta", "modSubject", "modEtichetta", "modDove"]) {
    assert.equal((n.match(new RegExp(`\\n    ${voce}: `, "g")) ?? []).length, 5, `manca ${voce} in qualche lingua`);
  }
  assert.match(n, /const etichettaOra = o\.consegna \? pick5\(TXT_CONSEGNA_ALTRE, o\.lang\)\.annLabel : t\.pickupLabel;/);
  assert.match(n, /const tca = o\.consegna && variante === "ritardo" \? pick5\(TXT_CONSEGNA_ALTRE, o\.lang\) : null;/);
  assert.match(n, /subject: tca \? tca\.modSubject\(o\.numero, ora\) : t\.subject\(o\.numero, ora\),/);
  assert.match(n, /subject: kc \? kc\.subjAnnul\(o\.numero, ora\) : k\.subjAnnul\(o\.numero, ora\),/);
  // Chi manda queste email passa la consegna.
  assert.match(nudo("src/pages/api/admin/order-delay.ts"), /consegna: await consegnaDellOrdine\(/);
  assert.match(nudo("src/pages/api/order-cancel.ts"), /consegna: await consegnaDellOrdine\(/);
  const ord = nudo("src/pages/api/admin/orders.ts");
  assert.equal((ord.match(/consegna: await consegnaDellOrdine\(/g) ?? []).length, 2, "annullo e modifica");
  assert.match(ord, /mancia_cents: await manciaDellOrdine\(/);
});
