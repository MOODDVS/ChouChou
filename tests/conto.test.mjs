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
  assert.match(to, /u\.searchParams\.delete\("code"\);/);
  assert.match(leggi("src/components/PaginaTavolo.astro"), /conto=\{sala\.conto\}/);
});
