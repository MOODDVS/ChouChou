/**
 * LA COLONNA «VISIBILITÉ» — chi ci cerca su Google, e se stiamo salendo.
 *
 * ⚠️ DUE NUMERI CHE SI LEGGONO AL CONTRARIO, ed e' per loro che questo file
 * esiste:
 *   - LA POSIZIONE: in classifica scendere di numero e' SALIRE. Da 14,2 a 9,8
 *     e' una buona notizia, e con la freccia in giu' si legge come un crollo.
 *     E' il numero piu' frainteso di Search Console.
 *   - LA VARIAZIONE DA ZERO: da zero non esiste un aumento percentuale — da
 *     una visita a due si sale del cento per cento come da mille a duemila.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  PERIODI, periodoValido, istogramma, etichetteAsse, andamento, andamentoPosizione, scarto,
} from "../src/lib/admin/visibilitaRegole.ts";

const giorni = (n, da = "2026-09-11") => {
  const out = [];
  const t = Date.parse(da + "T12:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push({
      date: new Date(t + i * 86400000).toISOString().slice(0, 10),
      clicks: i + 1,
      impressions: (i + 1) * 20,
    });
  }
  return out;
};

test("il periodo: quelli che l'API conosce, e il ripiego a 28", () => {
  assert.deepEqual([...PERIODI], [7, 28, 90]);
  assert.equal(periodoValido(7), 7);
  assert.equal(periodoValido(90), 90);
  // ⚠️ Un numero che l'API non conosce tornerebbe comunque 28 giorni di dati
  // sotto una pastiglia accesa che dice «90 g»: si sceglie qui, una volta.
  assert.equal(periodoValido(45), 28);
  assert.equal(periodoValido("tanti"), 28);
  assert.equal(periodoValido(null), 28);
});

test("fino a trenta giornate il grafico e' giorno per giorno", () => {
  const h = istogramma(giorni(28));
  assert.equal(h.passo, "giorno");
  assert.equal(h.barre.length, 28);
  assert.equal(h.cima, 28, "la giornata piu' alta");
  assert.equal(h.da, "2026-09-11");
  assert.equal(h.a, "2026-10-08");
});

test("a novanta giorni si raggruppa per settimane, e si parte dalla FINE", () => {
  /* ⚠️ Novanta barre in una colonna larga trecento pixel sono novanta righe da
     tre pixel: non e' un grafico, e' una texture. */
  const h = istogramma(giorni(90));
  assert.equal(h.passo, "settimana");
  assert.equal(h.barre.length, 13, "12 settimane piene + il resto in testa");
  /* ⚠️ Il resto della divisione va in TESTA, non in coda: raggruppando
     dall'inizio, l'ultima barra — quella che si guarda — sarebbe stata monca e
     avrebbe disegnato un crollo che non c'e'. */
  assert.equal(h.barre[0].giorni, 6, "la prima barra e' quella spaiata");
  assert.equal(h.barre.at(-1).giorni, 7);
  assert.equal(h.barre.at(-1).iso, "2026-12-03", "l'ultima settimana finisce sull'ultimo giorno mandato");
  // L'ultima settimana e' la somma dei suoi sette giorni (84…90).
  assert.equal(h.barre.at(-1).valore, 84 + 85 + 86 + 87 + 88 + 89 + 90);
});

test("il grafico non esiste senza dati, e il soffitto non e' mai zero", () => {
  assert.equal(istogramma([]), null);
  assert.equal(istogramma(null), null);
  // Righe senza data (o con una data rotta) non diventano barre.
  assert.equal(istogramma([{ date: "quando", clicks: 5 }]), null);
  // ⚠️ Tutto a zero: il soffitto resta 1, altrimenti `altezza()` dividerebbe
  // per zero e le barre sarebbero tutte alte quanto il riquadro.
  const h = istogramma([{ date: "2026-10-01", clicks: 0 }, { date: "2026-10-02", clicks: 0 }]);
  assert.equal(h.cima, 1);
  assert.deepEqual(h.barre.map((b) => b.valore), [0, 0]);
});

test("clic e impressioni: di piu' e' meglio, e da zero non si dice niente", () => {
  assert.deepEqual(andamento(412, 350), { diff: 18, meglio: true });
  assert.deepEqual(andamento(300, 350), { diff: -14, meglio: false });
  // ⚠️ Da zero non esiste un aumento percentuale: la colonna scrive un
  // trattino invece di «+100 %».
  assert.deepEqual(andamento(12, 0), { diff: null, meglio: false });
  assert.equal(scarto(12, 0), null);
  assert.equal(scarto(120, 100), 20);
});

test("la posizione: scendere di numero e' salire, e si dice in POSTI", () => {
  /* ⚠️ «+18 %» su una posizione media non vuol dire niente a nessuno: quello
     che si e' guadagnato sono 1,8 posti. */
  const su = andamentoPosizione(12.4, 14.2);
  assert.equal(su.posti, 1.8);
  assert.equal(su.meglio, true, "da 14,2 a 12,4 si e' SALITI");
  const giu = andamentoPosizione(15, 12);
  assert.equal(giu.posti, -3);
  assert.equal(giu.meglio, false);
  // Senza un periodo prima (o con una posizione a zero, che vuol dire «mai
  // comparsi») non si dice niente.
  assert.equal(andamentoPosizione(12, 0).posti, null);
  assert.equal(andamentoPosizione(0, 12).posti, null);
});

test("le date sotto il grafico: poche, leggibili, e l'ultima c'e' sempre", () => {
  // ⚠️ L'ULTIMA BARRA DEVE AVERE LA SUA DATA. E' quella che si guarda per
  // prima, e Google ha tre giorni di ritardo: senza la data sotto, chi guarda
  // crede che l'ultima barra sia oggi. Contando dall'inizio restava muta ogni
  // volta che le barre non erano un multiplo del passo.
  for (const n of [5, 7, 13, 28, 30, 90]) {
    const e = etichetteAsse(n);
    assert.equal(e[e.length - 1], n - 1, `con ${n} barre l'ultima resta senza data`);
    assert.equal(e[0], 0, `con ${n} barre la prima resta senza data`);
    assert.ok(e.length <= 5, `con ${n} barre escono ${e.length} date: si sovrappongono`);
    assert.deepEqual([...e].sort((a, b) => a - b), e, "gli indici non sono in ordine");
    assert.equal(new Set(e).size, e.length, "stesso indice due volte");
  }
  // Poche barre: le porta tutte, non c'e' niente da diradare.
  assert.deepEqual(etichetteAsse(3), [0, 1, 2]);
  assert.deepEqual(etichetteAsse(0), []);
  assert.deepEqual(etichetteAsse(-5), []);
  // ⚠️ Quante ne vuole chi chiama, ma mai meno di due: con una sola il
  // grafico tornerebbe senza inizio o senza fine.
  assert.equal(etichetteAsse(28, 1).length, 2);
  // Le date non si accavallano: fra due etichette c'e' sempre aria.
  const e28 = etichetteAsse(28);
  for (let i = 1; i < e28.length; i++) {
    assert.ok(e28[i] - e28[i - 1] >= 3, `due date a ${e28[i] - e28[i - 1]} barre di distanza si toccano`);
  }
});

/* ---------- la guardia sul codice ---------- */

const HOME = readFileSync(new URL("../src/pages/admin/index.astro", import.meta.url), "utf8");

test("guardia · il grafico riusa il righello dell'affluenza", () => {
  // ⚠️ `altezza()` e `.j-hm-plot` sono gia' quelli della fascia dell'affluenza:
  // un secondo modo di disegnare una barra vorrebbe dire due grafici nella
  // stessa pagina con due righelli diversi.
  assert.ok(/visibilitaRegole/.test(HOME), "la colonna importa le sue regole");
  assert.ok(/id="j-vis-plot"[\s\S]{0,4000}altezza\(/.test(HOME) || /altezza\(b\.valore/.test(HOME),
    "le barre vengono da `altezza()`");
  assert.ok(!/function altezzaVis|function barraVis/.test(HOME), "nessun secondo righello");
});

test("guardia · il grafico sta in una scatola, e sotto dice di che passo e' e fin dove arriva", () => {
  // ⚠️ Un istogramma da solo non puo' dire tre cose, e sono tre cose che
  // cambiano la lettura: di che colore sono le barre, se una barra e' un
  // giorno o una SETTIMANA (a 90 giorni si raggruppa: senza scritto, la fila
  // piu' bassa sembra un crollo invece che sette giorni contati insieme) e
  // fino a quando arrivano i dati — Google ha circa tre giorni di ritardo,
  // quindi l'ultima barra non e' oggi.
  const FASCIA = readFileSync(new URL("../src/components/admin/home/Giornata.astro", import.meta.url), "utf8");
  assert.match(FASCIA, /class="j-box j-vis-box"/,
    "il grafico della visibilita' e' uscito dalla scatola condivisa: due grafici nella stessa fascia con due vestiti");
  for (const id of ["j-vis-passo", "j-vis-src"]) {
    assert.ok(FASCIA.includes(`id="${id}"`), `manca ${id}: il piede del grafico torna muto`);
    assert.ok(HOME.includes(`"${id}"`), `nessuno riempie ${id}`);
  }
  // ⚠️ La larghezza delle barre con UNA serie sola (`serie1`) sta sul
  // grafico e nel markup. Aggiunta dal codice che disegna, e' finita sulla
  // scatola il giorno in cui il grafico e' entrato in una scatola: la regola
  // e' `.j-hm.serie1 .j-hb span`, quindi dalla scatola non arriva alle barre,
  // e le barre si stirano senza che niente sia rosso.
  assert.match(FASCIA, /class="j-hm j-vis-hm serie1"/,
    "la classe `serie1` non e' piu' sul grafico: le barre della visibilita' perdono la loro larghezza");
  assert.doesNotMatch(HOME, /classList\.add\("serie1"\)/,
    "`serie1` torna aggiunta a mano dal codice: e' una cosa che non cambia mai, e si attacca all'elemento sbagliato");
  // Le date sull'asse vengono dalla regola, non da due estremi scritti a mano.
  assert.match(HOME, /etichetteAsse\(/,
    "le date sotto il grafico non passano piu' dalla regola: tornano due sole, e in mezzo non si sa piu' quando");
});
