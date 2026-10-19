/**
 * GLI ORARI DELLA SALA — quando si ordina dal tavolo (`src/lib/salaOrariRegole.ts`,
 * `configSala` in `src/lib/schedule.ts`, Réglages › Cuisine).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  fonteSala, prolungaSala, serviziSalaDaConfig, serviziDellaSala, allungaOra, finestreSala,
} from "../src/lib/salaOrariRegole.ts";
import { servizioInCorso } from "../src/lib/ordiniRegole.ts";

const leggi = (f) => readFileSync(f, "utf8");
const nudo = (f) => leggi(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SERVIZI = [
  { key: "dejeuner", from: "12:00", to: "14:30", days: [1, 2, 3, 4, 5] },
  { key: "diner", from: "19:00", to: "22:00", days: [] },
];

test("i valori: qualunque cosa strana torna al comportamento di prima", () => {
  assert.equal(fonteSala("services"), "services");
  assert.equal(fonteSala(""), "hours");
  assert.equal(fonteSala("boh"), "hours");
  assert.equal(prolungaSala("60"), 60);
  assert.equal(prolungaSala("45"), 0);
  assert.equal(prolungaSala(undefined), 0);
  assert.deepEqual(serviziSalaDaConfig('["dejeuner"]'), ["dejeuner"]);
  assert.equal(serviziSalaDaConfig(""), null, "vuoto = tutti");
  assert.equal(serviziSalaDaConfig("[]"), null);
  assert.equal(serviziSalaDaConfig("{rotto"), null);
});

test("solo i service scelti; scelti spariti = tutti, e si dice", () => {
  assert.deepEqual(serviziDellaSala(SERVIZI, ["dejeuner"]).servizi.map((s) => s.key), ["dejeuner"]);
  assert.deepEqual(serviziDellaSala(SERVIZI, null), { servizi: SERVIZI, orfana: false });
  const orfana = serviziDellaSala(SERVIZI, ["midi"]);
  assert.equal(orfana.orfana, true, "una sala che si spegne in silenzio e' un QR che dice «fermé» a pranzo");
  assert.equal(orfana.servizi.length, 2);
});

test("il margine allunga la fine, anche oltre mezzanotte", () => {
  assert.equal(allungaOra("14:30", 30), "15:00");
  assert.equal(allungaOra("23:30", 60), "00:30");
});

test("Educazione: solo pranzo, nei giorni del service, col margine", () => {
  // Martedi': pranzo 12:00–15:00, niente cena.
  const mar = finestreSala(SERVIZI, 2, undefined, ["dejeuner"], 30);
  assert.deepEqual(mar, { lunch: ["12:00", "15:00"], dinner: null });
  const cfg = { lunch_active: !!mar.lunch, lunch_open: mar.lunch[0], lunch_close: mar.lunch[1], dinner_active: false, dinner_open: null, dinner_close: null };
  assert.equal(servizioInCorso(cfg, "14:45"), "midi", "il dolce dopo l'ultimo arrivo");
  assert.equal(servizioInCorso(cfg, "20:00"), null);
  // Domenica il service non c'e': sala chiusa.
  assert.deepEqual(finestreSala(SERVIZI, 0, undefined, ["dejeuner"], 30), { lunch: null, dinner: null });
  // Un giorno speciale «ouvert» con solo la cena: niente pranzo.
  assert.deepEqual(finestreSala(SERVIZI, 2, { services: ["diner"] }, null, 0), { lunch: null, dinner: ["19:00", "22:00"] });
});

test("configSala: una sola regola per pagina, sessione, campanella e cassa", () => {
  const sch = nudo("src/lib/schedule.ts");
  const i = sch.indexOf("export async function configSala");
  assert.ok(i > 0);
  const corpo = sch.slice(i, i + 1800);
  // Prima fonte e ripiego: gli orari d'apertura.
  assert.match(corpo, /if \(dati\.fonte === "hours" \|\| dati\.servizi\.length === 0\) return base;/);
  // I giorni chiusi del calendario chiudono anche la sala…
  assert.match(corpo, /if \(sp\?\.type === "closed"\) return \{ \.\.\.base, lunch_active: false, dinner_active: false \};/);
  // …le chiusure dei service no: nessuna lettura di `service_closures` qui.
  assert.doesNotMatch(corpo, /service_closures|chiusePerData/);
  // Svuotata con gli orari di ritiro a ogni salvataggio dei Réglages.
  assert.match(sch, /cacheOr\(`sched:ritiro:sala:/);
  for (const f of ["src/pages/api/table-call.ts", "src/pages/api/table-session.ts"]) {
    assert.match(nudo(f), /const cfg = await configSala\(adesso, ambito\);/, f);
    assert.doesNotMatch(nudo(f), /configGiornoEffettiva/, f);
  }
  assert.match(nudo("src/pages/api/checkout.ts"), /aTavolo \? await configSala\(ora, ambitoPub\) : await configRitiro\(/);
  assert.match(nudo("src/lib/ordiniOpzioni.ts"), /const cfg = await configSala\(ora, ambito\);/);
});

test("Réglages: la fonte, le pillole dei service, il margine; «Services» vuoto rifiutato", () => {
  const api = nudo("src/pages/api/admin/settings.ts");
  assert.match(api, /sala_fonte: fonteSala\(cfg\.get\("orders_table_hours"\)\),/);
  // Le pillole nell'ordine della giornata: Midi prima di Soir.
  assert.match(api, /return elenco\.sort\(\(x, y\) => x\.orari\[0\]\.localeCompare\(y\.orari\[0\]\)\);/);
  assert.match(api, /return json\(\{ error: await msg\("err\.tableServices"\) \}, 400\);/);
  // Tutti scelti = vuoto = anche quelli di domani.
  assert.match(api, /coppie\.orders_table_services = tutti\.every\(\(k\) => scelti\.includes\(k\)\) \? "" :/);
  const reg = leggi("src/lib/admin/sedeRegole.ts");
  for (const k of ["orders_table_hours", "orders_table_services", "orders_table_extend"]) assert.match(reg, new RegExp(`${k}: "sede",`));
  const pag = leggi("src/pages/admin/settings.astro");
  // I nomi dei service con textContent, mai innerHTML.
  assert.match(pag, /m\.textContent = `\$\{nomeServizio\(key, LANG\)\} · \$\{orari\.join\(", "\)\}`;/);
  // Senza service la riga non c'e': l'unica risposta e' l'apertura.
  assert.match(pag, /const conServizi = Boolean\(swTavolo\?\.checked\) && elencoSala\.length > 0;/);
  assert.match(pag, /sala_fonte: document\.querySelector<HTMLButtonElement>\("#o-table-hours \.prep-btn\.active"\)/);
});
