/**
 * DALLE RIGHE AI COMANDI — le prove di cio' che e' stato misurato sulla carta.
 *
 * ⚠️ Ogni numero qui dentro viene da una stampa vera del 05/10/2026, non da un
 * ragionamento: 48 colonne contate sul foglio, UTF-8 che esce giusto, le
 * tabelle di caratteri che escono sbagliate. Un ticket che esce storto non fa
 * rumore — nessun errore a schermo, solo una comanda illeggibile in cucina.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { componi, componiTesto, anteprima, impagina, aCapo, due, linea, COLONNE } from "../src/lib/escpos.ts";
import { ticketCucina } from "../src/lib/stampaRegole.ts";

const ORDINE = {
  numero: "4F2A", ora: "19:45", cliente: "Marco Rossi", telefono: "0472 11 22 33",
  note: "Je passe avec 10 min de retard", daIncassare: true,
  piatti: [
    { qty: 2, nome: "Pizza Margherita", variante: "33 cm · sans gluten" },
    { qty: 1, nome: "Tagliatelle alla bolognese con ragù di manzo", nota: "sans ail" },
    { qty: 3, nome: "Eau pétillante 50 cl" },
  ],
};

test("la carta e' larga 48 colonne, e nessuna riga le sfonda", () => {
  // ⚠️ Misurato sul foglio: la riga di 48 caratteri esce intera e non va a
  // capo. Quello che sfonda non va a capo da solo: lo TAGLIA la stampante, e
  // sparisce senza dirlo. «50 cl» mancante e' una bibita che non si prepara.
  assert.equal(COLONNE, 48);
  for (const r of impagina(ticketCucina(ORDINE))) {
    const max = r.taglia === "gigante" ? 24 : r.taglia === "piccolo" ? 64 : 48;
    assert.ok(r.testo.length <= max, `riga oltre il bordo (${r.taglia}, ${max}): ${r.testo}`);
  }
});

test("la doppia larghezza conta 24 colonne, non 48", () => {
  // ⚠️ `gigante` non e' «grande di piu'»: ogni carattere ne occupa due. Chi
  // spezza il testo e chi lo stampa devono contare allo stesso modo, se no i
  // nomi lunghi escono tagliati invece che andare a capo — e si scopre sul
  // piatto col nome piu' lungo del menu, settimane dopo.
  const righe = aCapo("Tagliatelle alla bolognese", 24, 3);
  assert.ok(righe.length > 1, "a 24 colonne questo nome deve andare a capo");
  for (const r of righe) assert.ok(r.length <= 24, r);
});

test("il rientro delle note non si perde andando a capo", () => {
  // ⚠️ IL GUASTO (05/10/2026, visto nell'anteprima prima che in cucina): le
  // righe di servizio arrivano scritte come «   33 cm», e la spezzatura sugli
  // spazi mangiava i tre davanti. «sans ail» finiva incolonnato coi piatti e
  // sembrava un piatto in piu'. E' esattamente il difetto che il rientro
  // esisteva per evitare, nato dal rientro stesso.
  const righe = impagina(ticketCucina(ORDINE));
  const nota = righe.find((r) => r.testo.includes("sans ail"));
  assert.ok(nota, "la nota del piatto e' sparita");
  assert.ok(nota.testo.startsWith("   "), `la nota ha perso il rientro: «${nota.testo}»`);
  const variante = righe.find((r) => r.testo.includes("33 cm"));
  assert.ok(variante.testo.startsWith("   "), `la variante ha perso il rientro: «${variante.testo}»`);
});

test("si scrive in UTF-8, e non si sceglie nessuna tabella di caratteri", () => {
  // ⚠️ Provato su carta: le quattro tabelle della stampante (cp437, cp850,
  // cp858, cp1252) escono TUTTE sbagliate; l'UTF-8 senza `ESC t` esce
  // perfetto, euro compreso. In mezzo c'e' un'app che legge il file come
  // testo: darle byte che UTF-8 non sono vuol dire farseli rovinare prima
  // della testina.
  const byte = componi([{ testo: "crème brûlée 24,50 €" }]);
  for (let i = 0; i < byte.length - 1; i++) {
    assert.ok(!(byte[i] === 0x1b && byte[i + 1] === 0x74), "e' tornato un ESC t: gli accenti usciranno sbagliati");
  }
  const dentro = new TextDecoder().decode(byte);
  assert.ok(dentro.includes("crème brûlée 24,50 €"), "il testo accentato non e' passato in UTF-8");
});

test("la fascia in negativo arriva ai due bordi", () => {
  // ⚠️ Il nero lo fa la carta bruciata sotto i caratteri. Senza riempire la
  // riga di spazi resta un rettangolino intorno alle lettere, e «DA
  // INCASSARE» smette di essere la fascia che si vede attraversando la cucina
  // — cioe' smette di fare l'unica cosa per cui esiste.
  const righe = impagina(ticketCucina(ORDINE));
  const fascia = righe.find((r) => r.inverso);
  assert.ok(fascia, "la fascia «DA INCASSARE» non c'e' piu'");
  const byte = componi(ticketCucina(ORDINE));
  const testo = new TextDecoder().decode(byte);
  const riga = testo.split("\n").find((l) => l.includes("DA INCASSARE"));
  assert.ok(riga.replace(/[\x00-\x1f]/g, "").length >= 48, `la fascia non arriva al bordo: «${riga}»`);
});

test("il ticket finisce col taglio, dopo l'avanzamento", () => {
  // Senza taglio il ticket resta attaccato al prossimo, e in cucina arrivano
  // due ordini su un nastro solo. L'avanzamento serve perche' la lama sta
  // qualche millimetro sopra la testina: senza, taglia dentro l'ultima riga.
  const byte = componi([{ testo: "x" }]);
  const coda = [...byte.slice(-4)];
  assert.deepEqual(coda, [0x1d, 0x56, 0x42, 0x00], "manca il comando di taglio in fondo");
  assert.ok(new TextDecoder().decode(byte).endsWith("\n\n\n" + "\x1d\x56\x42\x00"), "manca l'avanzamento prima della lama");
});

test("l'anteprima e la stampa impaginano allo stesso modo", () => {
  // ⚠️ Un'anteprima che spezza il testo per conto suo mostra un ticket che
  // non e' quello che esce: peggio di nessuna anteprima, perche' ci si fida.
  const righe = ticketCucina(ORDINE);
  assert.equal(anteprima(righe).split("\n").length, impagina(righe).length);
});

test("nelle righe a due colonne cede l'etichetta, mai l'importo", () => {
  // Stessa regola delle barre nelle card: l'importo e' il numero che qualcuno
  // deve chiedere al cliente, e non puo' essere quello che si accorcia.
  const r = due("Una etichetta lunghissima che non ci sta in nessun modo", "24,50 €");
  assert.equal(r.length, COLONNE);
  assert.ok(r.endsWith("24,50 €"), "l'importo e' stato troncato");
  assert.equal(linea("-").length, COLONNE);
});

test("il ticket come testo e' identico al ticket come byte", () => {
  // ⚠️ Sul filo viaggia TESTO: il servizio di stampa legge il corpo della
  // risposta come tale, ed e' per questo che l'UTF-8 passa e le tabelle di
  // caratteri no. Funziona perche' ogni comando ESC/POS sta sotto 128. Il
  // giorno che se ne aggiungesse uno fuori da UTF-8, i byte e il testo
  // smetterebbero di coincidere: si scopre qui, non su un ticket illeggibile.
  const righe = ticketCucina(ORDINE);
  const byte = componi(righe);
  const testo = componiTesto(righe);
  assert.deepEqual([...new TextEncoder().encode(testo)], [...byte], "testo e byte non coincidono piu'");
});
