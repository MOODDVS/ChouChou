/**
 * LA COLONNA «RECETTES» — quanto e' entrato, quanto e' tornato indietro, e
 * cosa l'ha portato.
 *
 * ⚠️ IL GUASTO CHE QUESTE PROVE TENGONO CHIUSO. I rimborsi venivano
 * SOTTRATTI e poi dimenticati: il totale era giusto, ma una serata da 1000 €
 * con 300 € resi si leggeva identica a una da 700 € pulita — e sono due
 * serate diverse, la prima ha avuto tre clienti scontenti. Qui si prova che
 * i resi hanno un numero loro, che il grafico li tiene dentro il riquadro, e
 * che la percentuale di reso non si calcola sul netto (dove 100 incassati e
 * 100 resi farebbero una divisione per zero).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  PERIODI_R, PERIODO_R_DEFAULT, periodoValidoR, istogrammaSoldi, quotaResi, articoli,
} from "../src/lib/admin/recetteRegole.ts";

const punti = (n, cents = 1000, rb = 0) =>
  Array.from({ length: n }, (_, i) => ({ label: String(i + 1), count: 2, cents, refund_cents: rb }));

test("il periodo: quelli che l'API conosce, e il ripiego al mese", () => {
  // ⚠️ Gli stessi nomi del server (`/api/admin/stats?period=`): tradurne i
  // giorni in finestre qui vorrebbe dire due calendari, e il secondo senza il
  // fuso del locale.
  assert.deepEqual([...PERIODI_R], ["day", "week", "month", "ytd"]);
  assert.equal(periodoValidoR("week"), "week");
  assert.equal(periodoValidoR("all"), PERIODO_R_DEFAULT, "«all» non e' della colonna: trimestri in una colonna stretta");
  assert.equal(periodoValidoR(null), PERIODO_R_DEFAULT);
  assert.equal(periodoValidoR("7"), PERIODO_R_DEFAULT);
});

test("il soffitto del grafico guarda ANCHE i resi", () => {
  // ⚠️ Un rimborso puo' essere piu' grande dell'incasso del suo giorno: si
  // rimborsa un ordine pagato la settimana prima. Col soffitto sui soli
  // incassi, quella barra uscirebbe dal riquadro.
  const g = istogrammaSoldi([
    { label: "1", count: 3, cents: 5000, refund_cents: 0 },
    { label: "2", count: 0, cents: 0, refund_cents: 9000 },
  ]);
  assert.equal(g.cima, 9000, "il soffitto ignora il reso piu' alto dell'incasso");
  assert.equal(g.conResi, true);
  assert.equal(g.barre.length, 2);
  assert.equal(g.barre[1].inc, 0);
});

test("niente dati, niente grafico — e il soffitto non e' mai zero", () => {
  assert.equal(istogrammaSoldi([]), null);
  assert.equal(istogrammaSoldi(null), null);
  const zero = istogrammaSoldi(punti(5, 0, 0));
  assert.equal(zero.cima, 1, "con tutto a zero le barre sarebbero alte quanto il riquadro");
  assert.equal(zero.conResi, false, "nessun reso: il secondo colore non va nominato");
});

test("i numeri storti non entrano nel grafico", () => {
  // Centesimi negativi o non numerici: un'altezza negativa e' una barra che
  // cresce verso il basso, NaN e' una barra che sparisce senza dire niente.
  const g = istogrammaSoldi([
    { label: "a", cents: -500, refund_cents: "x" },
    { label: "b", cents: "1200", refund_cents: null },
  ]);
  assert.equal(g.barre[0].inc, 0);
  assert.equal(g.barre[0].rb, 0);
  assert.equal(g.barre[1].inc, 1200, "una stringa numerica e' comunque un numero");
});

test("troppi intervalli: si tengono gli ULTIMI", () => {
  const g = istogrammaSoldi(punti(50), 32);
  assert.equal(g.barre.length, 32);
  assert.equal(g.barre[g.barre.length - 1].label, "50", "l'ultimo intervallo e' quello che si guarda");
  assert.equal(g.barre[0].label, "19");
});

test("la percentuale di reso si calcola sul LORDO", () => {
  // ⚠️ 100 incassati e 100 resi: il netto e' zero, e «resi / netto» sarebbe una
  // divisione per zero o un numero infinito. Sul lordo fa 50 %, che e' quello
  // che e' successo.
  assert.equal(quotaResi(0, 10000), 100);
  assert.equal(quotaResi(10000, 10000), 50);
  assert.equal(quotaResi(9000, 1000), 10);
  assert.equal(quotaResi(10000, 0), 0);
  // Niente entrato e niente uscito non e' «zero per cento»: e' un periodo vuoto.
  assert.equal(quotaResi(0, 0), null);
  assert.equal(quotaResi(null, undefined), null);
});

test("gli articoli: per quantita', e senza righe fantasma", () => {
  const top = [
    { name: "Diavola", qty: 41, cents: 59450 },
    { name: "Margherita", qty: 64, cents: 76800 },
    { name: "  ", qty: 9, cents: 900 },
    { name: "Fantasma", qty: 0, cents: 0 },
    { name: " Calzone ", qty: 28, cents: 42000 },
  ];
  const a = articoli(top, 6);
  assert.deepEqual(a.map((x) => x.name), ["Margherita", "Diavola", "Calzone"],
    "ordine per quantita', nomi ripuliti, righe vuote e a zero buttate");
  assert.equal(a[0].qty, 64);
  // ⚠️ Per QUANTITA' e non per incasso: altrimenti la classifica si riempie dei
  // piatti cari ordinati due volte, e non dice piu' cosa esce dalla cucina.
  const caro = articoli([
    { name: "Menu degustazione", qty: 2, cents: 30000 },
    { name: "Caffe'", qty: 80, cents: 16000 },
  ]);
  assert.equal(caro[0].name, "Caffe'");
  assert.equal(articoli(null).length, 0);
  assert.equal(articoli([{ name: "x", qty: 3, cents: 10 }], 0).length, 1, "mai una classifica di zero righe");
});

/* ---------- le guardie sul codice ---------- */

const HOME = readFileSync(new URL("../src/pages/admin/index.astro", import.meta.url), "utf8");
const STATS = readFileSync(new URL("../src/lib/admin/calcolaStats.ts", import.meta.url), "utf8");

test("guardia · i soldi si contano in UN posto solo", () => {
  // ⚠️ La colonna non somma centesimi: li chiede gia' sommati a `calcolaStats`,
  // che e' la stessa funzione della pagina Statistiques e usa `ordiniConti`.
  // Quattro copie della parola «incassato» ci sono gia' costate quattro
  // numeri diversi sullo stesso schermo.
  assert.match(STATS, /import \{[^}]*\brimborsato\b[^}]*\} from "\.\/ordiniConti/,
    "calcolaStats si e' scritto il suo conto dei rimborsi invece di usare la regola");
  assert.match(STATS, /refunded_cents:\s*resi/, "i resi non escono piu' dall'API: tornano sottratti e dimenticati");
  assert.match(STATS, /prev:/, "senza il periodo di prima, i numeri della colonna non si possono leggere");
  assert.doesNotMatch(HOME, /j-rec[\s\S]{0,2000}?total_cents/,
    "la colonna delle recettes si ricalcola i soldi dai totali grezzi");
});

test("guardia · il grafico e l'asse sono quelli della fascia", () => {
  assert.match(HOME, /recetteRegole/, "la colonna importa le sue regole");
  assert.ok(/istogrammaSoldi\(/.test(HOME), "le barre vengono dalla regola");
  assert.ok(!/function istogrammaRec|function barraRec/.test(HOME), "nessun secondo righello");
  const FASCIA = readFileSync(new URL("../src/components/admin/home/Giornata.astro", import.meta.url), "utf8");
  assert.match(FASCIA, /class="j-box j-rec-box"/, "il grafico delle recettes non e' nella scatola condivisa");
  assert.match(FASCIA, /j-hm j-rec-hm serie2/, "il grafico non e' piu' quello a due serie: incassi e resi non si confrontano");
  // ⚠️ IL FATTURATO E' DELLA PAGINA STATISTIQUES, e questa colonna con lui:
  // chi non puo' aprire Statistiques non deve vederlo nemmeno sulla Accueil.
  // Due lucchetti, e tutti e due servono — il server non disegna la colonna
  // (`recettes`), e questo attributo la fa togliere ad AdminNav coi permessi
  // veri quando la pagina arriva al browser senza SSR. La prova che il
  // `fetch` non parta comunque sta in `tests/permessi.test.mjs`.
  assert.match(FASCIA, /id="j-rec"[^>]*data-admin-page="stats"/,
    "la colonna del fatturato non e' piu' legata alla pagina Statistiques");
  assert.match(FASCIA, /\{recettes && \(/,
    "la colonna del fatturato si disegna di nuovo a tutti, e poi si nasconde: nascosta, chiede lo stesso");
  // I soldi si scrivono con l'unica funzione che sa farlo (`soldi.ts`): il
  // «€» scritto a mano aveva gia' prodotto cinque formati diversi.
  assert.doesNotMatch(HOME, /j-rec-tot[^;]{0,200}toFixed\(2\)/,
    "il totale delle recettes si formatta a mano invece di passare da `euroDa`");
});
