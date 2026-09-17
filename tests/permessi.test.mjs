/**
 * PERMESSI — la porta, non il cartello.
 *
 * Prima di oggi il ruolo era un suggerimento: la nav nascondeva i link nel
 * browser, e `settings` e `super` si difendevano dentro uno <script>, cioe'
 * dopo che la pagina era gia' stata mandata. Un «utente» che scriveva
 * /admin/stats riceveva il fatturato del giorno gia' calcolato dal server e
 * incollato nell'HTML.
 *
 * Queste prove guardano due cose: la regola (pura) e il fatto che qualcuno la
 * applichi davvero PRIMA di rendere la pagina.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  chiavePagina,
  pagineConsentite,
  puoVederePagina,
  pagineDiDefault,
  pulisciPagine,
  PAGINE_SOLO_ADMIN,
  PAGINE_SOLO_SUPER,
} from "../src/lib/admin/permessiRegole.ts";

const TUTTE = ["orders", "reservations", "clients", "menu", "stats", "marketing", "assets", "print", "agenda", "settings"];

test("dal percorso alla pagina", () => {
  assert.equal(chiavePagina("/admin"), "home");
  assert.equal(chiavePagina("/admin/"), "home");
  assert.equal(chiavePagina("/admin/stats"), "stats");
  assert.equal(chiavePagina("/admin/stats/"), "stats");
  assert.equal(chiavePagina("/admin/super"), "super");
  assert.equal(chiavePagina("/admin/menu?tab=food"), "menu");
  assert.equal(chiavePagina("/"), "");
  assert.equal(chiavePagina("/reservation"), "");
});

test("il super vede tutto, anche cio' che l'installazione ha spento", () => {
  const p = pagineConsentite({ ruolo: "super", nascoste: ["stats", "marketing"], tutte: TUTTE });
  for (const k of TUTTE) assert.ok(p.includes(k), k);
  assert.ok(p.includes("super"));
});

test("l'admin vede tutto TRANNE cio' che l'installazione ha spento", () => {
  const p = pagineConsentite({ ruolo: "admin", nascoste: ["marketing"], tutte: TUTTE });
  assert.ok(p.includes("stats"), "le statistiche sono sue");
  assert.ok(p.includes("settings"));
  assert.ok(!p.includes("marketing"), "spenta per l'installazione");
  assert.ok(!p.includes("super"), "la pagina MOODD non e' dell'admin");
});

test("l'utente senza caselle si comporta come prima", () => {
  // Nessuno ha ancora deciso per lui: e' il comportamento storico, e nessun
  // utente gia' creato deve cambiare comportamento con questa modifica.
  const p = pagineConsentite({ ruolo: "user", pagineUtente: null, nascoste: [], tutte: TUTTE });
  for (const k of PAGINE_SOLO_ADMIN) assert.ok(!p.includes(k), k);
  assert.ok(p.includes("orders"));
  assert.ok(p.includes("reservations"));
});

test("le caselle comandano: se spuntate, valgono loro", () => {
  const p = pagineConsentite({ ruolo: "user", pagineUtente: ["orders", "reservations"], nascoste: [], tutte: TUTTE });
  assert.deepEqual(p, ["orders", "reservations"]);
  // Anche piu' del default storico, se il proprietario lo vuole.
  const q = pagineConsentite({ ruolo: "user", pagineUtente: ["stats"], nascoste: [], tutte: TUTTE });
  assert.deepEqual(q, ["stats"]);
});

test("un elenco VUOTO non vuol dire «tutto»", () => {
  // La distinzione che conta: [] = «niente», null = «mai deciso». Se fossero
  // la stessa cosa, togliere l'ultima casella darebbe accesso a tutto.
  assert.deepEqual(pagineConsentite({ ruolo: "user", pagineUtente: [], nascoste: [], tutte: TUTTE }), []);
  assert.ok(pagineConsentite({ ruolo: "user", pagineUtente: null, nascoste: [], tutte: TUTTE }).length > 0);
});

test("l'installazione vince sulle caselle", () => {
  // Spuntare una pagina che il cliente ha spento non la riaccende.
  const p = pagineConsentite({ ruolo: "user", pagineUtente: ["orders", "marketing"], nascoste: ["marketing"], tutte: TUTTE });
  assert.deepEqual(p, ["orders"]);
});

test("/admin/super e' solo del super, e la home e' di tutti", () => {
  for (const ruolo of ["admin", "user"]) {
    assert.equal(puoVederePagina("super", { ruolo, pagineUtente: null, nascoste: [], tutte: TUTTE }), false, ruolo);
    assert.equal(puoVederePagina("home", { ruolo, pagineUtente: [], nascoste: [], tutte: TUTTE }), true, ruolo);
  }
  assert.equal(puoVederePagina("super", { ruolo: "super", nascoste: [], tutte: TUTTE }), true);
  for (const k of PAGINE_SOLO_SUPER) assert.ok(!TUTTE.includes(k), `${k} non deve essere spuntabile`);
});

test("una pagina sconosciuta non viene bloccata", () => {
  // Login, reset-password e la prossima pagina che qualcuno aggiunge non
  // passano da PAGINE_ADMIN: negare cio' che non si conosce le spegnerebbe
  // senza che nessuno capisca perche'.
  assert.equal(puoVederePagina("qualcosa-di-nuovo", { ruolo: "user", pagineUtente: [], nascoste: [], tutte: TUTTE }), true);
});

test("cio' che arriva dal modale viene ripulito", () => {
  assert.deepEqual(pulisciPagine(["orders", "orders", "ORDERS"], TUTTE), ["orders"]);
  assert.deepEqual(pulisciPagine(["orders", "pippo", "<script>"], TUTTE), ["orders"]);
  assert.deepEqual(pulisciPagine([], TUTTE), []);
  assert.equal(pulisciPagine(null, TUTTE), null, "null resta null: «mai deciso»");
  assert.equal(pulisciPagine(undefined, TUTTE), null);
  assert.equal(pulisciPagine("orders", TUTTE), null, "una stringa non e' un elenco");
});

test("il default del modale e' quello che l'utente vede davvero", () => {
  assert.deepEqual(
    pagineDiDefault(TUTTE),
    pagineConsentite({ ruolo: "user", pagineUtente: null, nascoste: [], tutte: TUTTE }),
    "le caselle spuntate all'apertura devono combaciare col comportamento senza caselle",
  );
});

// ---------- che qualcuno la applichi ----------
test("il middleware chiude la porta PRIMA di rendere la pagina", () => {
  const mw = readFileSync("src/middleware.ts", "utf8");
  assert.ok(mw.includes("puoVederePagina"), "il middleware non controlla i permessi");
  assert.ok(mw.includes("chiavePagina"), "il middleware non ricava la pagina dal percorso");
  assert.ok(
    /puoVederePagina[\s\S]{0,400}context\.redirect\("\/admin"/.test(mw),
    "il controllo non porta a un redirect: sarebbe un calcolo senza conseguenze",
  );
});

test("la sessione porta le pagine firmate, non il browser", () => {
  const auth = readFileSync("src/lib/admin/adminAuth.ts", "utf8");
  assert.ok(/pages\??:\s*string\[\]/.test(auth), "StaffUser non porta le pagine");
  assert.ok(
    /payload\.app_metadata\?\.pages/.test(auth),
    "le pagine non vengono lette da app_metadata del JWT: se arrivassero dal corpo della richiesta, un utente potrebbe darsele da solo",
  );
});
