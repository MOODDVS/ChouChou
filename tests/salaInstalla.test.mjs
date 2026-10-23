/**
 * INSTALLARE DEI CLIENTI DAL PALMARE — quanti sono, e quali tavoli proporre.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { proposteInstallazione, catenaDiZona, tavoliNonDisponibili } from "../src/lib/salaInstallaRegole.ts";

const TAV = ["T1", "T2", "T3", "T4", "T5"].map((n) => ({ id: n, name: n, seats: 2 }));
const CATENA = [["T1", "T2", "T3", "T4"]];
const nomi = (ps) => ps.map((p) => p.nomi.join("+"));

test("il tavolo basta: si propone lui, perfetto", () => {
  const p = proposteInstallazione({ tavoli: TAV, catene: CATENA, occupati: [], tavoloId: "T1", persone: 2 });
  assert.equal(nomi(p)[0], "T1");
  assert.equal(p[0].spreco, 0);
});

test("non basta: i tavoli collegati, prima quelli che sprecano meno", () => {
  const p = proposteInstallazione({ tavoli: TAV, catene: CATENA, occupati: [], tavoloId: "T1", persone: 6 });
  assert.deepEqual(nomi(p), ["T1+T2+T3", "T1+T2+T3+T4"]);
  assert.deepEqual([p[0].posti, p[0].spreco], [6, 0]);
});

test("sempre col tavolo toccato, sempre un pezzo contiguo della catena", () => {
  const p = proposteInstallazione({ tavoli: TAV, catene: CATENA, occupati: [], tavoloId: "T2", persone: 4 });
  assert.deepEqual(nomi(p).slice(0, 2).sort(), ["T1+T2", "T2+T3"]);
  for (const x of p) assert.ok(x.ids.includes("T2"));
  // T1+T3 senza T2 non e' mai una proposta; T5 non e' nella catena.
  const tutte = proposteInstallazione({ tavoli: TAV, catene: CATENA, occupati: [], tavoloId: "T1", persone: 3, max: 99 });
  assert.ok(!nomi(tutte).includes("T1+T3"));
  assert.ok(!nomi(tutte).some((x) => x.includes("T5")));
});

test("un tavolo preso spezza la catena", () => {
  const p = proposteInstallazione({ tavoli: TAV, catene: CATENA, occupati: ["T2"], tavoloId: "T1", persone: 6 });
  assert.deepEqual(p, [], "senza T2 da T1 non si arriva a T3");
  assert.deepEqual(proposteInstallazione({ tavoli: TAV, catene: CATENA, occupati: ["T1"], tavoloId: "T1", persone: 2 }), []);
});

test("le catene dalle liaisons del piano", () => {
  const legami = JSON.stringify({ Interno: [["a", "b"], ["c"], "rotto", ["d", "e", "f"]], Terrazzo: [["x", "y"]] });
  assert.deepEqual(catenaDiZona(legami, "Interno"), [["a", "b"], ["d", "e", "f"]]);
  assert.deepEqual(catenaDiZona(legami, "Strada"), []);
  assert.deepEqual(catenaDiZona("{rotto", "Interno"), []);
});

const DURATE = { perServizio: { soir: 120 }, ripiego: 90 };

test("chi e' seduto occupa finche' non ha finito; un conto aperto occupa sempre", () => {
  const { occupati } = tavoliNonDisponibili({
    adessoHHmm: "13:00", durataNuova: 90, durate: DURATE,
    righe: [
      { status: "seated", heure: "12:30", tables: ["A"] },                       // seduto da mezz'ora
      { status: "seated", heure: "10:00", tables: ["B"] },                       // finito e dimenticato
      { status: "seated", heure: "10:00", tables: ["C"], tab_status: "open" },   // dimenticato ma col conto aperto
      { status: "seated", heure: "11:20", tables: JSON.stringify(["D"]) },       // 90 + 20 di margine: ancora li'
    ],
  });
  assert.deepEqual([...occupati].sort(), ["A", "C", "D"]);
});

test("chi deve arrivare blocca i suoi tavoli se si sovrappone", () => {
  const { prenotati, occupati } = tavoliNonDisponibili({
    adessoHHmm: "13:00", durataNuova: 90, durate: DURATE,
    righe: [
      { status: "confirmed", heure: "13:30", tables: ["E"] },
      { status: "pending", heure: "12:45", tables: ["F"] },
      { status: "confirmed", heure: "15:00", tables: ["G"] },     // dopo la fine: libero
      { status: "cancelled", heure: "13:15", tables: ["H"] },
      { status: "confirmed", heure: "13:10", tables: [] },        // senza tavoli: niente
    ],
  });
  assert.deepEqual([...prenotati].sort(), ["E", "F"]);
  assert.equal(occupati.size, 0);
});

test("l'installazione ricontrolla sul server e crea una prenotazione seduta coi tavoli", () => {
  const src = readFileSync("src/lib/admin/installaTavolo.ts", "utf8");
  assert.match(src, /if \(ids\.some\(\(id\) => l\.occupati\.has\(id\)\)\) return \{ ok: false, errore: "occupato" \};/);
  assert.match(src, /status: "seated",\s*seated_at: l\.ora\.toISO\(\),\s*tables: ids,/);
  assert.match(src, /source: "walkin"/);
});

test("i nomi in ordine naturale anche se la catena e' disegnata al contrario", () => {
  const p = proposteInstallazione({ tavoli: TAV, catene: [["T3", "T2", "T1"]], occupati: [], tavoloId: "T1", persone: 4 });
  assert.deepEqual(p[0].nomi, ["T1", "T2"]);
});

test("i tavoli uniti di chi e' seduto diventano un gruppo, per il legame sulla piantina", () => {
  const { gruppi, occupati } = tavoliNonDisponibili({
    adessoHHmm: "13:00", durataNuova: 90, durate: DURATE,
    righe: [
      { status: "seated", heure: "12:50", tables: ["T1", "T2"] },
      { status: "seated", heure: "12:50", tables: ["T5"] },
      { status: "seated", heure: "09:00", tables: ["T6", "T7"] },   // finito: niente legame
    ],
  });
  assert.deepEqual(gruppi, [["T1", "T2"]]);
  assert.deepEqual([...occupati].sort(), ["T1", "T2", "T5"]);
});

// ---------- spostare una tavolata gia' seduta (23/10/2026) ----------
import { proposteCambio, tavoliDaAggiungere, tavoliDaLiberare } from "../src/lib/salaInstallaRegole.ts";

const SALA = { zona: "Salle", tavoli: TAV, catene: CATENA };
const TERRAZZA = { zona: "Terrasse", tavoli: [{ id: "E1", name: "E1", seats: 4 }, { id: "E2", name: "E2", seats: 2 }], catene: [] };

test("cambiare tavolo: in ogni sala, dalla piu' plausibile, mai i tavoli di adesso", () => {
  const p = proposteCambio({ zone: [SALA, TERRAZZA], occupati: ["T3"], attuali: ["T1"], persone: 2 });
  const sala = p.find((z) => z.zona === "Salle").proposte.map((x) => x.nomi.join("+"));
  assert.deepEqual(sala.slice(0, 3), ["T2", "T4", "T5"]);
  for (const z of p) for (const x of z.proposte) assert.ok(!x.ids.includes("T1"));
  const ter = p.find((z) => z.zona === "Terrasse").proposte.map((x) => x.nomi.join("+"));
  assert.deepEqual(ter, ["E2", "E1"], "prima quella che non spreca posti");
});

test("cambiare tavolo per 4: le combinazioni collegate, e una sala piena non compare", () => {
  const p = proposteCambio({ zone: [SALA, TERRAZZA], occupati: ["E1"], attuali: ["T1"], persone: 4 });
  assert.deepEqual(p.map((z) => z.zona), ["Salle"]);
  assert.deepEqual(p[0].proposte.map((x) => x.nomi.join("+")), ["T2+T3", "T3+T4", "T2+T3+T4"]);
});

test("aggiungere: solo i vicini liberi in catena", () => {
  const a = tavoliDaAggiungere({ tavoli: TAV, catene: CATENA, occupati: ["T4"], attuali: ["T2", "T3"] });
  assert.deepEqual(a.map((x) => x.tavolo.name), ["T1"]);
  assert.deepEqual(a[0].nomi, ["T1", "T2", "T3"]);
  assert.equal(a[0].posti, 6);
  assert.deepEqual(tavoliDaAggiungere({ tavoli: TAV, catene: CATENA, occupati: [], attuali: ["T5"] }), [], "T5 non e' in nessuna catena");
});

test("liberare: ne resta uno, e in catena solo le punte", () => {
  assert.deepEqual(tavoliDaLiberare({ tavoli: TAV, catene: CATENA, attuali: ["T1"] }), []);
  const l = tavoliDaLiberare({ tavoli: TAV, catene: CATENA, attuali: ["T1", "T2", "T3"] });
  assert.deepEqual(l.map((x) => x.tavolo.name), ["T1", "T3"]);
  assert.deepEqual(l[0].nomi, ["T2", "T3"]);
  // Fuori catena (fatti sedere «comunque»): si puo' togliere ognuno.
  assert.deepEqual(tavoliDaLiberare({ tavoli: TAV, catene: CATENA, attuali: ["T5", "T1"] }).map((x) => x.tavolo.name), ["T1", "T5"]);
});
