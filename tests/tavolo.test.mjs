/**
 * ORDINARE DAL TAVOLO — le regole, prima delle schermate.
 *
 * ⚠️ Il difetto che queste prove tengono chiuso non si vede guardando una
 * pagina: si vede la sera, sul tablet in cucina, quando TUTTI i tavoli sono
 * rossi. Un ordine al tavolo non ha un'ora di ritiro, e il semaforo dei
 * ritardatari conta i minuti da quell'ora.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  servizioDi, alTavolo, modoServizio, avvisaChePronto,
  RIPIEGO_ORDINI, CHIAVI_ORDINI,
} from "../src/lib/ordiniRegole.ts";

const leggi = (f) => readFileSync(f, "utf8");
const nudo = (f) => leggi(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("un ordine senza servizio e' un ordine da asporto, come e' sempre stato", () => {
  // ⚠️ Il caso vero: tutte le righe scritte PRIMA della migrazione #82 non
  // hanno la colonna. Erano da asporto, e devono continuare a comportarsi
  // come prima — ticket con l'ora, semaforo, email di ritiro.
  assert.equal(servizioDi(undefined), "pickup");
  assert.equal(servizioDi(null), "pickup");
  assert.equal(servizioDi(""), "pickup");
  assert.equal(servizioDi("pickup"), "pickup");
  assert.equal(servizioDi("table"), "table");
  // Un valore mai visto non diventa «tavolo» per sbaglio: nel dubbio e' un
  // ritiro, che e' il comportamento che il motore ha sempre avuto.
  assert.equal(servizioDi("terrasse"), "pickup");
  assert.equal(alTavolo("table"), true);
  assert.equal(alTavolo(undefined), false);
});

test("a chi e' seduto a tre metri non si manda l'email «c'e' pronto»", () => {
  const ora = Date.now();
  const iso = new Date(ora).toISOString();
  // Da asporto, dentro la finestra: si avvisa.
  assert.equal(avvisaChePronto(iso, ora, "pickup"), true);
  assert.equal(avvisaChePronto(iso, ora), true, "il ripiego deve restare «da asporto»");
  // ⚠️ Al tavolo MAI, nemmeno all'ora esatta: il piatto arriva in mano, e
  // l'email o e' rumore o arriva dopo che il cameriere ha gia' servito.
  assert.equal(avvisaChePronto(iso, ora, "table"), false);
  assert.equal(avvisaChePronto(iso, ora - 3600_000, "table"), false);
});

test("la sala e' SPENTA finche' qualcuno non la accende", () => {
  // ⚠️ Un ristorante che fa solo asporto non ha tavoli: una pagina «ordina dal
  // tavolo» accesa di ripiego gli darebbe un QR verso un modulo senza senso.
  assert.equal(RIPIEGO_ORDINI.orders_table, "0");
  assert.ok(CHIAVI_ORDINI.includes("orders_table"),
    "la chiave non viene letta dalla configurazione: l'interruttore non farebbe niente");
  // E il ripiego del database muto non la accende per sbaglio.
  const opz = nudo("src/lib/ordiniOpzioni.ts");
  assert.match(opz, /tavolo:\s*false/,
    "il ripiego accende la sala: un database muto darebbe tavoli a chi non ne ha");
});

test("si paga a ogni giro, e il conto aperto non e' promesso", () => {
  assert.equal(modoServizio(), "per_giro");
  // ⚠️ Il conto aperto vuole che la cucina cuocia PRIMA di essere pagata, e
  // oggi `daStampare` lo rifiuta. Finche' quella regola non cambia, il
  // pannello non deve offrire la scelta: un interruttore che promette una
  // cosa non costruita e' peggio di un'opzione assente.
  const stampa = nudo("src/lib/stampaRegole.ts");
  assert.match(stampa, /s === "pending" && String\(metodo \?\? ""\) === "onsite"/,
    "daStampare ha cambiato regola: se adesso stampa il non pagato, il conto aperto e' possibile e questa prova va riscritta");
});

test("la migrazione #82 c'e', ed e' richiamabile due volte", () => {
  const m = leggi("supabase/082_orders_service_tavolo.sql");
  // ⚠️ Le migrazioni si ripassano su installazioni vive: tutto idempotente.
  assert.match(m, /add column if not exists service/);
  assert.match(m, /default 'pickup'/, "senza default, le righe gia' scritte diventerebbero senza servizio");
  // ⚠️ Il check si aggiunge a parte: `add column if not exists` non lo riporta
  // quando la colonna esiste gia', e un check perso non si vede finche'
  // qualcuno non scrive un valore storto.
  assert.match(m, /pg_constraint/,
    "il check arriva attaccato alla colonna: su un'installazione che ripassa le migrazioni andrebbe perso");
  assert.match(m, /on delete set null/,
    "reservation_id senza regola di cancellazione: cancellando una prenotazione si perderebbe un incasso vero");
  assert.doesNotMatch(m, /table_id[^;]*references/,
    "table_id ha una foreign key: togliere un tavolo costringerebbe a scegliere fra rifiutare e cancellare gli ordini");
  // Il nome del tavolo accanto all'id, come per le note assegnate (#81).
  assert.match(m, /table_label/,
    "manca il nome del tavolo: rinominandolo, gli ordini di marzo resterebbero senza un numero da dire a voce");
});
