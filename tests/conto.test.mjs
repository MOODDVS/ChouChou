/**
 * IL CONTO APERTO AL TAVOLO — fase 1: migrazione, regole, Réglages
 * (`src/lib/contoRegole.ts`, `supabase/087_conto_aperto.sql`; disegno nel
 * progetto: conto-aperto.md).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  contoAperto, nuovoCodice, codiceLetto, codiceBloccato, dopoTentativo, MAX_TENTATIVI_CODICE, BLOCCO_CODICE_MINUTI,
  personeConto, hannoOrdinato, finestraInvio, partenzaInvio, restoDaPagare, parteUguale,
  tavoliUnitiDa, invioDaUsare, ordineTogliibile, inizialeDi,
} from "../src/lib/contoRegole.ts";
import { TESTI_CONTO } from "../src/lib/contoTesti.ts";
import { acceso, RIPIEGO_ORDINI } from "../src/lib/ordiniRegole.ts";

const leggi = (f) => readFileSync(f, "utf8");
const nudo = (f) => leggi(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (f) => leggi(f).split("\n").filter((r) => !r.trim().startsWith("--")).join("\n");

test("il conto occupa il tavolo solo da aperto o da validare", () => {
  assert.equal(contoAperto("pending"), true);
  assert.equal(contoAperto("open"), true);
  assert.equal(contoAperto("closed"), false);
  assert.equal(contoAperto(null), false);
});

test("il codice: sempre due cifre, e si legge come lo scrive la gente", () => {
  assert.equal(nuovoCodice(() => 0), "00");
  assert.equal(nuovoCodice(() => 0.07), "07");
  assert.equal(nuovoCodice(() => 0.999999), "99");
  for (let i = 0; i < 200; i++) assert.match(nuovoCodice(), /^[0-9]{2}$/);
  assert.equal(codiceLetto("7"), "07");
  assert.equal(codiceLetto(" 0 7 "), "07");
  assert.equal(codiceLetto("42"), "42");
  assert.equal(codiceLetto("123"), null);
  assert.equal(codiceLetto("ab"), null);
  assert.equal(codiceLetto(""), null);
});

test("i tentativi: dopo 5 sbagliati ci si blocca, e il blocco finisce da solo", () => {
  const t0 = new Date("2026-10-18T20:00:00Z");
  const dopo = (min) => new Date(t0.getTime() + min * 60_000);
  let s = { sbagliati: 0, ultimoSbaglio: null };
  for (let i = 0; i < MAX_TENTATIVI_CODICE; i++) s = dopoTentativo(false, s.sbagliati, s.ultimoSbaglio, t0);
  assert.equal(s.sbagliati, MAX_TENTATIVI_CODICE);
  assert.equal(codiceBloccato(s.sbagliati, s.ultimoSbaglio, dopo(1)), true);
  assert.equal(codiceBloccato(s.sbagliati, s.ultimoSbaglio, dopo(BLOCCO_CODICE_MINUTI)), false);
  // Giusto → si riparte da zero.
  assert.deepEqual(dopoTentativo(true, 4, t0, dopo(1)), { sbagliati: 0, ultimoSbaglio: null });
  // Cinque errori in una serata intera non sono un attacco.
  assert.equal(dopoTentativo(false, 4, t0, dopo(BLOCCO_CODICE_MINUTI + 1)).sbagliati, 1);
  assert.equal(codiceBloccato(4, t0, dopo(1)), false);
});

test("le persone: il piu' alto fra le dichiarate e chi ha ordinato", () => {
  assert.equal(personeConto(4, 3), 4, "chi non ordina non abbassa il numero");
  assert.equal(personeConto(4, 5), 5, "arriva un quinto: il conto sa che sono 5");
  assert.equal(personeConto("boh", 0), 1);
  assert.deepEqual(hannoOrdinato(["Marco", " marco ", "Sara", ""], 4), { ordinato: 2, su: 4 });
});

test("la finestra: Non / 1 / 2 / 5 min, ripiego 1; parte dal PRIMO ordine", () => {
  assert.equal(finestraInvio("0"), 0);
  assert.equal(finestraInvio("2"), 2);
  assert.equal(finestraInvio("5"), 5);
  assert.equal(finestraInvio(""), 1);
  assert.equal(finestraInvio("3"), 1);
  const t = new Date("2026-10-18T20:00:00Z");
  assert.equal(partenzaInvio(t, 2).toISOString(), "2026-10-18T20:02:00.000Z");
  assert.equal(partenzaInvio(t, 0).toISOString(), t.toISOString());
});

test("il resto e la parte uguale: i centesimi non restano mai scoperti", () => {
  assert.equal(restoDaPagare([4500, 3200], [2000]), 5700);
  assert.equal(restoDaPagare([1000], [1500]), 0);
  // 100,00 € in 3: 33,33 + 33,34 + l'ultimo paga tutto il resto.
  let resto = 10000;
  const a = parteUguale(resto, 3); resto -= a;
  const b = parteUguale(resto, 2); resto -= b;
  const c = parteUguale(resto, 1); resto -= c;
  assert.equal(a + b + c, 10000);
  assert.equal(resto, 0);
  assert.equal(parteUguale(500, 0), 500);
});

test("la migrazione #87: conto sulla sessione, un solo conto per tavolo, invii, 'tab'", () => {
  const m = sql("supabase/087_conto_aperto.sql");
  for (const c of ["tab_status", "tab_code", "tab_table_id", "tab_people", "tab_validated_at", "tab_closed_at", "tab_fails", "tab_fails_at"]) {
    assert.match(m, new RegExp(`add column if not exists ${c} `), c);
  }
  // ⚠️ Decide il database chi vince quando due aprono nello stesso secondo.
  assert.match(m, /create unique index if not exists reservations_un_conto_per_tavolo\s+on public\.reservations \(tab_table_id\) where tab_status in \('pending', 'open'\);/);
  assert.match(m, /create table if not exists public\.table_rounds/);
  assert.match(m, /grant select, insert, update, delete on public\.table_rounds to service_role;/);
  assert.match(m, /add column if not exists round_id uuid references public\.table_rounds\(id\) on delete set null;/);
  assert.match(m, /check \(payment_method in \('cash', 'card', 'link', 'onsite', 'tab'\)\);/);
  assert.match(leggi("supabase/MIGRATIONS.md"), /\| 87 \| `087_conto_aperto\.sql` \|/);
  assert.match(leggi("src/lib/admin/sedeRegole.ts"), /table_rounds: "sede",/);
});

test("Réglages: spento di ripiego, solo col tavolo scelto, e non si accende senza la #87", () => {
  assert.equal(RIPIEGO_ORDINI.orders_table_tab, "0");
  assert.equal(acceso(undefined, "orders_table_tab"), false);
  assert.match(nudo("src/lib/ordiniOpzioni.ts"), /conto: opz\.tavolo && conTavoli && opz\.conto,/);
  const api = nudo("src/pages/api/admin/settings.ts");
  assert.match(api, /if \(mappa\.get\("orders_table_tab"\) === "1"\) \{\s*const \{ error: senzaColonna \} = await leggi\("reservations", ambitoPut, "tab_status"\)\.limit\(1\);\s*if \(senzaColonna\) return json\(\{ error: await msg\("err\.tabMigration"\) \}, 409\);/);
  assert.match(api, /conto_finestra: finestraInvio\(cfg\.get\("orders_table_batch"\)\),/);
  const reg = leggi("src/lib/admin/sedeRegole.ts");
  assert.match(reg, /orders_table_tab: "sede",/);
  assert.match(reg, /orders_table_batch: "sede",/);
  const pag = nudo("src/pages/admin/settings.astro");
  assert.match(pag, /const puo = Boolean\(swTavolo\?\.checked && dati\.sala_con_tavoli && \(swSceltaConto\?\.checked \?\? true\)\);/);
  assert.match(pag, /orders_table_tab: \(document\.getElementById\("o-table-tab"\) as HTMLInputElement \| null\)\?\.checked \?\? false,/);
});


/* ───────── Fase 2: il cliente ───────── */

test("i tavoli uniti: il 02 unito al 01 raggiunge il suo conto; mappa rotta → solo se stesso", () => {
  const mappa = JSON.stringify({ Salle: [["t01", "t02"], ["t05", "t06"]], Terrasse: [["t10", "t11"]] });
  assert.deepEqual(tavoliUnitiDa(mappa, "t02").sort(), ["t01", "t02"]);
  assert.deepEqual(tavoliUnitiDa(mappa, "t07"), ["t07"]);
  assert.deepEqual(tavoliUnitiDa("{rotto", "t01"), ["t01"]);
  assert.deepEqual(tavoliUnitiDa({ Salle: [["t01", "t02"]] }, "t01").sort(), ["t01", "t02"]);
});

test("l'invio: da validare tutti nel PRIMO; aperto, l'ultimo finche' la finestra e' aperta", () => {
  const t = new Date("2026-10-18T20:00:00Z");
  const piu = (min) => new Date(t.getTime() + min * 60_000).toISOString();
  // Conto da validare: il primo invio, che aspetta il cameriere.
  assert.deepEqual(invioDaUsare("pending", [], t, 1), { nuovo: 1, partenza: null });
  assert.deepEqual(invioDaUsare("pending", [{ id: "r1", number: 1, status: "waiting", release_at: null }], t, 1), { usa: "r1" });
  // Conto aperto: dentro la finestra si raggiunge l'invio; scaduta, se ne fa uno nuovo.
  const aperto = [{ id: "r1", number: 1, status: "released", release_at: piu(-30) }, { id: "r2", number: 2, status: "waiting", release_at: piu(1) }];
  assert.deepEqual(invioDaUsare("open", aperto, t, 2), { usa: "r2" });
  const scaduto = [{ id: "r2", number: 2, status: "waiting", release_at: piu(-1) }];
  const nuovo = invioDaUsare("open", scaduto, t, 2);
  assert.equal(nuovo.nuovo, 3);
  assert.equal(nuovo.partenza.toISOString(), piu(2));
});

test("togliere un piatto: solo finche' il suo invio non e' partito", () => {
  const t = new Date("2026-10-18T20:00:00Z");
  assert.equal(ordineTogliibile({ status: "waiting", release_at: null }, "pending", t), true);
  assert.equal(ordineTogliibile({ status: "waiting", release_at: new Date(t.getTime() + 60_000).toISOString() }, "open", t), true);
  assert.equal(ordineTogliibile({ status: "waiting", release_at: new Date(t.getTime() - 1000).toISOString() }, "open", t), false);
  assert.equal(ordineTogliibile({ status: "released", release_at: null }, "open", t), false);
  assert.equal(ordineTogliibile(null, "pending", t), false);
});

test("a chi non e' del gruppo, solo l'iniziale: la pagina del QR la vede chiunque", () => {
  assert.equal(inizialeDi("marco"), "M");
  assert.equal(inizialeDi(""), "");
});

test("le parole del conto esistono in tutte e cinque le lingue, con i loro segnaposto", () => {
  const chiavi = Object.keys(TESTI_CONTO.fr);
  for (const l of ["fr", "en", "it", "nl", "es"]) {
    assert.deepEqual(Object.keys(TESTI_CONTO[l]).sort(), [...chiavi].sort(), l);
    assert.match(TESTI_CONTO[l].giaAperto, /\{i\}/, l);
    assert.match(TESTI_CONTO[l].ordinato, /\{n\}.*\{p\}/, l);
    assert.match(TESTI_CONTO[l].invioN, /\{k\}/, l);
  }
});

test("checkout sul conto: codice ricontrollato, 'tab' e il suo invio, niente Stripe/ticket/annuncio", () => {
  const co = nudo("src/pages/api/checkout.ts");
  assert.match(co, /const sulConto = aTavolo && body\.pay === "tab";/);
  assert.match(co, /if \(sulConto && !sala\?\.conto\) \{/);
  assert.match(co, /const esitoCodice = await verificaCodice\(ambitoPub, conto, body\.code, ora\.toJSDate\(\)\);\s*if \(esitoCodice !== "ok"\) return err\(403, "code"\);/);
  assert.match(co, /\.\.\.\(sulConto \? \{ payment_method: "tab", round_id: invioId \} : \{\}\),/);
  assert.match(co, /const inCassa = !sulConto && /);
  // Il ramo del conto torna PRIMA della cassa e di Stripe: nessun ticket, nessun annuncio.
  const i = co.indexOf("if (sulConto) {\n    if (contoInAttesa");
  const j = co.indexOf("if (inCassa) {", i);
  assert.ok(i > 0 && j > i);
  assert.doesNotMatch(co.slice(i, j), /accodaTicket|annunciaOrdine|creaCheckoutSession/);
});

test("/api/table-tab: il conto solo con l'interruttore; il codice si conta solo sul proprio conto", () => {
  const tt = nudo("src/pages/api/table-tab.ts");
  assert.match(tt, /if \(!opz\.conto\) return json\(/);
  assert.match(tt, /const perQuesto = String\(body\.reservation_id \?\? ""\) === conto\.id;/);
  assert.match(tt, /if \("gia" in r\) return json\(\{ error: "deja ouvert", iniziale: inizialeDi\(r\.gia\.first_name\) \}, 409\);/);
  assert.match(tt, /if \(esito === "bloccato"\) return json\(\{ error: "bloque" \}, 429\);/);
  const cs = nudo("src/lib/contoServer.ts");
  // Due che aprono nello stesso secondo: vince l'indice unico, l'altro si unisce.
  assert.match(cs, /if \(eDoppione\(ins\.error\)\) \{\s*const vinto = await contoDelTavolo/);
  assert.match(cs, /\.in\("tab_table_id", ids\)/);
});

test("«Demander l'addition» passa dalla campanella, col suo motivo e il suo doppione", () => {
  const ch = nudo("src/pages/api/table-call.ts");
  assert.match(ch, /const addizione = body\.reason === "bill" && opz\.conto;/);
  assert.match(ch, /\.\.\.\(addizione \? \{ reason: "bill" \} : \{\}\),/);
  assert.match(ch, /\.eq\("reason", "bill"\)/);
  assert.match(sql("supabase/087_conto_aperto.sql"), /add column if not exists reason text not null default 'call';/);
});

test("la pagina: «Ouvrir un compte» accanto al pagamento, «Ajouter» al suo posto nel conto", () => {
  const app = nudo("src/components/OrderApp.tsx");
  assert.match(app, /const soloConto = contoTav\?\.modo === "aggiungi";/);
  assert.match(app, /\{!soloConto && \(\s*<button type="button" className="order-cart-checkout"/);
  assert.match(app, /pay: "tab",\s*code: c\.code,/);
  const to = nudo("src/components/TableOrder.tsx");
  assert.match(to, /const contoAttivo = conto && conTavoli && tc !== null;/);
  // Qualcuno ha aperto un secondo prima: il carrello resta, compare «Rejoindre».
  assert.match(to, /if \(status === 409 && e\.includes\("deja"\)\) \{\s*setStatoConto\(\{ tipo: "altri"/);
  // Il QR «Inviter» porta il codice nell'indirizzo, e si toglie appena letto.
  // Il codice (e i ritorni da Stripe) si tolgono dall'indirizzo appena letti.
  assert.match(to, /for \(const k of \["code", "addition", PARAM_PAGATO, PARAM_LASCIATO, "session_id"\]\) u\.searchParams\.delete\(k\);/);
  assert.match(leggi("src/components/PaginaTavolo.astro"), /conto=\{sala\.conto\}/);
});

/* ───────── Fase 3: il ristorante ───────── */
import { sommaPiatti, piattoBreve, tavoliInsieme, ticketAddizione, ticketCucina } from "../src/lib/stampaRegole.ts";

test("il ticket di un invio: piatti sommati, chi ha preso cosa, «TAVOLO 7 · INVIO 2»", () => {
  const somma = sommaPiatti([
    { qty: 1, nome: "Tiramisù", variante: null, nota: null },
    { qty: 2, nome: "Tiramisù", variante: null, nota: null },
    { qty: 1, nome: "Tiramisù", variante: null, nota: "sans cacao" },
  ]);
  assert.deepEqual(somma.map((p) => [p.qty, p.nota]), [[3, null], [1, "sans cacao"]], "«senza» non si fonde con quello normale");
  assert.equal(piattoBreve({ qty: 2, nome: "Margherita", variante: "33 cm" }), "2x Margherita (33 cm)");
  assert.equal(tavoliInsieme(["01", "02", "01", ""]), "01+02");
  const righe = ticketCucina({
    numero: "AB12", ora: "20:00", cliente: "", servizio: "table", tavolo: "7", invio: 2,
    piatti: [{ qty: 3, nome: "Tiramisù" }], perPersona: [{ nome: "Marco", piatti: ["2x Tiramisù"] }, { nome: "Sara", piatti: ["1x Tiramisù"] }],
  });
  const testi = righe.map((r) => r.testo);
  assert.ok(testi.includes("TAVOLO 7 · INVIO 2"));
  assert.ok(testi.includes("MARCO: 2x Tiramisù"));
  // Un invio non ha UN cliente: nessuna riga col nome in fondo.
  assert.ok(!righe.some((r) => r.taglia === "largo" && r.grassetto && r.testo === ""));
});

test("l'addizione stampata: per persona coi prezzi, il totale, nella lingua del locale", () => {
  const righe = ticketAddizione({
    insegna: "Chez Test", tavolo: "01+02", quando: "18/10 21:30", lang: "fr", totale: 3150,
    persone: [{ nome: "Marco", righe: [{ testo: "2x Tiramisù", cents: 1400 }], totale: 1400 }, { nome: "Sara", righe: [{ testo: "1x Pasta", cents: 1750 }], totale: 1750 }],
  }).map((r) => r.testo);
  assert.ok(righe.includes("ADDITION · Table 01+02"));
  assert.ok(righe.includes("TOTAL  31,50 EUR"));
  assert.ok(righe.some((r) => r.startsWith("  2x Tiramisù") && r.endsWith("14,00 EUR") && r.length === 48));
});

test("gli invii partono una volta sola, e solo dopo la validazione o la finestra", () => {
  const cs = nudo("src/lib/contoServer.ts");
  // Il passaggio a `released` e' condizionato: due chiamate insieme, un ticket.
  assert.match(cs, /aggiorna\("table_rounds", ambito, \{ status: "released", released_at: adesso \}\)\s*\.eq\("id", r\.id\)\s*\.eq\("status", "waiting"\)/);
  assert.match(cs, /\.lte\("release_at", adesso\)/);
  assert.match(cs, /void accodaTicket\(\{ id: ordini\[0\]\.id, location_id: r\.location_id \}, \{ invio: r\.id \}\);/);
  // Solo l'invio salta `daStampare`: l'autorizzazione e' la validazione.
  assert.match(nudo("src/lib/stampaCoda.ts"), /if \(!opz\.invio && !daStampare\(o\.status, o\.payment_method\)\)/);
  // Il primo invio aspetta la validazione: `release_at` NULL non passa mai `lte`.
  const api = nudo("src/pages/api/admin/table-tabs.ts");
  assert.match(api, /await aggiorna\("table_rounds", ambito, \{ release_at: adessoIso \}\)\s*\.eq\("reservation_id", conto\.id\)\s*\.eq\("status", "waiting"\)\s*\.is\("release_at", null\);/);
  assert.match(nudo("src/pages/api/checkout.ts"), /await rilasciaInviiScaduti\(ambitoPub, conto\.id\);\s*invioId = await invioPerOrdine/);
});

test("il tablet: valida, rifiuta, incassa (contanti/carta), chiudi, stampa — e il tavolo si libera", () => {
  const api = nudo("src/pages/api/admin/table-tabs.ts");
  for (const a of ["valida", "rifiuta", "incassa", "chiudi", "stampa"]) assert.match(api, new RegExp(`if \\(azione === "${a}"\\)`), a);
  assert.match(api, /if \(metodo !== "cash" && metodo !== "card"\)/);
  // La chiusura e' UNA, per il cameriere e per il conto saldato online.
  assert.match(nudo("src/lib/contoServer.ts"), /tab_status: "closed",\s*tab_closed_at: adessoIso,\s*status: "done",/);
  assert.match(api, /await chiudiSessioneConto\(ambito, conto, adesso\)/);
  assert.match(api, /\{ status: "done", payment_method: metodo \}/);
  // Non si incassa un conto da validare.
  assert.match(api, /if \(conto\.tab_status === "pending"\) return json\(\{ error: await msg\("err\.tabValidateFirst"\) \}, 409\);/);
  const pag = nudo("src/pages/admin/orders.astro");
  assert.match(pag, /<div class="grid grid-conti" id="grid-conti" hidden><\/div>/);
  assert.match(pag, /return min >= 15 \? 3 : min >= 10 \? 2 : min >= 5 \? 1 : 0;/);
  assert.match(pag, /fetch\("\/api\/admin\/table-tabs", \{ headers \}\)/);
});

test("la stampa: l'addizione e' `customer`, l'invio unisce gli ordini; la richiesta d'addizione sul tablet", () => {
  const pr = nudo("src/pages/api/print/[token].ts");
  assert.match(pr, /if \(String\(\(riga as \{ kind\?: string \}\)\.kind \?\? ""\) === "customer"\) \{/);
  assert.match(pr, /if \(conto\.round_id\) \{/);
  assert.match(pr, /datiInvio\.piatti = sommaPiatti\(gruppi\[i\]\.piatti\);/);
  assert.match(nudo("src/lib/stampaCoda.ts"), /kind: "customer",\s*origin: "manual",/);
  const nav = leggi("src/components/admin/AdminNav.astro");
  assert.match(nav, /chiamate\[0\]\.reason === "bill" \? T\.addizione : T\.chiamata/);
  // Senza la #87 la campanella continua a suonare.
  assert.match(nudo("src/pages/api/admin/table-calls.ts"), /if \(error\) \(\{ data, error \} = await sel\("id, table_id, table_label, caller_name, created_at"\)\);/);
});


test("col conto: niente «sur place» da scegliere; da soli il conto si chiama «Payer sur place»", () => {
  const to = nudo("src/components/TableOrder.tsx");
  assert.match(to, /\? Number\(persone\) === 1\s*\? \{ modo: "apri" as const, etichetta: tc\.apriSolo, sotto: tc\.apriSoloSotto,/);
  for (const l of ["fr", "en", "it", "nl", "es"]) assert.ok(TESTI_CONTO[l].apriSolo && TESTI_CONTO[l].apriSoloSotto, l);
  assert.equal(TESTI_CONTO.fr.apriSolo, "Payer sur place");
});

/* ═════════ FASE 4: pagare l'addizione online (#88) ═════════ */
import {
  sceltaPagamento, pagamentoVivo, quadroPagamenti, ordiniCoperti, importiScelte, contoSaldato,
  PRENOTAZIONE_PAGAMENTO_MINUTI, PARAM_PAGATO, PARAM_LASCIATO,
} from "../src/lib/contoRegole.ts";

const ADESSO = new Date("2026-10-18T20:00:00Z");
const tra = (min) => new Date(ADESSO.getTime() + min * 60000).toISOString();

test("le tre scelte: solo quelle, e nient'altro passa", () => {
  assert.equal(sceltaPagamento("mine"), "mine");
  assert.equal(sceltaPagamento("share"), "share");
  assert.equal(sceltaPagamento("rest"), "rest");
  assert.equal(sceltaPagamento("staff"), null, "il personale non si sceglie dal telefono");
  assert.equal(sceltaPagamento(undefined), null);
  // Stripe vuole almeno 30 minuti di sessione.
  assert.ok(PRENOTAZIONE_PAGAMENTO_MINUTI > 30);
  assert.notEqual(PARAM_PAGATO, PARAM_LASCIATO);
});

test("un pagamento conta se pagato, o in corso e non scaduto", () => {
  assert.equal(pagamentoVivo({ kind: "share", status: "paid", amount_cents: 1, hold_until: null, order_ids: [] }, ADESSO), true);
  assert.equal(pagamentoVivo({ kind: "share", status: "pending", amount_cents: 1, hold_until: tra(5), order_ids: [] }, ADESSO), true);
  // ⚠️ Scaduto = la sessione Stripe non si paga piu': l'importo torna libero.
  assert.equal(pagamentoVivo({ kind: "share", status: "pending", amount_cents: 1, hold_until: tra(-1), order_ids: [] }, ADESSO), false);
  assert.equal(pagamentoVivo({ kind: "share", status: "cancelled", amount_cents: 1, hold_until: tra(5), order_ids: [] }, ADESSO), false);
});

test("il quadro: pagato, in corso, resto, libero", () => {
  const q = quadroPagamenti(10000, [
    { kind: "share", status: "paid", amount_cents: 2500, hold_until: null, order_ids: [] },
    { kind: "share", status: "pending", amount_cents: 2500, hold_until: tra(10), order_ids: [] },
    { kind: "rest", status: "pending", amount_cents: 5000, hold_until: tra(-1), order_ids: [] },
  ], ADESSO);
  assert.deepEqual(q, { totale: 10000, pagato: 2500, inCorso: 2500, resto: 7500, libero: 5000 });
  assert.equal(contoSaldato(q), false);
  assert.equal(contoSaldato(quadroPagamenti(5000, [{ kind: "rest", status: "paid", amount_cents: 5000, hold_until: null, order_ids: [] }], ADESSO)), true);
  // Un conto vuoto non «si salda»: non si chiude da solo un tavolo senza niente.
  assert.equal(contoSaldato(quadroPagamenti(0, [], ADESSO)), false);
});

test("le cifre delle scelte: mai oltre il libero, l'ultima parte e' tutto il resto", () => {
  // 4 persone, 100 €: la prima parte e' 25.
  assert.deepEqual(importiScelte({ libero: 10000, mieiNonCoperti: 3200, persone: 4, pagamentiFatti: 0 }), { mine: 3200, share: 2500, rest: 10000 });
  // Due hanno gia' pagato, ne restano 2: 50 € / 2.
  assert.equal(importiScelte({ libero: 5000, mieiNonCoperti: 0, persone: 4, pagamentiFatti: 2 }).share, 2500);
  // L'ultimo paga i centesimi d'arrotondamento.
  assert.equal(importiScelte({ libero: 3334, mieiNonCoperti: 0, persone: 3, pagamentiFatti: 2 }).share, 3334);
  // Piu' pagamenti che persone: una parte = tutto il resto, mai zero.
  assert.equal(importiScelte({ libero: 1000, mieiNonCoperti: 0, persone: 2, pagamentiFatti: 5 }).share, 1000);
  // «Ce que j'ai commandé» non supera quello che si puo' ancora prendere.
  assert.equal(importiScelte({ libero: 1000, mieiNonCoperti: 3200, persone: 4, pagamentiFatti: 0 }).mine, 1000);
  // Tutto in pagamento da altri: niente da prendere.
  assert.deepEqual(importiScelte({ libero: 0, mieiNonCoperti: 3200, persone: 4, pagamentiFatti: 1 }), { mine: 0, share: 0, rest: 0 });
});

test("«ce que j'ai commandé» non si paga due volte", () => {
  const c = ordiniCoperti([
    { kind: "mine", status: "paid", amount_cents: 1, hold_until: null, order_ids: ["a"] },
    { kind: "mine", status: "pending", amount_cents: 1, hold_until: tra(3), order_ids: ["b"] },
    { kind: "mine", status: "pending", amount_cents: 1, hold_until: tra(-3), order_ids: ["c"] },
    { kind: "share", status: "paid", amount_cents: 1, hold_until: null, order_ids: ["d"] },
  ], ADESSO);
  assert.deepEqual([...c].sort(), ["a", "b"]);
});

test("la #88: tabella, GRANT, il lucchetto e la ricevuta una volta sola", () => {
  const m = leggi("supabase/088_conto_pagamenti.sql");
  assert.match(m, /create table if not exists public\.table_payments/);
  assert.match(m, /grant select, insert, update, delete on public\.table_payments to service_role;/);
  assert.match(m, /add column if not exists tab_pay_lock\s+integer not null default 0/);
  assert.match(m, /add column if not exists tab_receipt_at timestamptz/);
  assert.match(leggi("supabase/MIGRATIONS.md"), /\| 88 \| `088_conto_pagamenti\.sql` \|/);
  assert.match(leggi("src/lib/admin/sedeRegole.ts"), /table_payments: "sede",/);
});

test("due che pagano insieme: riga scritta, POI il lucchetto avanza solo se e' fermo", () => {
  const cs = nudo("src/lib/contoServer.ts");
  assert.match(cs, /const cas = await aggiorna\("reservations", ambito, \{ tab_pay_lock: v \+ 1 \}\)\s*\.eq\("id", conto\.id\)\s*\.eq\("tab_pay_lock", v\)/);
  // L'ordine conta: lucchetto letto → pagamenti → riga → lucchetto.
  const i = cs.indexOf('leggi("reservations", ambito, "tab_pay_lock")');
  const j = cs.indexOf("await statoPagamenti(ambito, conto, dati.miei, dati.adesso)");
  const k = cs.indexOf('inserisci("table_payments"');
  const l = cs.indexOf("const cas = ");
  assert.ok(i > 0 && i < j && j < k && k < l, "ordine del lucchetto");
  // Chi perde lascia la sua riga.
  assert.match(cs, /await aggiorna\("table_payments", ambito, \{ status: "cancelled" \}\)\.eq\("id", riga\.id\);/);
});

test("segnato pagato una volta sola, con la SUA sessione; saldato = chiuso da solo", () => {
  const cs = nudo("src/lib/contoServer.ts");
  assert.match(cs, /if \(!dati\.sessionId \|\| p\.stripe_session_id !== dati\.sessionId\) return false;/);
  assert.match(cs, /\.in\("status", \["pending", "cancelled"\]\)/);
  assert.match(cs, /if \(!contoSaldato\(q\)\) return false;/);
  assert.match(cs, /\.eq\("tab_status", "open"\)\s*\.select\("id"\);/);
  assert.match(cs, /\{ status: "done", payment_method: null \}/);
  assert.match(nudo("src/lib/ricevutaConto.ts"), /\.is\("tab_receipt_at", null\)/);
  const wh = nudo("src/pages/api/stripe-webhook.ts");
  assert.match(wh, /const pagamentoConto = session\.metadata\?\.tab_payment_id;/);
  assert.match(wh, /await segnaPagato\(ambito, pagamentoConto, \{/);
});

test("la rotta: si paga solo un conto validato, col pagamento online, la mancia della sala", () => {
  const api = nudo("src/pages/api/table-tab.ts");
  assert.match(api, /if \(conto\.tab_status !== "open"\) return json\(\{ error: "a valider" \}, 409\);/);
  assert.match(api, /if \(!\(await modiDiPagamento\(ambito\)\)\.online\)/);
  assert.match(api, /const m = await manceDi\(ambito, \{ sala: true \}\);/);
  assert.match(api, /if \(r\.errore === "in_corso"\) return json\(\{ error: "en cours" \}, 409\);/);
  // Il ritorno passa dal token del pagamento, non dal conto (puo' essere chiuso).
  assert.match(api, /if \(azione === "pagato" \|\| azione === "annulla"\) \{/);
  assert.match(api, /sid === p\.stripe_session_id/);
});

test("il tablet: «Encaisser» prende solo il resto; con una parte pagata online gli ordini non si annullano", () => {
  const api = nudo("src/pages/api/admin/table-tabs.ts");
  assert.match(api, /kind: "staff", method: metodo, status: "paid", amount_cents: resto/);
  assert.match(api, /pagato > 0 \? \{ status: "done", payment_method: null \} : \{ status: "cancelled" \}/);
  assert.match(api, /resto_cents: q\.resto,/);
  const pag = nudo("src/pages/admin/orders.astro");
  assert.match(pag, /function pagatiConto\(c: ContoSala\): string \{/);
});

test("la pagina: «Payer l'addition» con le cifre del server, e il ritorno da Stripe", () => {
  const to = nudo("src/components/TableOrder.tsx");
  assert.match(to, /const puoPagare = Boolean\(pag && pag\.online && !inAttesa && pag\.scelte\.rest > 0\);/);
  assert.match(to, /azione: "paga", table: scelto\.id, code: membro\.code, scelta: sceltaPaga,/);
  assert.match(to, /chiediTab\(\{ azione: "pagato", pagamento: pagato, session_id: sessione \}\)/);
  assert.match(to, /chiediTab\(\{ azione: "annulla", pagamento: lasciato \}\)/);
  // Tornato pagato e conto chiuso: «réglée», non «fermée par le serveur».
  assert.match(to, /mostraAvviso\(tornatoPagato\.current \? tc\.saldato : tc\.chiuso, true\)/);
});

test("Commandes: «Aucune commande en cours» non si dice con un conto aperto", () => {
  const pag = nudo("src/pages/admin/orders.astro");
  assert.match(pag, /function mostraVuoto\(\) \{/);
  assert.match(pag, /const conConti = !!g && !g\.hidden && g\.childElementCount > 0;/);
  assert.match(pag, /gridConti\.innerHTML = visibili\.map\(contoHTML\)\.join\(""\);\s*mostraVuoto\(\);/);
});

test("nel conto il tavolo non si cambia; la × del modale resta sempre visibile", () => {
  const to = nudo("src/components/TableOrder.tsx");
  assert.match(to, /if \(modo === "ordine" && tavoloBloccato\.current\) \{/);
  assert.match(to, /tavoloBloccato\.current = nelConto && scelto !== null;/);
  assert.match(to, /\{!nelConto && \(\s*<span className="tbl-tav-ico"/);
  const pag = leggi("src/components/PaginaTavolo.astro");
  assert.match(pag, /\.tbl-modale-testa \{[^}]*position: sticky; top: 0;/);
});

test("«Payer»: un bottone, poi online o il cameriere; in fondo al posto del carrello vuoto", () => {
  const to = nudo("src/components/TableOrder.tsx");
  // Niente «Addition» in alto: toccare il tavolo apre l'addizione.
  assert.doesNotMatch(to, /className="tbl-conto-btn"/);
  assert.match(to, /if \(modo === "ordine" && tavoloBloccato\.current\) \{\s*setPagaAperto\(false\);\s*setAdditionAperta\(true\);/);
  // La modale ha UN bottone «Payer», che porta alle due strade.
  assert.match(to, /onClick=\{apriPaga\}>\s*\{tc\.pagaTit\}/);
  assert.match(to, /\{puoPagare && pag && \(/);
  assert.match(to, /className=\{puoPagare \? "tbl-btn tbl-btn--vuoto" : "tbl-btn"\}/);
  // La pillola: solo a carrello vuoto, con il resto da pagare.
  assert.match(to, /paga: statoConto\.dati\.invii\.length > 0/);
  const app = nudo("src/components/OrderApp.tsx");
  assert.match(app, /linee\.length === 0 && tavolo\?\.conto\?\.paga \? \(/);
});
