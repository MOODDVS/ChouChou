/**
 * L'AFFLUENZA — a che ora, di solito, c'e' gente.
 *
 * ⚠️ Il dato NON e' di Google: i «popular times» non sono esposti da nessuna
 * API ufficiale, quindi la curva e' fatta coi nostri numeri. Un grafico pero'
 * non sembra un dato: sembra un disegno, e nessuno lo controlla. Per questo
 * le regole del conto stanno a parte e si provano qui, riga per riga.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  SETTIMANE,
  giorniPrecedenti,
  oraDi,
  mediePerOra,
} from "../src/lib/admin/affluenzaRegole.ts";

test("si guarda lo stesso giorno della settimana, non gli ultimi giorni", () => {
  // Martedi' 6 ottobre 2026 → gli otto martedi' prima, dal piu' vicino.
  const g = giorniPrecedenti("2026-10-06");
  assert.equal(g.length, SETTIMANE);
  assert.equal(g[0], "2026-09-29");
  assert.equal(g[7], "2026-08-11");
  for (const d of g) {
    assert.equal(new Date(d + "T12:00:00Z").getUTCDay(), 2, `${d} non e' un martedi'`);
    assert.ok(d < "2026-10-06", `${d} non e' prima di oggi`);
  }
});

test("una data che non si legge non diventa oggi", () => {
  // ⚠️ Il ripiego sbagliato sarebbe «parto da adesso»: darebbe una curva
  // plausibile costruita sui giorni sbagliati, cioe' il guasto che non si
  // vede. Meglio nessun giorno: allora il grafico resta vuoto e si capisce.
  assert.deepEqual(giorniPrecedenti(""), []);
  assert.deepEqual(giorniPrecedenti("domani"), []);
  assert.deepEqual(giorniPrecedenti("2026-10-06", 0), []);
});

test("l'ora di una prenotazione", () => {
  assert.equal(oraDi("20:00:00"), 20);
  assert.equal(oraDi("20:00"), 20);
  assert.equal(oraDi("9:30"), 9);
  assert.equal(oraDi("00:15"), 0);
  assert.equal(oraDi(""), -1);
  assert.equal(oraDi(null), -1);
  assert.equal(oraDi("a sera"), -1);
  assert.equal(oraDi("25:00"), -1);
});

test("la media si divide per i giorni che hanno portato righe", () => {
  // Due martedi' con righe, non otto: dividere per otto direbbe 2,5 coperti
  // alle 20 in un locale che ne fa dieci. Il numero sarebbe plausibile, e
  // sbagliato di quattro volte.
  const { covers, settimane } = mediePerOra([
    { giorno: "2026-09-29", ora: 20, quanti: 8, serie: "covers" },
    { giorno: "2026-09-29", ora: 21, quanti: 2, serie: "covers" },
    { giorno: "2026-09-22", ora: 20, quanti: 12, serie: "covers" },
  ]);
  assert.equal(settimane, 2);
  assert.equal(covers["20"], 10);
  assert.equal(covers["21"], 1);
  assert.equal(covers["19"], undefined);
});

test("coperti e ordini restano due conti, con UN divisore", () => {
  // ⚠️ Sommarli darebbe un indice che non e' ne' persone ne' ordini, e che
  // nessuno puo' verificare contando qualcosa.
  // ⚠️ Il divisore pero' e' uno solo: il martedi' con soli ordini e' un
  // martedi' APERTO con zero coperti, e deve abbassare la media dei coperti.
  // Con due divisori le due medie non si potrebbero mettere una accanto
  // all'altra — ed e' esattamente quello che il grafico fa.
  const { covers, orders, settimane } = mediePerOra([
    { giorno: "2026-09-29", ora: 20, quanti: 10, serie: "covers" },
    { giorno: "2026-09-29", ora: 20, quanti: 1, serie: "orders" },
    { giorno: "2026-09-22", ora: 20, quanti: 3, serie: "orders" },
  ]);
  assert.equal(settimane, 2);
  assert.equal(covers["20"], 5);
  assert.equal(orders["20"], 2);
});

test("senza righe non c'e' abitudine, e lo dice", () => {
  // ⚠️ Zero settimane non vuol dire «zero gente»: vuol dire che non si sa.
  // Chi disegna deve poterlo scrivere («pas encore d'historique») invece di
  // mostrare una riga piatta a zero, che e' una misura e non lo e'.
  const vuoto = mediePerOra([]);
  assert.deepEqual(vuoto.covers, {});
  assert.deepEqual(vuoto.orders, {});
  assert.equal(vuoto.settimane, 0);
  const sporco = mediePerOra([
    { giorno: "2026-09-29", ora: -1, quanti: 4, serie: "covers" },
    { giorno: "2026-09-29", ora: 20, quanti: 0, serie: "covers" },
    { giorno: "2026-09-29", ora: 20, quanti: 3, serie: "pizze" },
  ]);
  assert.equal(sporco.settimane, 0);
});

test("il grafico conta solo cio' che chi guarda puo' vedere", () => {
  // ⚠️ Una barra e' un dato come un altro. Se «Commandes» e' spenta, gli
  // ordini non devono entrare nemmeno nella somma: altrimenti la curva
  // racconta, in forma di disegno, un giro d'affari che quella persona non
  // puo' aprire — e nessun 403 lo direbbe.
  const api = readFileSync("src/pages/api/admin/affluence.ts", "utf8");
  assert.match(api, /mostra\(ctx, "reservations"\)/, "l'affluenza non chiede il permesso per le prenotazioni");
  assert.match(api, /mostra\(ctx, "orders"\)/, "l'affluenza non chiede il permesso per gli ordini");
  assert.match(api, /verificaStaff\(request\)/, "l'affluenza risponde anche a chi non ha fatto il login");

  const lib = readFileSync("src/lib/admin/affluenza.ts", "utf8");
  assert.match(lib, /fonti\.resa\s*\n?\s*\?\s*leggi\("reservations"/, "le prenotazioni si leggono comunque");
  assert.match(lib, /fonti\.ordini\s*\n?\s*\?\s*leggi\("orders"/, "gli ordini si leggono comunque");
});

test("una serie spenta non esiste, e il grafico con lei", () => {
  // «Se gli ordini sono chiusi si nascondono, e se sono chiusi tutti e due si
  // nasconde»: la decisione e' UNA e sta sul server, dentro `fonti`. Il
  // disegno non nasconde niente — disegna solo cio' che gli arriva.
  // Altrimenti sarebbero due regole, e un giorno direbbero cose diverse.
  const home = readFileSync("src/pages/admin/index.astro", "utf8");
  assert.match(home, /const vedeCov = conta\.has\("covers"\)/, "il disegno non guarda piu' le fonti del server");
  assert.match(home, /const vedeOrd = conta\.has\("orders"\)/);
  assert.match(home, /if \(vedeCov\) serie\.push/, "la serie dei coperti si disegna comunque");
  assert.match(home, /if \(vedeOrd\) serie\.push/, "la serie degli ordini si disegna comunque");
  // Nessuna serie, nessun grafico: `serie.length` nella guardia e' quello che
  // spegne la striscia quando sono chiuse tutte e due.
  assert.match(home, /if \(hm && plot && assi && serie\.length/, "con zero serie il grafico si disegna lo stesso");

  const lib = readFileSync("src/lib/admin/affluenza.ts", "utf8");
  assert.match(lib, /if \(!quali\.length\) return \{ covers: \{\}, orders: \{\}, settimane: 0, fonti: \[\] \}/,
    "senza funzioni accese il server interroga comunque il database");
});

test("gli orari di oggi si dicono in un posto solo", () => {
  // La tile «Horaires» e la fascia dicevano la stessa cosa. Due punti che
  // dicono l'orario di oggi sono due punti che un giorno diranno orari
  // diversi, e chi legge non sapra' quale credere.
  const home = readFileSync("src/pages/admin/index.astro", "utf8");
  assert.ok(!/TileHoraires/.test(home), "la tile Horaires e' tornata nella home");
  assert.ok(!/sched-status|sched-bands/.test(home), "sono rimasti i pezzi della tile Horaires");
  assert.ok(!/\{ key: "settings"/.test(home), "la tile Horaires e' ancora nel layout di default");
  assert.match(home, /getElementById\("j-stato"\)/, "la fascia non dice piu' se oggi e' aperto");
});
