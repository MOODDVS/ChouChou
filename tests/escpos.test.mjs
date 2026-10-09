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
import { componi, componiTesto, anteprima, impagina, aCapo, due, linea, colonneDi, COLONNE } from "../src/lib/escpos.ts";
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
  // ⚠️ Il limite si CHIEDE a `escpos.ts`, non si riscrive qui. Scritto a mano
  // («gigante ? 24 : piccolo ? 64 : 48»), al primo taglia nuova questa prova
  // l'avrebbe misurata con 48 colonne: verde, e il caso nuovo non provato.
  for (const r of impagina(ticketCucina(ORDINE))) {
    const max = colonneDi(r.taglia);
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
  // ⚠️ Si contano le colonne DELLA SUA TAGLIA, non 48 fisse. La fascia e'
  // `gigante`: 24 caratteri larghi il doppio riempiono la stessa carta di 48
  // normali. Scritto «>= 48», il giorno che la fascia e' diventata gigante la
  // prova e' diventata rossa su un ticket giusto — e la tentazione era
  // rimpicciolire la fascia per far contenta la prova.
  //
  // ⚠️ E si misura DA «DA INCASSARE» in avanti, non ripulendo i caratteri di
  // controllo: i comandi portano anche byte STAMPABILI (`GS !` e' 0x1d 0x21,
  // e 0x21 e' «!»), che una `replace` di /[\x00-\x1f]/ lascia dentro e conta
  // come testo. Era il difetto della prova vecchia, nascosto da un «>= 48».
  const colonne = colonneDi(impagina(ticketCucina(ORDINE)).find((r) => r.inverso).taglia);
  const fine = riga.slice(riga.indexOf("DA INCASSARE"));
  assert.equal(fine.length, colonne, `la fascia non arriva al bordo: «${fine}»`);
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

test("`largo` e' larga il doppio, `grande` e' solo alta il doppio", () => {
  // ⚠️ E' la differenza che 450 Gradi ha visto sulla carta prima che io nel
  // codice: con `grande` le lettere raddoppiano in ALTEZZA e restano larghe
  // come le normali — cioe' diventano strette. `largo` raddoppia la
  // larghezza, e il prezzo sono le colonne: 24, non 48. Se un giorno le due
  // taglie tornassero a contare uguale, vorrebbe dire che una delle due ha
  // perso il suo comando e i testi escono tagliati senza dirlo.
  assert.equal(colonneDi("grande"), 48);
  assert.equal(colonneDi("largo"), 24);
  assert.equal(colonneDi("gigante"), 24);
  // I due comandi veri: `GS ! 0x10` e' doppia larghezza, `GS ! 0x01` doppia
  // altezza. Un bit scambiato qui e' un ticket che esce stretto.
  assert.deepEqual([...componi([{ testo: "x", taglia: "largo" }])].slice(2, 5), [0x1d, 0x21, 0x10]);
  assert.deepEqual([...componi([{ testo: "x", taglia: "grande" }])].slice(2, 5), [0x1d, 0x21, 0x01]);
});

test("la riga del ritiro non e' scritta col carattere condensato", () => {
  // ⚠️ IL GUASTO (detto da 450 Gradi, 09/10/2026): «#numero · RITIRO hh:mm» —
  // la riga per cui il ticket esiste — usciva in Font B, il carattere
  // CONDENSATO della stampante, scelto perche' ci stanno 64 colonne. Nessuno
  // aveva chiesto 64 colonne per venti caratteri. Questa prova non impone una
  // taglia: impone che quella riga sia larga il doppio, cioe' leggibile in
  // piedi a due metri dal ferma-comande.
  const riga = impagina(ticketCucina(ORDINE)).find((r) => r.testo.includes("RITIRO"));
  assert.ok(riga, "la riga del ritiro non c'e' piu'");
  assert.equal(colonneDi(riga.taglia), 24, `la riga del ritiro e' tornata stretta (${riga.taglia})`);
  assert.ok(riga.testo.length <= 24, `e ora non ci sta: «${riga.testo}»`);
});

test("il logo della stampante passa come testo, come tutti gli altri comandi", () => {
  // ⚠️ E' la ragione per cui il logo si CHIAMA invece di spedirlo: un bitmap
  // ESC/POS porta byte sopra il 128, e il corpo della risposta viaggia come
  // testo UTF-8 — quei byte verrebbero ricodificati e arriverebbe spazzatura
  // alla testina. `FS p 1 0` sta sotto il 128 come `init` e come il taglio.
  const righe = [{ testo: "", logo: true }, { testo: "450 GRADI", taglia: "gigante", centrato: true }];
  const byte = componi(righe);
  for (const b of byte) assert.ok(b < 128, `un byte fuori da UTF-8: ${b}`);
  assert.deepEqual([...new TextEncoder().encode(componiTesto(righe))], [...byte], "testo e byte non coincidono piu'");
  const dentro = [...byte];
  const i = dentro.findIndex((b, k) => b === 0x1c && dentro[k + 1] === 0x70);
  assert.ok(i >= 0, "il comando del logo non c'e'");
  assert.deepEqual(dentro.slice(i, i + 4), [0x1c, 0x70, 1, 0]);
  // E non lascia una riga di testo vuota: `impagina` non ci passa `aCapo`.
  const fisiche = impagina(righe);
  assert.equal(fisiche.length, 2, "il logo ha prodotto una riga di troppo");
  assert.equal(fisiche[0].logo, true);
  assert.ok(anteprima(righe).startsWith(" "), "nell'anteprima il logo non e' centrato");
  assert.ok(anteprima(righe).includes("[logo]"), "l'anteprima non mostra il logo");
});

test("il ripiego del motore NON stampa il logo, il cliente lo accende", () => {
  // ⚠️ Il logo vive nella FLASH di ogni stampante, caricato a mano. Accenderlo
  // nel ripiego vorrebbe dire mandare un comando nuovo a sei ristoranti che
  // non l'hanno chiesto, su stampanti in servizio, per guadagnarci una riga
  // vuota. Lo accende chi il logo l'ha caricato davvero, nel suo
  // `config/ticket.ts` — ed e' l'unico interruttore che serve.
  assert.ok(!ticketCucina(ORDINE).some((r) => r.logo), "il ripiego ha iniziato a stampare un logo da solo");
  assert.ok(ticketCucina({ ...ORDINE, logo: true }).some((r) => r.logo), "il cliente non puo' piu' accenderlo");
});

test("i comandi gia' pronti passano tali e quali, e non in doppia larghezza", () => {
  // ⚠️ `grezzo` serve a UNA cosa: un'immagine, che e' l'unico pezzo del ticket
  // che non si puo' descrivere a parole. Due cose devono reggere.
  //
  // 1. Passa INTATTO. Se `impagina` lo trattasse come testo, `aCapo`
  //    spezzerebbe i comandi sugli spazi — e uno spazio, dentro i dati di
  //    un'immagine, e' semplicemente il byte 0x20: il disegno si romperebbe
  //    esattamente dove capita, senza un errore da nessuna parte.
  // 2. Esce in taglia NORMALE. `GS !` vale anche per le immagini su parecchie
  //    stampanti: una banda mandata mentre e' attiva la doppia larghezza esce
  //    larga il doppio e meta' finisce fuori dalla carta.
  const disegno = "\u001dv0\u0000\u0004\u0000\u0002\u0000ABCDEFGH";
  const righe = [
    { testo: "450 GRADI", taglia: "gigante", centrato: true },
    { grezzo: disegno, testo: "" },
  ];
  const fisiche = impagina(righe);
  assert.equal(fisiche.length, 2, "il comando e' stato spezzato in piu' righe");
  assert.equal(fisiche[1].grezzo, disegno, "il comando e' stato ritoccato");

  const testo = componiTesto(righe);
  assert.ok(testo.includes(disegno), "il comando non e' uscito intatto");
  const prima = testo.slice(0, testo.indexOf(disegno));
  const ultimaTaglia = prima.lastIndexOf("\u001d!");
  assert.ok(ultimaTaglia >= 0, "nessuna taglia impostata prima dell'immagine");
  assert.equal(prima.charCodeAt(ultimaTaglia + 2), 0, "l'immagine parte in doppia larghezza: uscira' tagliata");

  assert.ok(anteprima(righe).includes("[immagine]"), "l'anteprima non dice che li' c'e' un disegno");
});
