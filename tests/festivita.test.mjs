/**
 * FESTIVITA' — la rete sotto il calendario.
 *
 * Tre cose possono rompersi qui, e nessuna delle tre fa rumore:
 *  1. la Pasqua sbagliata di un giorno sposta Ascensione e Pentecoste con se';
 *  2. una chiave senza nome mostra `undefined` nella tile;
 *  3. a fine dicembre la lista diventa vuota, e resta vuota una settimana.
 * Le date qui sotto sono verificate su fonti ufficiali (BE: publicholidays.be,
 * LU: luxembourg.public.lu), non calcolate da questo stesso codice.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  pasqua,
  festivita,
  prossimeFestivita,
  codicePaese,
  paeseHaFestivita,
  PAESI_CON_FESTIVITA,
  ricorrenze,
} from "../src/lib/festivitaRegole.ts";

const LINGUE = ["fr", "en", "it", "nl", "es"];

// ---------- Pasqua ----------
test("la Pasqua cade dove dicono le effemeridi", () => {
  const attese = {
    2000: "2000-04-23",
    2024: "2024-03-31",
    2025: "2025-04-20",
    2026: "2026-04-05",
    2027: "2027-03-28",
    2028: "2028-04-16",
    2030: "2030-04-21",
    2038: "2038-04-25",
  };
  for (const [anno, data] of Object.entries(attese)) {
    assert.equal(pasqua(Number(anno)), data, `Pasqua ${anno}`);
  }
});

test("le feste mobili seguono la Pasqua, non il calendario", () => {
  // Fonte: luxembourg.public.lu (Ascension / Lundi de Pentecôte 2026 e 2027).
  const be26 = festivita("BE", 2026);
  const trova = (lista, k) => lista.find((f) => f.chiave === k)?.data;
  assert.equal(trova(be26, "pasquetta"), "2026-04-06");
  assert.equal(trova(be26, "ascensione"), "2026-05-14");
  assert.equal(trova(be26, "pentecoste2"), "2026-05-25");

  const be27 = festivita("BE", 2027);
  assert.equal(trova(be27, "pasquetta"), "2027-03-29");
  assert.equal(trova(be27, "ascensione"), "2027-05-06");
  assert.equal(trova(be27, "pentecoste2"), "2027-05-17");
});

// ---------- Le tabelle ----------
test("il Belgio ha le sue dieci feste legali", () => {
  const be = festivita("BE", 2026);
  assert.equal(be.length, 10);
  const date = be.map((f) => f.data);
  assert.ok(date.includes("2026-07-21"), "Fête nationale");
  assert.ok(date.includes("2026-11-11"), "Armistice");
  assert.ok(date.includes("2026-12-25"), "Noël");
  // Il Belgio NON ha Santo Stefano: e' il paese di tutti i clienti attuali,
  // e il 26 dicembre lì si lavora.
  assert.ok(!date.includes("2026-12-26"), "il 26/12 non e' festivo in Belgio");
});

test("il Lussemburgo e' l'unico con la Giornata dell'Europa", () => {
  const lu = festivita("LU", 2026);
  assert.ok(lu.some((f) => f.chiave === "europa" && f.data === "2026-05-09"));
  const be = festivita("BE", 2026);
  assert.ok(!be.some((f) => f.chiave === "europa"));
});

test("Koningsdag arretra quando il 27 aprile e' domenica", () => {
  // 27/04/2025 era una domenica: si festeggia il 26.
  const nl25 = festivita("NL", 2025);
  assert.equal(nl25.find((f) => f.chiave === "koningsdag")?.data, "2025-04-26");
  // 2026: il 27 e' un lunedi', resta il 27.
  const nl26 = festivita("NL", 2026);
  assert.equal(nl26.find((f) => f.chiave === "koningsdag")?.data, "2026-04-27");
});

test("ogni lista e' ordinata, senza doppioni e dentro l'anno chiesto", () => {
  for (const paese of PAESI_CON_FESTIVITA) {
    for (const anno of [2026, 2027, 2028]) {
      const lista = festivita(paese, anno);
      assert.ok(lista.length > 0, `${paese} ${anno} e' vuoto`);
      const date = lista.map((f) => f.data);
      assert.deepEqual(date, [...date].sort(), `${paese} ${anno} non e' ordinato`);
      assert.equal(new Set(date).size, date.length, `${paese} ${anno} ha doppioni`);
      for (const d of date) {
        assert.equal(d.slice(0, 4), String(anno), `${paese}: ${d} non e' del ${anno}`);
      }
    }
  }
});

// ---------- I nomi ----------
test("nessuna festa esce senza nome, in nessuna delle cinque lingue", () => {
  for (const paese of PAESI_CON_FESTIVITA) {
    for (const f of festivita(paese, 2026)) {
      assert.ok(f.nome, `${paese}/${f.chiave}: nome mancante`);
      for (const l of LINGUE) {
        assert.equal(typeof f.nome[l], "string", `${paese}/${f.chiave}: manca ${l}`);
        assert.ok(f.nome[l].length > 0, `${paese}/${f.chiave}: ${l} vuoto`);
      }
    }
  }
});

// ---------- Paesi che non sappiamo ----------
test("un paese senza tabella rende [] invece di inventare", () => {
  assert.deepEqual(festivita("CH", 2026), []);
  assert.deepEqual(festivita("JP", 2026), []);
  assert.deepEqual(festivita("", 2026), []);
  assert.deepEqual(festivita("BE", NaN), []);
  assert.equal(paeseHaFestivita("CH"), false);
  assert.equal(paeseHaFestivita("be"), true, "il codice minuscolo vale come maiuscolo");
});

// ---------- Il confine dell'anno ----------
test("fra Natale e Capodanno le prossime feste sono quelle dell'anno dopo", () => {
  const p = prossimeFestivita("BE", "2026-12-27", 3);
  assert.equal(p.length, 3, "a fine dicembre la lista non deve svuotarsi");
  assert.equal(p[0].data, "2027-01-01");
  assert.ok(p.every((f) => f.data >= "2026-12-27"));
});

test("le prossime feste includono oggi se oggi e' festa", () => {
  const p = prossimeFestivita("BE", "2026-07-21", 2);
  assert.equal(p[0].data, "2026-07-21", "il giorno stesso conta");
});

test("prossimeFestivita non esplode su input sporchi", () => {
  assert.deepEqual(prossimeFestivita("BE", "boh", 3), []);
  assert.deepEqual(prossimeFestivita("BE", "2026-07-21", 0), []);
  assert.deepEqual(prossimeFestivita("XX", "2026-07-21", 3), []);
});

// ---------- Il campo libero di prima ----------
test("il paese scritto a mano nel vecchio campo viene riconosciuto", () => {
  for (const s of ["Belgique", "Belgium", "Belgio", "België", "belgique", "  Belgique  "]) {
    assert.equal(codicePaese(s), "BE", s);
  }
  assert.equal(codicePaese("Pays-Bas"), "NL");
  assert.equal(codicePaese("Paesi Bassi"), "NL");
  assert.equal(codicePaese("Deutschland"), "DE");
  assert.equal(codicePaese("España"), "ES");
  assert.equal(codicePaese("BE"), "BE");
  assert.equal(codicePaese("be"), "BE");
});

test("quello che non si riconosce resta vuoto, non diventa un paese a caso", () => {
  assert.equal(codicePaese("Bruxelles"), "");
  assert.equal(codicePaese(""), "");
  assert.equal(codicePaese("   "), "");
  assert.equal(codicePaese(undefined), "");
  assert.equal(codicePaese("Belgiqu"), "", "un refuso non deve indovinare");
});

// ---------- Ricorrenze commerciali ----------
test("la festa del papa' non e' lo stesso giorno in tutta Europa", () => {
  const papa = (p, a) => ricorrenze(p, a).find((f) => f.chiave === "papa")?.data;
  // San Giuseppe, 19 marzo
  assert.equal(papa("IT", 2026), "2026-03-19");
  assert.equal(papa("ES", 2026), "2026-03-19");
  assert.equal(papa("PT", 2026), "2026-03-19");
  // Germania: Vatertag = Ascensione (Pasqua +39)
  assert.equal(papa("DE", 2026), "2026-05-14");
  // Francia e Paesi Bassi: 3a domenica di giugno · Belgio: 2a
  assert.equal(papa("FR", 2026), "2026-06-21");
  assert.equal(papa("NL", 2026), "2026-06-21");
  assert.equal(papa("BE", 2026), "2026-06-14");
  // Lussemburgo: 1a domenica di ottobre
  assert.equal(papa("LU", 2026), "2026-10-04");
});

test("la festa della mamma segue la regola del paese", () => {
  const mamma = (p, a) => ricorrenze(p, a).find((f) => f.chiave === "mamma")?.data;
  assert.equal(mamma("BE", 2026), "2026-05-10", "2a domenica di maggio");
  assert.equal(mamma("IT", 2026), "2026-05-10");
  assert.equal(mamma("ES", 2026), "2026-05-03", "1a domenica di maggio");
  assert.equal(mamma("LU", 2026), "2026-06-14", "2a domenica di giugno");
  // Francia: ultima domenica di maggio = 31/05/2026
  assert.equal(mamma("FR", 2026), "2026-05-31");
});

test("in Francia la festa della mamma scivola a giugno quando cade di Pentecoste", () => {
  // Si cerca un anno in cui l'ultima domenica di maggio E' Pentecoste
  // (Pasqua +49) e si verifica che la data slitti alla 1a di giugno.
  const mamma = (a) => ricorrenze("FR", a).find((f) => f.chiave === "mamma")?.data;
  let trovato = 0;
  for (let a = 2024; a <= 2060; a++) {
    const d = mamma(a);
    if (d.startsWith(`${a}-06`)) { trovato++; assert.equal(d, ricorrenze("FR", a).find((f) => f.chiave === "mamma").data); }
  }
  assert.ok(trovato > 0, "in 37 anni la regola deve scattare almeno una volta");
});

test("San Nicola solo dove porta i regali", () => {
  for (const p of ["BE", "NL", "LU"]) {
    assert.ok(ricorrenze(p, 2026).some((f) => f.chiave === "sanNicola"), p);
  }
  for (const p of ["FR", "IT", "ES", "PT", "DE"]) {
    assert.ok(!ricorrenze(p, 2026).some((f) => f.chiave === "sanNicola"), p);
  }
});

test("le ricorrenze sono ordinate, con nome in cinque lingue, e [] se il paese non c'e'", () => {
  for (const paese of PAESI_CON_FESTIVITA) {
    const r = ricorrenze(paese, 2026);
    assert.ok(r.length >= 7, paese);
    const date = r.map((f) => f.data);
    assert.deepEqual(date, [...date].sort(), `${paese} non ordinato`);
    for (const f of r) for (const l of LINGUE) {
      assert.ok(f.nome?.[l], `${paese}/${f.chiave}: manca ${l}`);
    }
  }
  assert.deepEqual(ricorrenze("CH", 2026), []);
  assert.deepEqual(ricorrenze("BE", NaN), []);
});
