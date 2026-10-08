/**
 * LE NOTE CHE TORNANO — «ogni lunedi' alle 9», «ogni 31».
 *
 * Una ricorrenza sbagliata non da' nessun errore: da' una nota che torna il
 * giorno dopo quello giusto, o che non torna affatto, e nessuno collega le due
 * cose. Per questo la regola e' pura (`src/lib/admin/ricorrenzaRegole.ts`) e si
 * guarda qui, con le date scritte a mano.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { DateTime } from "luxon";
import { prossima, leggiRicorrenza, descrivi } from "../src/lib/admin/ricorrenzaRegole.ts";

const TZ = "Europe/Brussels";
const q = (iso) => DateTime.fromISO(iso, { zone: TZ }).toFormat("yyyy-LL-dd HH:mm");

test("ogni giorno: se l'ora di oggi e' passata, si va a domani", () => {
  assert.equal(q(prossima({ ogni: "giorno", ora: "09:00" }, "2026-03-10T07:30:00+01:00", TZ)), "2026-03-10 09:00");
  assert.equal(q(prossima({ ogni: "giorno", ora: "09:00" }, "2026-03-10T11:00:00+01:00", TZ)), "2026-03-11 09:00");
});

test("spuntata nell'istante esatto della scadenza, la prossima e' la DOPO", () => {
  // ⚠️ Il caso che rompe tutto il resto: con «>=» invece di «>», spuntando
  // alle 9 in punto la nota tornerebbe da fare allo stesso istante — si
  // riaccenderebbe sotto il dito di chi l'ha appena chiusa.
  assert.equal(q(prossima({ ogni: "giorno", ora: "09:00" }, "2026-03-10T09:00:00+01:00", TZ)), "2026-03-11 09:00");
});

test("ogni settimana: lunedi' prossimo, non quello di oggi", () => {
  // 2026-03-10 e' un martedi'.
  assert.equal(q(prossima({ ogni: "settimana", ora: "08:00", dow: 1 }, "2026-03-10T10:00:00+01:00", TZ)), "2026-03-16 08:00");
  // Lo stesso lunedi', ma prima dell'ora: resta oggi.
  assert.equal(q(prossima({ ogni: "settimana", ora: "08:00", dow: 1 }, "2026-03-09T06:00:00+01:00", TZ)), "2026-03-09 08:00");
});

test("ogni mese il 31: nei mesi corti si appoggia all'ultimo giorno, non scivola al mese dopo", () => {
  // ⚠️ Quattro volte l'anno. Lasciando fare a luxon, `{ day: 31 }` su aprile
  // rende il 1° maggio: un giorno di ritardo che si presenta ad aprile,
  // giugno, settembre e novembre — e in febbraio tre.
  assert.equal(q(prossima({ ogni: "mese", ora: "10:00", dom: 31 }, "2026-03-31T12:00:00+02:00", TZ)), "2026-04-30 10:00");
  assert.equal(q(prossima({ ogni: "mese", ora: "10:00", dom: 31 }, "2026-01-31T12:00:00+01:00", TZ)), "2026-02-28 10:00");
});

test("ogni anno il 29 febbraio: negli anni normali e' il 28", () => {
  assert.equal(q(prossima({ ogni: "anno", ora: "09:00", mese: 2, dom: 29 }, "2026-06-01T09:00:00+02:00", TZ)), "2027-02-28 09:00");
});

test("ogni anno: se la data di quest'anno e' passata, si va al prossimo", () => {
  assert.equal(q(prossima({ ogni: "anno", ora: "09:00", mese: 9, dom: 1 }, "2026-10-01T09:00:00+02:00", TZ)), "2027-09-01 09:00");
  assert.equal(q(prossima({ ogni: "anno", ora: "09:00", mese: 9, dom: 1 }, "2026-01-05T09:00:00+01:00", TZ)), "2026-09-01 09:00");
});

test("l'ora cambia col fuso del LOCALE, non con quello del server", () => {
  // Stesso istante, due locali: «ogni giorno alle 9» vuol dire le 9 LI'.
  const istante = "2026-03-10T07:30:00Z";
  assert.equal(q(prossima({ ogni: "giorno", ora: "09:00" }, istante, TZ)), "2026-03-10 09:00");
  const roma = prossima({ ogni: "giorno", ora: "09:00" }, istante, "Europe/Rome");
  assert.equal(DateTime.fromISO(roma, { zone: "Europe/Rome" }).toFormat("HH:mm"), "09:00");
});

test("una regola che non e' una regola viene rifiutata, non aggiustata", () => {
  // ⚠️ Arriva dal browser. Un `dom: 47` «aggiustato» diventerebbe una data nel
  // mese dopo: una nota che torna quando non deve, senza che nessuno abbia
  // scritto quel giorno.
  assert.equal(leggiRicorrenza({ ogni: "mese", ora: "09:00", dom: 47 }), null);
  assert.equal(leggiRicorrenza({ ogni: "settimana", ora: "09:00", dow: 0 }), null);
  assert.equal(leggiRicorrenza({ ogni: "sempre", ora: "09:00" }), null);
  assert.equal(leggiRicorrenza(null), null);
});

test("un'ora illeggibile diventa mezzogiorno, non mezzanotte", () => {
  // Mezzanotte vorrebbe dire che una nota «di oggi» nasce gia' in ritardo e si
  // colora di rosso appena scritta.
  assert.deepEqual(leggiRicorrenza({ ogni: "giorno", ora: "venticinque" }), { ogni: "giorno", ora: "12:00" });
  assert.deepEqual(leggiRicorrenza({ ogni: "giorno", ora: "25:00" }), { ogni: "giorno", ora: "12:00" });
});

test("la regola si legge in parole, e la frase e' UNA per il bigliettino e per l'email", () => {
  // ⚠️ L'email diceva «settimana · 09:00»: la regola mezza tradotta e mezza in
  // codice. Chi la riceve non deve interpretare niente.
  const t = (k) => ({
    "home.repDay": "chaque jour à {h}",
    "home.repWeek": "chaque {g} à {h}",
    "home.repMonth": "le {n} de chaque mois à {h}",
    "home.repYear": "le {n} {m} à {h}",
  })[k] ?? k;
  const giorno = (d) => ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][d - 1];
  const mese = (m) => ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][m - 1];
  const opz = { t, giorno, mese };

  assert.equal(descrivi({ ogni: "giorno", ora: "09:00" }, opz), "chaque jour à 09:00");
  assert.equal(descrivi({ ogni: "settimana", ora: "08:30", dow: 1 }, opz), "chaque lundi à 08:30");
  assert.equal(descrivi({ ogni: "mese", ora: "10:00", dom: 15 }, opz), "le 15 de chaque mois à 10:00");
  assert.equal(descrivi({ ogni: "anno", ora: "09:00", mese: 9, dom: 1 }, opz), "le 1 septembre à 09:00");

  // ⚠️ Niente regola, niente frase — e nessun «undefined» in mezzo a un'email.
  assert.equal(descrivi(null, opz), "");
  assert.equal(descrivi({ ogni: "sempre", ora: "09:00" }, opz), "");
});
