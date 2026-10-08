/**
 * LA COLONNA «MENU» — cosa non si puo' vendere adesso.
 *
 * ⚠️ NON e' la carta: quella ha la sua pagina, e novanta righe in una colonna
 * non si leggono. Qui c'e' solo cio' che oggi e' FUORI, e la differenza fra i
 * due modi di essere fuori e' tutto il punto di questa colonna:
 *   - ESAURITO: il piatto e' ancora sul sito, il cliente lo vede barrato, e
 *     stasera torna in vendita con un tocco. E' il lavoro di oggi.
 *   - NASCOSTO: il piatto dal sito non c'e' proprio, e ci resta finche'
 *     qualcuno non lo rimette. E' una decisione, non un turno.
 *
 * ⚠️ IL GUASTO EREDITATO DALLA TILE: mostrava i primi quattro indisponibili e
 * poi «+3 in piu'…». Per sapere QUALI erano gli altri tre bisognava aprire la
 * pagina Menu — cioe' il contrario di cio' che serve guardando la Accueil
 * all'apertura del servizio.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  statoPiatto, fuori, conStato, formatiFiniti, etichettaFormati, conti,
} from "../src/lib/admin/menuRegole.ts";

const CARTA = [
  { id: "1", name: "Tagliata", category: "Secondi", price_cents: 2400, image_url: "https://x/t.jpg", available: true, sold_out: true },
  { id: "2", name: "Tiramisù", category: "Dolci", price_cents: 850, image_url: "", available: true, sold_out: true },
  { id: "3", name: "Margherita", category: "Pizze", price_cents: 1200, image_url: "https://x/m.jpg", available: true, sold_out: false },
  { id: "4", name: "Menu di Natale", category: "Menu fissi", price_cents: 4500, image_url: null, available: false, sold_out: false },
  { id: "5", name: "Spritz", category: "Aperitivi", price_cents: 900, image_url: "https://x/s.jpg", available: false, sold_out: true },
  { id: "6", name: "Acqua", category: "Bibite", price_cents: 300, image_url: "https://x/a.jpg", available: true, sold_out: false },
];
const KIND = (c) => (c === "Aperitivi" || c === "Bibite" ? "drink" : "food");

test("«nascosto» vince su «esaurito»", () => {
  // Lo Spritz e' fuori dal sito E segnato esaurito: e' prima di tutto fuori
  // dal sito. Dire «esaurito» di una cosa che nessuno puo' vedere manda a
  // cercare in cucina un problema che sta nel pannello.
  assert.equal(statoPiatto(CARTA[4]), "hidden");
  assert.equal(statoPiatto(CARTA[0]), "sold");
  assert.equal(statoPiatto(CARTA[3]), "hidden");
  // Un piatto in vendita non e' nella colonna.
  assert.equal(statoPiatto(CARTA[2]), null);
  assert.equal(statoPiatto(null), null);
});

test("prima gli esauriti, che sono il lavoro di stasera", () => {
  const f = fuori(CARTA);
  assert.deepEqual(f.map((r) => r.name), ["Tagliata", "Tiramisù", "Menu di Natale", "Spritz"]);
  // ⚠️ I nascosti in fondo: un menu di Natale nascosto a luglio in cima alla
  // colonna sarebbe rumore fisso, ogni giorno, per sei mesi.
  assert.deepEqual(f.slice(0, 2).map((r) => statoPiatto(r)), ["sold", "sold"]);
  // Un piatto in vendita non entra, mai.
  assert.ok(!f.some((r) => r.name === "Margherita"));
  assert.deepEqual(fuori(null), []);
});

test("i filtri dividono i due modi di essere fuori", () => {
  assert.deepEqual(conStato(CARTA, "sold").map((r) => r.name), ["Tagliata", "Tiramisù"]);
  assert.deepEqual(conStato(CARTA, "hidden").map((r) => r.name), ["Menu di Natale", "Spritz"]);
  assert.equal(conStato(CARTA, "").length, 4, "senza filtro, tutti quelli fuori");
});

test("i formati finiti si dicono col loro nome", () => {
  /* ⚠️ Con «40 cm» finita e «30 cm» disponibile l'interruttore del piatto e'
     SPENTO — e' del piatto intero — e senza questa riga l'unico modo di
     saperlo era aprire il modale nella pagina Menu. */
  const pizza = {
    name: "Margherita",
    variants: [
      { key: "p30", label_i18n: { fr: "30 cm", it: "30 cm" }, sold_out: false },
      { key: "p40", label_i18n: { fr: "40 cm", it: "40 cm" }, sold_out: true },
      { key: "p50", label_i18n: { fr: "50 cm" }, sold_out: true },
    ],
  };
  assert.deepEqual(formatiFiniti(pizza, "it"), ["40 cm", "50 cm"]);
  assert.equal(etichettaFormati(pizza, "it"), "40 cm +1");
  // ⚠️ L'etichetta manca nella lingua chiesta: si prende la prima che c'e' —
  // mai una stringa vuota, che in una pastiglia e' un rettangolo senza
  // spiegazione. («50 cm» esiste solo in francese.)
  assert.deepEqual(formatiFiniti({ variants: [{ key: "p50", label_i18n: { fr: "50 cm" }, sold_out: true }] }, "it"), ["50 cm"]);
  // Senza etichette resta la chiave: brutta, ma vera.
  assert.deepEqual(formatiFiniti({ variants: [{ key: "grande", sold_out: true }] }, "it"), ["grande"]);
  assert.equal(etichettaFormati({ variants: [] }, "it"), null);
  assert.equal(etichettaFormati(null, "it"), null);
});

test("i numeri del piede: piatti, bevande e i buchi delle foto", () => {
  const c = conti(CARTA, KIND);
  assert.equal(c.piatti, 4);
  assert.equal(c.bevande, 2);
  assert.equal(c.catPiatti, 4);
  assert.equal(c.catBevande, 2);
  // ⚠️ `image_url` vuoto, a spazi o assente: sono tutte foto che non ci sono,
  // e il sito al loro posto mostra un rettangolo grigio.
  assert.equal(c.senzaFoto, 2);
  assert.equal(c.totale, 6);
  assert.equal(conti([{ category: "x", image_url: "   " }], KIND).senzaFoto, 1);
});

test("una categoria sconosciuta resta nel conto, fra i piatti", () => {
  // ⚠️ Una riga con una categoria che non e' nell'elenco e' comunque un piatto
  // che qualcuno ha scritto: buttarla via vorrebbe dire un menu piu' piccolo
  // di quello che e', senza che niente lo dica.
  const c = conti([{ name: "Fuori lista", category: "Sparita", image_url: "https://x/1.jpg" }], KIND);
  assert.equal(c.piatti, 1);
  assert.equal(c.bevande, 0);
  assert.equal(c.totale, 1);
});

/* ---------- le guardie sul codice ---------- */

const HOME = readFileSync(new URL("../src/pages/admin/index.astro", import.meta.url), "utf8");
const PAGINA = readFileSync(new URL("../src/pages/admin/menu.astro", import.meta.url), "utf8");

test("guardia · la colonna e la pagina chiedono le regole allo stesso modulo", () => {
  assert.ok(/menuRegole/.test(HOME), "la colonna importa menuRegole");
  assert.ok(/menuRegole/.test(PAGINA), "la pagina Menu importa menuRegole");
  // La scelta dei formati finiti era scritta a mano nella pagina.
  assert.ok(!/filter\(\(v\) => v\.sold_out === true\)/.test(PAGINA), "nessuna copia della regola dei formati");
  // Il filtro «fuori» scritto a mano nella Accueil, con l'ordinamento a
  // numeri booleani che nessuno rileggeva.
  assert.ok(!/filter\(\(r\) => !r\.available \|\| r\.sold_out\)/.test(HOME), "nessuna copia del filtro «fuori»");
});

test("guardia · l'interruttore e la chiamata sono quelli della pagina Menu", () => {
  // Stesso componente, stesso verso (acceso = esaurito) e stessa API: un
  // secondo modo di dire «non e' finito» sarebbe un secondo posto in cui
  // ricordarsi le regole della sede.
  assert.ok(/class="switch sw-sold"/.test(HOME), "la colonna usa `.switch.sw-sold`");
  assert.ok(/"\/api\/admin\/menu"[\s\S]{0,200}sold_out/.test(HOME), "e la PUT di sempre");
  // ⚠️ L'interruttore NON sta sui nascosti: rimettere un piatto sul sito e'
  // una decisione che si prende con foto, descrizione e prezzo davanti.
  assert.ok(/st === "sold"\s*\n?\s*\?\s*`<label class="switch sw-sold"/.test(HOME), "solo sugli esauriti");
  /* ⚠️ E STA FUORI DAL LINK. Nelle altre colonne il comando dentro la riga e'
     un `<button>` e basta un `preventDefault()` per non far partire anche il
     link; su una CASELLA quello stesso `preventDefault()` annulla il cambio di
     stato — l'interruttore non si gira, `change` non parte, il tocco non fa
     niente, e nessun errore da nessuna parte. */
  /* ⚠️ E LA RIGA NON E' UN LINK: l'unica cosa che si tocca e' l'interruttore.
     Un rettangolo largo che porta a una pagina qualsiasi del menu, con dentro
     il solo comando che serve, e' un bersaglio che si preme per sbaglio
     mentre si cerca la casella. */
  assert.ok(/return `<div class="j-li\$\{st === "hidden"/.test(HOME), "la riga del menu e' un div, non un `<a>`");
  assert.ok(!/m-link/.test(HOME), "nessun link dentro la riga");
});

test("guardia · la tile Menu non c'e' piu'", () => {
  // E' diventata questa colonna, come la lavagnetta prima di lei.
  assert.ok(!/TileMenu/.test(HOME), "nessun resto della tile nella pagina");
  assert.ok(!/"menu", "visibilite"/.test(HOME), "ne' fra le isole che si possono trascinare");
});
