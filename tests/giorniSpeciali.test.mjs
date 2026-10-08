/**
 * LA COLONNA «JOURS SPÉCIAUX» — una linea del tempo, non due elenchi.
 *
 * ⚠️ IL GUASTO CHE QUESTE PROVE TENGONO CHIUSO: la tile mostrava i giorni
 * speciali del ristoratore in un riquadro e le prossime feste in un altro.
 * Natale compariva DUE volte — una come chiusura sua, una come festa — e
 * niente diceva che erano la stessa riga: una delle due poteva dire «fermé»
 * mentre l'altra diceva ancora «ouvert».
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  fondi, conti, TIPI_FILTRO, quante, giorniTra, piuGiorni,
} from "../src/lib/admin/giorniSpecialiRegole.ts";
import { attivoNelGiornoSpeciale } from "../src/lib/admin/giornataRegole.ts";

const OGGI = "2026-10-07";
const FINO = piuGiorni(OGGI, 90);

const NATALE = { id: "a", type: "closed", date_from: "2026-12-25", date_to: "2026-12-25" };
const FERIE = { id: "b", type: "closed", date_from: "2026-11-02", date_to: "2026-11-16", note: "Congé annuel" };
const VIGILIA = {
  id: "c", type: "open", date_from: "2026-12-24", date_to: "2026-12-24",
  dinner_open: "18:00", dinner_close: "22:00", note: "Service unique", services: ["soir"],
};
const FESTE = [
  { iso: "2026-11-01", nome: "Toussaint" },
  { iso: "2026-11-11", nome: "Armistice 1918" },
  { iso: "2026-12-24", nome: "Réveillon de Noël" },
  { iso: "2026-12-25", nome: "Noël" },
];

const righe = (speciali = [], feste = []) => fondi({ speciali, feste, oggi: OGGI, fino: FINO });

test("una festa già decisa non compare due volte: le presta il nome", () => {
  const r = righe([NATALE], FESTE);
  const natale = r.filter((x) => x.iso === "2026-12-25");
  assert.equal(natale.length, 1, "Natale compare due volte: la chiusura e la festa non si sono fuse");
  assert.equal(natale[0].tipo, "closed", "ha vinto la festa sulla chiusura: il giorno direbbe «ouvert»");
  assert.equal(natale[0].titolo, "Noël", "la chiusura ha perso il nome della festa");
  assert.equal(natale[0].deciso, true);
});

test("una festa DENTRO un periodo di chiusura e' decisa anche lei", () => {
  // ⚠️ Toussaint (1 nov) sta fuori dalle ferie; l'Armistizio (11 nov) ci sta
  // dentro. Segnando solo il primo giorno del periodo, l'11 novembre sarebbe
  // uscito come festa «ouvert, horaires habituels» in mezzo a due settimane
  // di chiusura.
  const r = righe([FERIE], FESTE);
  assert.ok(!r.some((x) => x.iso === "2026-11-11" && x.tipo === "fete"),
    "una festa dentro il periodo di chiusura e' stampata come se nessuno avesse deciso");
  assert.ok(r.some((x) => x.iso === "2026-11-01" && x.tipo === "fete"),
    "Toussaint e' fuori dalle ferie: deve restare una festa da decidere");
});

test("una festa senza decisione resta una festa, non un allarme", () => {
  // ⚠️ Una pizzeria lavora il 1° maggio: dedurre la chiusura da una festa
  // vorrebbe dire rifiutare prenotazioni in un giorno di lavoro. La riga c'e',
  // e dice soltanto che nessuno ha deciso niente.
  const r = righe([], FESTE);
  assert.equal(r.length, 4);
  for (const x of r) {
    assert.equal(x.tipo, "fete");
    assert.equal(x.deciso, false, "una festa non decisa non deve sembrare un dato scritto da qualcuno");
  }
});

test("oggi sta in cima, poi si va in ordine di data", () => {
  // ⚠️ Un giorno speciale che e' OGGI non e' un promemoria: e' il turno di
  // stasera. In mezzo agli altri si leggerebbe come futuro.
  const oggiSpeciale = { id: "z", type: "open", date_from: OGGI, date_to: OGGI, dinner_open: "18:30", dinner_close: "23:00" };
  const r = righe([NATALE, FERIE, oggiSpeciale], FESTE);
  assert.equal(r[0].iso, OGGI);
  assert.equal(r[0].oggi, true);
  const date = r.slice(1).map((x) => x.iso);
  assert.deepEqual(date, [...date].sort(), "dopo oggi le righe non sono in ordine di data");
});

test("un periodo in corso oggi conta come «oggi» anche se e' iniziato prima", () => {
  const inCorso = { id: "y", type: "closed", date_from: "2026-10-01", date_to: "2026-10-20" };
  const r = righe([inCorso], []);
  assert.equal(r.length, 1, "una chiusura iniziata prima di oggi e non ancora finita e' sparita");
  assert.equal(r[0].oggi, true);
  assert.equal(r[0].giorni, 20);
});

test("quello che e' finito, e quello troppo lontano, non si mostrano", () => {
  const finito = { id: "p", type: "closed", date_from: "2026-09-01", date_to: "2026-09-30" };
  const lontano = { id: "q", type: "closed", date_from: "2027-08-01", date_to: "2027-08-20" };
  const r = righe([finito, lontano], [{ iso: "2027-07-21", nome: "Fête nationale" }]);
  assert.deepEqual(r, [], "la colonna mostra giorni passati o fuori dai 90 giorni");
});

test("le ore e i servizi arrivano intere alla riga", () => {
  const r = righe([VIGILIA], FESTE).find((x) => x.iso === "2026-12-24");
  assert.equal(r.tipo, "open");
  assert.equal(r.titolo, "Réveillon de Noël");
  assert.deepEqual(r.cena, ["18:00", "22:00"]);
  assert.equal(r.pranzo, null, "una fascia che non c'e' non deve diventare «00:00 – 00:00»");
  assert.deepEqual(r.servizi, ["soir"]);
  assert.equal(r.nota, "Service unique");
});

test("i numeri del piede contano le DECISIONI, non le feste", () => {
  // ⚠️ Un «12» fatto di feste del calendario direbbe che c'e' da lavorare
  // dove non c'e' niente da fare.
  const c = conti(righe([NATALE, FERIE, VIGILIA], FESTE));
  assert.equal(c.chiusure, 2);
  assert.equal(c.giorniChiusi, 16, "15 giorni di ferie + Natale");
  assert.equal(c.orari, 1);
  assert.equal(c.prossimaChiusura, "2026-11-02");
});

test("la prossima chiusura e' la prossima in ordine di data, non la prima della lista", () => {
  /* ⚠️ QUESTA PROVA DICEVA UNA COSA E NE CONTROLLAVA UN'ALTRA. Il commento
     scriveva «in cima c'e' oggi, che non e' la prossima» — e poi pretendeva
     proprio OGGI. Cosi' il piede della colonna annunciava «Prossima: 7 ott»
     per una chiusura in corso da stamattina: una data passata sotto
     un'etichetta che dice futuro. La prova sbagliata teneva in piedi il
     guasto, ed e' il modo piu' difficile di accorgersene. */
  const oggiChiuso = { id: "o", type: "closed", date_from: OGGI, date_to: OGGI };
  const c = conti(righe([oggiChiuso, NATALE], []));
  assert.equal(c.prossimaChiusura, "2026-12-25", "quella di oggi non e' la prossima");
  assert.equal(c.chiusuraInCorso, true, "ma non si perde: la colonna la dice sotto");
  const c2 = conti(righe([NATALE, FERIE], []));
  assert.equal(c2.prossimaChiusura, "2026-11-02");
  assert.equal(c2.chiusuraInCorso, false);
});

test("i filtri sono sempre i tre, e dividono decisioni e calendario", () => {
  /* ⚠️ CAMBIATO il 08/10/2026, su richiesta. Prima comparivano solo i filtri
     che avevano righe: la riga dei comandi cambiava forma da sola — le
     aperture sparivano quando non ce n'erano — e chi aveva imparato dov'era
     il bottone lo ritrovava altrove. Tre posti fermi si imparano una volta. */
  assert.deepEqual([...TIPI_FILTRO], ["closed", "open", "fete"]);

  // ⚠️ Chiusure e aperture sono le DECISIONI (le righe scritte da qualcuno);
  // le feste sono il calendario. Una festa in cui il locale resta chiuso non
  // entra fra le chiusure: non l'ha decisa nessuno, e la sua pastiglia dice
  // gia' cosa succede quel giorno.
  const r = righe([NATALE, VIGILIA], FESTE);
  assert.equal(quante(r, "closed"), 1, "solo le chiusure speciali");
  assert.equal(quante(r, "open"), 1, "solo le aperture speciali");
  assert.ok(quante(r, "fete") > 0);
  // Un filtro senza righe esiste lo stesso: la colonna risponde «niente da
  // mostrare», che e' una risposta vera.
  assert.equal(quante(righe([VIGILIA], []), "closed"), 0);
  assert.equal(quante([], "fete"), 0);
});

test("l'aritmetica dei giorni non ha fusi da sbagliare", () => {
  assert.equal(giorniTra("2026-11-02", "2026-11-16"), 15);
  assert.equal(giorniTra("2026-11-02", "2026-11-02"), 1);
  // Cambio dell'ora legale in mezzo (25 ottobre): resta un conto di giorni.
  assert.equal(giorniTra("2026-10-24", "2026-10-26"), 3);
  assert.equal(piuGiorni("2026-12-31", 1), "2027-01-01");
  assert.equal(piuGiorni("2026-02-28", 1), "2026-03-01");
});

// ============================================================
// LA COLONNA NEL MARKUP
// ============================================================
const FASCIA = readFileSync("src/components/admin/home/Giornata.astro", "utf8");
const HOME = readFileSync("src/pages/admin/index.astro", "utf8");

test("la colonna e' una sezione della fascia, e la tile non c'e' piu'", () => {
  assert.match(FASCIA, /<div class="j-col j-spx"/, "la colonna dei giorni speciali non e' nella fascia");
  assert.ok(!readdirSync("src/components/admin/home").includes("TileJoursSpeciaux.astro"),
    "il componente della tile e' ancora li': un componente che nessuno importa viene letto come se fosse vivo");
  assert.doesNotMatch(HOME, /TileJoursSpeciaux/, "la Accueil importa ancora la tile");
  // ⚠️ La chiave «special» fuori dall'organizzatore delle tile: restandoci,
  // il drag & drop cercherebbe un riquadro che non esiste.
  assert.doesNotMatch(HOME, /const KEYS = \[[^\]]*"special"/,
    "«special» e' ancora fra le tile da organizzare");
});

test("il + apre il modale, e la colonna sparisce con Réglages", () => {
  // ⚠️ I giorni speciali si creano in Réglages → Horaires. Se il super spegne
  // quella pagina, un elenco che non si puo' cambiare da nessuna parte e' un
  // elenco che fa perdere tempo.
  assert.match(FASCIA, /class="j-col j-spx"[^>]*data-admin-page="settings"/,
    "la colonna resta anche quando Réglages e' spento");

  // ⚠️ IL BOTTONE E IL SUO AGGANCIO. Il `+` e' il bottone tondo del pannello
  // (`.ibtn`, lo stesso di Notes) e porta l'id che il modale cerca: cambiando
  // l'id, resterebbe li' bello tondo senza aprire niente — e chi lo aggancia
  // esce in silenzio quando non lo trova, quindi nessun errore lo direbbe.
  assert.match(FASCIA, /<button class="btn btn-sm btn-primary" id="spx-add"/,
    "il bottone non e' piu' quello condiviso, lo stesso della colonna delle note");
  assert.match(HOME, /getElementById\("spx-add"\)/, "nessuno aggancia piu' il + al modale");

  // Cliccare una riga apre lo stesso modale, con la sua data: senza, si
  // ricerca a mano sul calendario la festa che si era appena cliccata.
  assert.match(HOME, /"spx:apri"/, "le righe non aprono piu' il modale");
  assert.match(HOME, /"spf:data"/, "la data della riga non arriva piu' al modulo");
  const FORM = readFileSync("src/components/admin/SpecialDaysForm.astro", "utf8");
  assert.match(FORM, /spf:data/, "il modulo non ascolta la data che gli arriva dalla colonna");
  // ⚠️ L'indirizzo vero resta nella riga: serve a ⌘-clic e rotellina, che un
  // `href="#"` avrebbe tolto per far funzionare un clic che funziona gia'.
  assert.match(HOME, /settings\?tab=horaire&spx=/, "le righe non hanno piu' un indirizzo vero");
  assert.match(FORM, /SPX_ARRIVO/, "la pagina Réglages non legge piu' la data dall'indirizzo");
});

test("quando non si sa se il locale e' aperto, la riga non lo inventa", () => {
  // ⚠️ `noto: false` quando l'API pubblica non risponde: ripiegare su «ouvert»
  // vorrebbe dire scegliere la risposta piu' rassicurante proprio quando non
  // la sappiamo.
  assert.match(HOME, /noto: false/, "il caso «non lo sappiamo» non c'e' piu'");
  // La pastiglia aperto/chiuso sulla festa esiste SOLO quando la risposta
  // c'e': una verde messa per ripiego direbbe «aperto» un giorno di chiusura.
  assert.match(HOME, /const stato = !r\.deciso && noto/,
    "la pastiglia «aperto / chiuso» si stampa anche senza aver verificato il giorno");
});


/* ---------------------------------------------------------------
   L'AUDIT DELLA COLONNA (08/10/2026)
   --------------------------------------------------------------- */

test("il piede conta i giorni DENTRO la finestra, non la durata intera", () => {
  // Chiusura di tre settimane cominciata una settimana fa: davanti ne restano
  // quattordici, e sotto il numero c'e' scritto «90 giorni». Prima contava
  // tutti e ventuno.
  const righe = fondi({
    speciali: [{ id: "a", type: "closed", date_from: "2026-10-01", date_to: "2026-10-21", note: "Travaux" }],
    feste: [], oggi: "2026-10-08", fino: "2026-10-31",
  });
  assert.equal(righe[0].giorni, 21, "la RIGA dice la durata vera della chiusura");
  assert.equal(righe[0].giorniInFinestra, 14, "il PIEDE conta da oggi alla fine");
  assert.equal(conti(righe).giorniChiusi, 14);
  // E una chiusura che sborda oltre l'ultimo giorno mostrato si taglia li':
  // quei giorni nella colonna non ci sono.
  const oltre = fondi({
    speciali: [{ id: "b", type: "closed", date_from: "2026-10-20", date_to: "2026-12-31" }],
    feste: [], oggi: "2026-10-08", fino: "2026-10-31",
  });
  assert.equal(oltre[0].giorniInFinestra, 12);
});

test("«prossima chiusura» vuol dire non ancora cominciata", () => {
  const righe = fondi({
    speciali: [
      { id: "a", type: "closed", date_from: "2026-10-07", date_to: "2026-10-09" },
      { id: "b", type: "closed", date_from: "2026-12-24", date_to: "2026-12-26" },
    ],
    feste: [], oggi: "2026-10-08", fino: "2026-12-31",
  });
  const c = conti(righe);
  // ⚠️ Prima si prendeva la prima data in ordine: «prossima chiusura: 7 ott»,
  // cioe' ieri, sotto un'etichetta che dice futuro.
  assert.equal(c.prossimaChiusura, "2026-12-24");
  assert.equal(c.chiusuraInCorso, true, "quella di oggi non si perde: la colonna lo dice sotto");
  const sola = conti(fondi({
    speciali: [{ id: "a", type: "closed", date_from: "2026-10-07", date_to: "2026-10-09" }],
    feste: [], oggi: "2026-10-08", fino: "2026-12-31",
  }));
  assert.equal(sola.prossimaChiusura, null);
  assert.equal(sola.chiusuraInCorso, true);
});

test("un servizio resta attivo anche se gli orari sono cambiati dopo", () => {
  // Il gettone salvato porta l'orario di allora: `soir|19:00-23:00`. Spostata
  // la sera alle 18:30, il confronto esatto non combaciava piu' e il giorno
  // restava «aperto» con ZERO servizi — mentre il sito prendeva prenotazioni.
  assert.ok(attivoNelGiornoSpeciale("soir", "18:30", "23:00", ["soir|19:00-23:00"]));
  assert.ok(attivoNelGiornoSpeciale("soir", "19:00", "23:00", ["soir|19:00-23:00"]), "l'orario giusto combacia");
  assert.ok(attivoNelGiornoSpeciale("soir", "18:30", "23:00", ["soir"]), "le righe vecchie portano la sola chiave");
  // ⚠️ Ma un servizio che NON e' nella lista resta chiuso: il ripiego vale
  // sulla chiave, non su tutto.
  assert.ok(!attivoNelGiornoSpeciale("midi", "12:00", "14:00", ["soir|19:00-23:00"]));
  // Lista nulla = il giorno speciale apre tutto.
  assert.ok(attivoNelGiornoSpeciale("midi", "12:00", "14:00", null));
  // Lista vuota = nessun servizio (solo ordini).
  assert.ok(!attivoNelGiornoSpeciale("midi", "12:00", "14:00", []));
});

const FORM = readFileSync(new URL("../src/components/admin/SpecialDaysForm.astro", import.meta.url), "utf8");
const IMPATTO = readFileSync(new URL("../src/pages/api/admin/special-days-impact.ts", import.meta.url), "utf8");

test("guardia · chiudere un giorno dice anche degli ordini e delle richieste", () => {
  /* ⚠️ Una chiusura chiudeva il sito ai NUOVI ordini e avvisava delle
     prenotazioni confermate — e taceva su quelli GIA' PAGATI per quel giorno:
     il cliente arriva, pagamento fatto, porta chiusa. E sulle richieste in
     attesa, a cui nessuno avrebbe mai piu' risposto «si'». */
  assert.ok(/leggi\("orders"/.test(IMPATTO), "l'impatto legge gli ordini del giorno");
  assert.ok(/\["confirmed", "pending"\]/.test(IMPATTO), "e le richieste in attesa");
  assert.ok(/impactOrders/.test(FORM) && /impactPending/.test(FORM), "il modale le dice");
  // ⚠️ Ma NON le annulla: far uscire dei soldi e' un gesto che si firma nella
  // pagina Commandes, dove si vede l'importo.
  assert.ok(!/aggiorna\("orders"/.test(IMPATTO), "nessun ordine annullato da qui");
});

test("guardia · il modale dell'impatto e' fatto coi componenti del pannello", () => {
  // Era l'ultimo modale del motore disegnato dentro un `style="..."`: fondo,
  // bordo, raggio e tre bottoni scritti a mano.
  assert.ok(/md-overlay/.test(FORM) && /md-back/.test(FORM), "il guscio e' `.md-overlay` col suo velo");
  assert.ok(/md-btn md-btn-primary/.test(FORM), "i bottoni sono quelli dei modali");
  assert.ok(!/position:fixed;inset:0/.test(FORM), "niente velo disegnato a mano");
});
