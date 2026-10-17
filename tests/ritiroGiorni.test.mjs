/**
 * ORDINI ONLINE: DA DOVE VENGONO GLI ORARI, E PER QUANTI GIORNI.
 *
 * ⚠️ Due errori silenziosi da tenere lontani:
 *   · un valore illeggibile in Réglages che apre gli ordini per un anno, o
 *     che sposta il ritiro sui service senza che nessuno l'abbia chiesto;
 *   · un service chiuso (pieno) che resta aperto al ritiro.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  fonteOrari, giorniAvanti, GIORNI_AVANTI, serviziDaConfig, finestreDaServizi, chiaveServizio,
} from "../src/lib/ordiniGiorniRegole.ts";
import { ticketCucina } from "../src/lib/stampaRegole.ts";

const leggi = (f) => readFileSync(f, "utf8");
const nudo = (f) => leggi(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("di ripiego tutto resta com'era: orari d'apertura, solo oggi", () => {
  assert.equal(fonteOrari(undefined), "hours");
  assert.equal(fonteOrari(""), "hours");
  assert.equal(fonteOrari("boh"), "hours");
  assert.equal(fonteOrari("services"), "services");
  assert.equal(giorniAvanti(undefined), 0);
  assert.equal(giorniAvanti("0"), 0);
  assert.equal(giorniAvanti("365"), 0, "un numero fuori elenco non apre l'anno");
  assert.equal(giorniAvanti("3"), 0);
  for (const g of GIORNI_AVANTI) assert.equal(giorniAvanti(String(g)), g);
  assert.deepEqual([...GIORNI_AVANTI], [2, 7, 14, 30]);
});

test("i service si leggono per chiave o per etichetta, e quelli rotti si scartano", () => {
  assert.equal(chiaveServizio({ key: "midi" }), "midi");
  assert.equal(chiaveServizio({ label: "Midi" }), "midi");
  assert.equal(chiaveServizio({ label: "Colazione" }), null);
  const sv = serviziDaConfig(JSON.stringify([
    { key: "midi", from: "12:00", to: "14:30", days: [1, 2, 3] },
    { key: "soir", from: "19:00", to: "22:00" },
    { key: "soir", from: "23:00", to: "22:00" }, // fine prima dell'inizio
    { key: "midi", from: "12", to: "14:00" }, // ora illeggibile
  ]));
  assert.equal(sv.length, 2);
  assert.deepEqual(sv[0].days, [1, 2, 3]);
  assert.deepEqual(serviziDaConfig("non json"), []);
});

test("le finestre seguono giorni, chiusure e giorni speciali", () => {
  const sv = serviziDaConfig([
    { key: "midi", from: "12:00", to: "14:30", days: [1, 2] },
    { key: "soir", from: "19:00", to: "22:00" },
  ]);
  // Lunedi': pranzo e cena.
  assert.deepEqual(finestreDaServizi(sv, 1, undefined, new Set()), { lunch: ["12:00", "14:30"], dinner: ["19:00", "22:00"] });
  // Sabato: il pranzo non c'e'.
  assert.deepEqual(finestreDaServizi(sv, 6, undefined, new Set()), { lunch: null, dinner: ["19:00", "22:00"] });
  // ⚠️ Cena chiusa perche' piena: chiude anche il ritiro.
  assert.deepEqual(finestreDaServizi(sv, 1, undefined, new Set(["soir"])), { lunch: ["12:00", "14:30"], dinner: null });
  // Giorno speciale con solo la cena.
  assert.deepEqual(finestreDaServizi(sv, 1, { services: ["soir"] }, new Set()), { lunch: null, dinner: ["19:00", "22:00"] });
  // Giorno speciale con tutti i service.
  assert.deepEqual(finestreDaServizi(sv, 6, { services: null }, new Set()).lunch, ["12:00", "14:30"]);
});

test("due service dalla stessa parte diventano una finestra sola", () => {
  const sv = serviziDaConfig([
    { key: "soir", from: "18:00", to: "20:00" },
    { key: "soir2", from: "20:30", to: "23:00" },
  ].map((s) => ({ ...s, key: s.key === "soir2" ? "soir" : s.key })));
  assert.deepEqual(finestreDaServizi(sv, 3, undefined, new Set()).dinner, ["18:00", "23:00"]);
});

const base = { numero: "A1B2", ora: "19:30", cliente: "Julie", piatti: [{ qty: 1, nome: "Margherita" }] };

test("il ticket di un altro giorno lo dice in negativo, oggi non cambia", () => {
  const oggi = ticketCucina(base);
  const sabato = ticketCucina({ ...base, giorno: "SAB 24/10" });
  assert.equal(oggi.some((r) => r.testo === "SAB 24/10"), false);
  const riga = sabato.find((r) => r.testo === "SAB 24/10");
  assert.ok(riga, "il giorno manca dal ticket");
  assert.equal(riga.inverso, true);
  assert.equal(riga.taglia, "gigante");
  // ⚠️ Sotto la riga di servizio, sopra i piatti: chi prepara lo legge prima.
  const iGiorno = sabato.indexOf(riga);
  const iPiatto = sabato.findIndex((r) => r.testo.includes("Margherita"));
  assert.ok(iGiorno < iPiatto);
  // Al tavolo il giorno non si stampa: si mangia adesso.
  const sala = ticketCucina({ ...base, giorno: "SAB 24/10", servizio: "table", tavolo: "7" });
  assert.equal(sala.some((r) => r.testo === "SAB 24/10"), false);
});

test("il checkout ricontrolla il giorno e i suoi orari", () => {
  const co = nudo("src/pages/api/checkout.ts");
  assert.match(co, /giornoAmmesso\(/, "il checkout deve rifiutare un giorno fuori finestra");
  assert.match(co, /configRitiro\(/, "il ritiro deve leggere gli orari di ritiro, non quelli d'apertura");
  const slots = nudo("src/pages/api/slots.ts");
  assert.match(slots, /giornoAmmesso\(/);
  // L'admin che prende un ordine a mano propone gli stessi orari del sito.
  assert.match(nudo("src/pages/api/admin/orders.ts"), /configRitiro\(/);
});

test("chiudere o riaprire un service fa scadere gli orari di ritiro", () => {
  const sc = nudo("src/pages/api/admin/service-closures.ts");
  assert.ok((sc.match(/scadeOrariRitiro\(\)/g) ?? []).length >= 2, "POST e DELETE devono svuotare la cache");
  assert.match(nudo("src/pages/api/admin/settings.ts"), /scadeOrariRitiro\(\)/);
});

test("il sito manda il giorno scelto e lo azzera cambiando giorno", () => {
  const app = nudo("src/components/OrderApp.tsx");
  assert.match(app, /date: giorno/);
  const sp = nudo("src/components/SlotPicker.tsx");
  assert.match(sp, /\/api\/slots\?days=1/);
  // ⚠️ Cambiare giorno spegne l'orario: le 19:30 di domani non sono quelle di oggi.
  assert.match(sp, /function scegliGiorno[\s\S]{0,300}onSelect\?\.\(null\)/);
});

test("le email scrivono il giorno quando non e' oggi", () => {
  const n = nudo("src/lib/notifications.ts");
  assert.match(n, /function oraRitiro\(iso: string, fuso: string, lingua\?: string\)/);
  // Cliente: nella sua lingua. Cucina e Slack: nella lingua dell'admin.
  assert.ok((n.match(/oraRitiro\(o\.pickup_time, fuso, o\.lang/g) ?? []).length >= 3);
  assert.ok((n.match(/oraRitiro\(o\.pickup_time, fuso, await adminLang\(\)/g) ?? []).length >= 3);
});
