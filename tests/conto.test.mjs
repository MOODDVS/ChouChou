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
} from "../src/lib/contoRegole.ts";
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

test("la finestra: Non / 1 / 2 min, ripiego 1; parte dal PRIMO ordine", () => {
  assert.equal(finestraInvio("0"), 0);
  assert.equal(finestraInvio("2"), 2);
  assert.equal(finestraInvio(""), 1);
  assert.equal(finestraInvio("5"), 1);
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
