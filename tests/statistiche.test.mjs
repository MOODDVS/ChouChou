/**
 * STATISTICHE — separare bene, e sommare bene.
 *
 * ⚠️ E' l'unico posto del progetto dove un guasto NON HA SINTOMI. Un'email
 * che non parte, un ordine che resta in attesa, un cliente alla porta: tutte
 * cose che qualcuno nota. Un incasso sbagliato no. Si guarda il numero, si
 * prende una decisione, e il numero puo' essere storto da mesi — perche'
 * nessuno ricontrolla a mano quanto ha incassato martedi'.
 *
 * L'invariante che regge tutto: LE PARTI SOMMANO IL TUTTO. La ripartizione
 * per sede deve dare esattamente il totale scritto sopra. E' l'unica cosa
 * che un umano verifica a colpo d'occhio, quindi deve tornare sempre —
 * soprattutto quando i dati sono sporchi.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  ripartisciOrdini, ripartisciPrenotazioni, conNomi, STATI_ATTIVI,
} from "../src/lib/admin/statsRegole.ts";
import { CLASSIFICA } from "../src/lib/admin/sedeRegole.ts";

const S = "11111111-1111-1111-1111-111111111111"; // Stockel
const J = "22222222-2222-2222-2222-222222222222"; // Jourdan
const o = (location_id, total_cents) => ({ location_id, total_cents });
const r = (location_id, people, status = "confirmed") => ({ location_id, people, status });

/* ============================================================
   FINANZE — le parti sommano il tutto
   ============================================================ */

test("ogni punto ha i suoi ordini e il suo incasso", () => {
  const q = ripartisciOrdini([o(S, 1000), o(S, 3000), o(J, 2000)]);
  const stockel = q.find((x) => x.id === S);
  const jourdan = q.find((x) => x.id === J);
  assert.deepEqual([stockel.orders, stockel.revenue_cents], [2, 4000]);
  assert.deepEqual([jourdan.orders, jourdan.revenue_cents], [1, 2000]);
});

test("⚠️ la somma delle quote e' esattamente il totale", () => {
  const ordini = [o(S, 1234), o(J, 5678), o(S, 91), o(null, 4000), o(J, 7)];
  const q = ripartisciOrdini(ordini);
  const totOrdini = ordini.length;
  const totIncasso = ordini.reduce((t, x) => t + x.total_cents, 0);
  assert.equal(q.reduce((t, x) => t + x.orders, 0), totOrdini);
  assert.equal(q.reduce((t, x) => t + x.revenue_cents, 0), totIncasso);
});

test("⚠️ una riga SENZA sede non si nasconde: diventa una quota a parte", () => {
  // Dopo il travaso dello storico non dovrebbero essercene. Se ne ricompaiono
  // vuol dire che una scrittura ha smesso di mettere `location_id`, ed e'
  // molto meglio vederlo qui che scoprirlo fra sei mesi da un totale che non
  // torna. Nascondere per far quadrare i conti e' il modo in cui i conti
  // smettono di voler dire qualcosa.
  const q = ripartisciOrdini([o(S, 1000), o(null, 500), o(undefined, 300)]);
  const senza = q.find((x) => x.id === null);
  assert.ok(senza, "le righe senza sede sono sparite dalla ripartizione");
  assert.equal(senza.revenue_cents, 800, "`null` e `undefined` devono finire nella stessa quota");
  assert.equal(q.reduce((t, x) => t + x.revenue_cents, 0), 1800);
});

test("⚠️ la media del GRUPPO non e' la media delle medie", () => {
  // Stockel: 1 ordine da 100 €. Jourdan: 3 ordini da 10 € = 30 €.
  // Media pesata (giusta): 130 € / 4 = 32,50 €.
  // Media delle medie (sbagliata): (100 + 10) / 2 = 55 €.
  // La seconda e' sbagliata in modo del tutto credibile: e' un numero
  // plausibile, e non torna con niente che si possa controllare.
  const ordini = [o(S, 10000), o(J, 1000), o(J, 1000), o(J, 1000)];
  const q = ripartisciOrdini(ordini);
  const mediaDelleMedie = Math.round(q.reduce((t, x) => t + x.avg_cents, 0) / q.length);
  const pesata = Math.round(
    ordini.reduce((t, x) => t + x.total_cents, 0) / ordini.length,
  );
  assert.equal(pesata, 3250);
  assert.equal(mediaDelleMedie, 5500);
  assert.notEqual(pesata, mediaDelleMedie, "il caso di prova non distingue le due formule");
});

test("la media di OGNI punto e' la sua, e si arrotonda al centesimo", () => {
  const q = ripartisciOrdini([o(S, 1000), o(S, 1001)]);
  assert.equal(q[0].avg_cents, 1001); // 2001 / 2 = 1000,5 -> 1001
});

test("le quote sono ordinate per incasso, dalla piu' grande", () => {
  const q = ripartisciOrdini([o(S, 100), o(J, 9000), o(null, 500)]);
  assert.deepEqual(q.map((x) => x.revenue_cents), [9000, 500, 100]);
});

test("nessun ordine: nessuna quota, e nessuna divisione per zero", () => {
  assert.deepEqual(ripartisciOrdini([]), []);
});

/* ============================================================
   PRENOTAZIONI — stesso invariante, base diversa
   ============================================================ */

test("prenotazioni e coperti per punto", () => {
  const q = ripartisciPrenotazioni([r(S, 2), r(S, 4), r(J, 6)]);
  assert.deepEqual(q.find((x) => x.id === S), { id: S, pren: 2, coperti: 6 });
  assert.deepEqual(q.find((x) => x.id === J), { id: J, pren: 1, coperti: 6 });
});

test("⚠️ un annullamento non e' una prenotazione, qui come nel totale", () => {
  // ⚠️ Se la ripartizione contasse gli annullamenti e il totale no, la somma
  // delle quote supererebbe il numero grande scritto sopra. Chi guarda vede
  // due numeri che non tornano e non ha modo di sapere quale credere.
  const q = ripartisciPrenotazioni([
    r(S, 2, "confirmed"),
    r(S, 4, "cancelled"),
    r(S, 2, "pending"),
    r(J, 6, "noshow"),
  ]);
  assert.equal(q.find((x) => x.id === S).pren, 1, "l'annullata o la richiesta sono state contate");
  assert.equal(q.find((x) => x.id === J).pren, 1, "un no-show resta una prenotazione");
});

test("gli stati che contano sono UN elenco solo", () => {
  // ⚠️ Due elenchi vorrebbero dire due verita' sullo stesso fatto. Questo e'
  // quello condiviso fra il totale e la ripartizione.
  assert.deepEqual([...STATI_ATTIVI].sort(), ["confirmed", "done", "noshow", "seated"]);
  const src = readFileSync("src/lib/admin/statsResa.ts", "utf8");
  assert.match(src, /const ATTIVI = new Set\(STATI_ATTIVI\);/,
    "statsResa si e' rifatto il suo elenco di stati");
});

test("coperti mancanti o storti non fanno NaN", () => {
  // ⚠️ Un `NaN` in una somma contagia tutto il totale, e a schermo diventa
  // «—» oppure «NaN €»: il numero sparisce senza dire perche'.
  const q = ripartisciPrenotazioni([
    r(S, null), r(S, undefined), r(S, "3"), r(S, 2),
  ]);
  assert.equal(q[0].pren, 4);
  assert.equal(q[0].coperti, 5);
  assert.ok(Number.isFinite(q[0].coperti));
});

test("le quote prenotazioni sono ordinate per numero di prenotazioni", () => {
  const q = ripartisciPrenotazioni([r(S, 2), r(J, 2), r(J, 2), r(J, 2)]);
  assert.deepEqual(q.map((x) => x.pren), [3, 1]);
});

/* ============================================================
   I NOMI
   ============================================================ */

test("il nome arriva dall'elenco sedi; «senza sede» resta vuoto", () => {
  // L'etichetta di «senza sede» la mette l'interfaccia, che sa in che lingua
  // sta parlando: qui si lascia vuoto invece di scrivere una parola francese
  // dentro una libreria.
  const con = conNomi(
    [{ id: S }, { id: null }, { id: "sparita" }],
    new Map([[S, "450 Gradi Stockel"]]),
  );
  assert.deepEqual(con.map((x) => x.nome), ["450 Gradi Stockel", "", ""]);
});

/* ============================================================
   LE RETI — dove l'aggregato puo' e non puo' arrivare
   ============================================================ */

test("l'aggregato si chiede SOLO nei due tab dove ha senso", () => {
  // ⚠️ Deciso a settembre: «tutte le sedi» sta in Finanze e Prenotazioni, e
  // basta. Gli altri tab (Google, traffico, Search Console) o sono gia' del
  // marchio o non hanno un aggregato che voglia dire qualcosa.
  const pagina = readFileSync("src/pages/admin/stats.astro", "utf8");
  const conAggregato = [...pagina.matchAll(/fetch\("(\/api\/[^"?]+)[^)]*\{ headers: hdr\(\) \}/g)]
    .map((m) => m[1]).sort();
  assert.deepEqual(conAggregato, ["/api/admin/stats", "/api/admin/stats-reservations"]);
});

test("⚠️ l'aggregato non si ricorda: viaggia nell'header, mai nel cookie", () => {
  // E' un modo di GUARDARE, non un posto dove si lavora. Ricordandolo, si
  // riaprirebbe l'admin domani dentro una vista in cui meta' delle cose non
  // si possono creare — e basterebbe un cookie vecchio per restarci
  // incastrati senza capire perche'.
  const pagina = readFileSync("src/pages/admin/stats.astro", "utf8");
  assert.match(pagina, /"x-sede": "tutte"/);
  assert.equal(/document\.cookie[^\n]*tutte/.test(pagina), false,
    "l'aggregato e' finito nel cookie");

  // E il server lo ignora comunque, se arriva dal cookie.
  const sede = readFileSync("src/lib/admin/sede.ts", "utf8");
  assert.match(sede, /return v === CHIESTA_TUTTE \? null : v;/,
    "il cookie con «tutte» non viene piu' ignorato");
});

test("dall'aggregato non si scrive niente, nemmeno nelle statistiche", () => {
  // Le pagine di statistica leggono e basta, ma la difesa vera sta piu' in
  // basso: `sedeDaScrivere` lancia. Qui si controlla che nessuno abbia
  // aggiunto una scrittura a questa pagina.
  const api = readFileSync("src/pages/api/admin/stats.ts", "utf8");
  for (const scrittura of ["inserisci(", "aggiorna(", "cancella(", "salva("]) {
    assert.equal(api.includes(scrittura), false, `stats.ts scrive: ${scrittura}`);
  }
});

test("le visite del sito NON si dividono per sede: il sito e' uno", () => {
  // ⚠️ `page_views` e' del marchio. Dividerlo sarebbe inventare: non c'e'
  // nessun modo di sapere per quale pizzeria qualcuno ha guardato la
  // homepage. E mescolare i due piani sarebbe peggio — un «tasso di
  // conversione» fatto con gli ordini di un punto e le visite del gruppo
  // darebbe a ogni sede un numero pessimo, e i tre non sommerebbero a niente.
  assert.equal(CLASSIFICA.page_views, "marchio");
  const pagina = readFileSync("src/pages/admin/stats.astro", "utf8");
  assert.match(pagina, /fetch\("\/api\/admin\/traffic\?days=" \+ gDays, \{ headers \}\)/,
    "il traffico ha cominciato a chiedere l'aggregato, che li' non vuol dire niente");
});

test("la ripartizione esiste in UN posto solo", () => {
  for (const f of ["src/lib/admin/calcolaStats.ts", "src/lib/admin/statsResa.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.equal(/new Map<string \| null,/.test(src), false,
      `${f}: si e' rifatto la sua ripartizione invece di usare statsRegole`);
  }
  assert.match(readFileSync("src/lib/admin/calcolaStats.ts", "utf8"), /ripartisciOrdini\(/);
  assert.match(readFileSync("src/lib/admin/statsResa.ts", "utf8"), /ripartisciPrenotazioni\(/);
});

test("la ripartizione si calcola SOLO quando si guarda il gruppo", () => {
  // Dentro un punto non serve — c'e' una quota sola, che e' il totale — e
  // calcolarla vorrebbe dire leggere `location_id` per niente.
  for (const f of ["src/lib/admin/calcolaStats.ts", "src/lib/admin/statsResa.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /ambito\.modo === "tutte" \? \{ perSede: await ripartisci/,
      `${f}: la ripartizione non e' legata all'aggregato`);
    // E la colonna si chiede solo allora.
    assert.match(src, /ambito\.modo === "tutte" \? ", location_id" : ""/,
      `${f}: `);
  }
});
