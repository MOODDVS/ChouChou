/**
 * L'annuncio in cucina all'apertura (#101, 27/11/2026): un ordine preso a
 * locale chiuso per un altro giorno fa uscire il ticket e suonare RestoHub
 * all'apertura del giorno del ritiro. Le email partono subito.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { primaApertura, momentoAnnuncio, inAttesaDiAnnuncio, annuncioScaduto, RIPIEGO_PRIMA_DEL_RITIRO_MIN } from "../src/lib/annuncioRegole.ts";
import { JOB_ATTESI } from "../src/lib/admin/supabaseRegole.ts";

const FUSO = "Europe/Brussels";
const REGINA = { lunch_active: true, lunch_open: "12:00:00", lunch_close: "14:00:00", dinner_active: true, dinner_open: "18:30:00", dinner_close: "22:00:00" };

test("primaApertura: la fascia accesa che apre prima", () => {
  assert.equal(primaApertura(REGINA), "12:00");
  assert.equal(primaApertura({ ...REGINA, lunch_active: false }), "18:30", "senza pranzo: la cena");
  assert.equal(primaApertura({ ...REGINA, lunch_active: false, dinner_active: false }), null, "giorno chiuso");
  assert.equal(primaApertura({ lunch_open: "12:00", lunch_close: null }), null, "fascia senza chiusura: non conta");
  assert.equal(primaApertura(null), null);
});

test("stanotte per domani sera: all'apertura di domani", () => {
  // giovedi' 26/11 23:10 (Bruxelles = UTC+1) per venerdi' 27/11 19:30
  const m = momentoAnnuncio({ ritiro: "2026-11-27T19:30:00+01:00", adesso: "2026-11-26T23:10:00+01:00", fuso: FUSO, apertura: "12:00" });
  assert.equal(m, "2026-11-27T11:00:00.000Z");
});

test("stamattina prima dell'apertura, per oggi: all'apertura di oggi", () => {
  const m = momentoAnnuncio({ ritiro: "2026-11-27T12:30:00+01:00", adesso: "2026-11-27T09:00:00+01:00", fuso: FUSO, apertura: "12:00" });
  assert.equal(m, "2026-11-27T11:00:00.000Z");
});

test("apertura gia' passata: subito, com'era", () => {
  // alle 15:00, fra pranzo e cena, per le 19:30
  assert.equal(momentoAnnuncio({ ritiro: "2026-11-27T19:30:00+01:00", adesso: "2026-11-27T15:00:00+01:00", fuso: FUSO, apertura: "12:00" }), null);
  // a locale aperto
  assert.equal(momentoAnnuncio({ ritiro: "2026-11-27T13:00:00+01:00", adesso: "2026-11-27T12:20:00+01:00", fuso: FUSO, apertura: "12:00" }), null);
});

test("al tavolo mai: si mangia adesso", () => {
  assert.equal(momentoAnnuncio({ ritiro: "2026-11-27T19:30:00+01:00", adesso: "2026-11-26T23:10:00+01:00", fuso: FUSO, apertura: "12:00", servizio: "table" }), null);
});

test("la consegna aspetta come il ritiro", () => {
  assert.equal(
    momentoAnnuncio({ ritiro: "2026-11-27T19:30:00+01:00", adesso: "2026-11-26T23:10:00+01:00", fuso: FUSO, apertura: "12:00", servizio: "delivery" }),
    "2026-11-27T11:00:00.000Z",
  );
});

test("nessuna apertura leggibile: un po' prima del ritiro, mai dopo", () => {
  const m = momentoAnnuncio({ ritiro: "2026-11-27T19:30:00+01:00", adesso: "2026-11-26T23:10:00+01:00", fuso: FUSO, apertura: null });
  assert.equal(m, "2026-11-27T16:30:00.000Z", `${RIPIEGO_PRIMA_DEL_RITIRO_MIN} minuti prima`);
  // apertura DOPO il ritiro (orari storti): al ritiro, non oltre
  const n = momentoAnnuncio({ ritiro: "2026-11-27T11:00:00+01:00", adesso: "2026-11-26T23:10:00+01:00", fuso: FUSO, apertura: "18:30" });
  assert.equal(n, "2026-11-27T10:00:00.000Z");
});

test("date illeggibili: subito", () => {
  assert.equal(momentoAnnuncio({ ritiro: "domani", adesso: "2026-11-26T23:10:00+01:00", fuso: FUSO, apertura: "12:00" }), null);
});

test("inAttesaDiAnnuncio / annuncioScaduto", () => {
  const ora = Date.parse("2026-11-27T10:00:00Z");
  assert.equal(inAttesaDiAnnuncio("2026-11-27T11:00:00Z", ora), true);
  assert.equal(inAttesaDiAnnuncio("2026-11-27T09:00:00Z", ora), false);
  assert.equal(inAttesaDiAnnuncio(null, ora), false);
  assert.equal(inAttesaDiAnnuncio("boh", ora), false);
  assert.equal(annuncioScaduto("2026-11-27T09:00:00Z", ora), true);
  assert.equal(annuncioScaduto("2026-11-27T11:00:00Z", ora), false);
  assert.equal(annuncioScaduto(null, ora), false);
});

test("la migrazione #101 e il job ogni 5 minuti", () => {
  const sql = readFileSync("supabase/101_orders_annuncio.sql", "utf8");
  assert.match(sql, /add column if not exists announce_at timestamptz/);
  assert.match(sql, /where announce_at is not null/);
  assert.match(readFileSync("supabase/MIGRATIONS.md", "utf8"), /\| 101 \| `101_orders_annuncio\.sql` \|/);
  assert.deepEqual(JOB_ATTESI.find((j) => j.nome === "annuncia-ordini"), { nome: "annuncia-ordini", orario: "*/5 * * * *", percorso: "/api/cron/annuncia-ordini" });
});

test("chi inserisce scrive l'attesa solo quando serve, e riprova senza la #101", () => {
  for (const f of ["src/pages/api/checkout.ts", "src/pages/api/admin/orders.ts"]) {
    const s = readFileSync(f, "utf8");
    assert.match(s, /\.\.\.\(annuncio \? \{ announce_at: annuncio \} : \{\}\)/, f);
    assert.match(s, /annuncio && manca101\(/, f);
  }
});

test("in attesa: niente ticket automatico, niente notifica, niente suono", () => {
  const coda = readFileSync("src/lib/stampaCoda.ts", "utf8");
  assert.match(coda, /if \(origine === "auto" && !opz\.invio\) \{/);
  assert.match(coda, /return \{ accodati: 0, motivo: inAttesaDiAnnuncio\(v\) \? "attesa" : "in_rilascio" \}/, "pieno = lo stampa solo rilasciaAnnunci");
  const conf = readFileSync("src/lib/confermaOrdine.ts", "utf8");
  assert.match(conf, /if \(annuncio === "no"\) void inviaPushOrdine\(/, "la notifica parte qui solo se non c'e' attesa");
  assert.match(conf, /if \(annuncio === "scaduto"\) void rilasciaAnnunci\(/, "ora passata e giro non ancora arrivato: lo si prende subito, una volta");
  const api = readFileSync("src/pages/api/admin/orders.ts", "utf8");
  assert.match(api, /q\.is\("announce_at", null\)/, "recent_paid non mostra chi aspetta: RestoHub non suona");
  assert.match(api, /await rilasciaAnnunci\(ambito\)/, "RestoHub aperto rilascia gli scaduti (riserva del job)");
});

test("audit 27/11: il carrello chiede giorni e pagamento al server, gli errori nella lingua del cliente", () => {
  const app = readFileSync("src/components/OrderApp.tsx", "utf8");
  assert.match(app, /if \(giorni\.length === 0\) \{\s*setClosedToday\(true\);/, "nessun giorno ordinabile = chiuso, anche alle 23:10 di un giorno aperto");
  assert.match(app, /const chiusoOra = closedToday \|\| \(nessunPagamento && !inSala\);/, "nessun modo di pagare = chiuso subito");
  assert.match(readFileSync("src/pages/api/order-options.ts", "utf8"), /pagamento = \{ online: m\.online, locale: m\.locale, coupon: m\.coupon, couponInCassa: m\.couponInCassa, nessuno: m\.nessuno \};/);
  const co = readFileSync("src/pages/api/checkout.ts", "utf8");
  assert.doesNotMatch(co, /err\(\d{3}, "(Orario di ritiro|Giorno di ritiro|Dati mancanti|Un piatto|Impossibile creare|Errore nella creazione)/, "nessun errore in italiano verso il cliente");
  assert.match(co, /errT\(409, "slot"\)/);
});
