/**
 * LA COLONNA «PHOTOS» — cosa e' entrato, e cosa non serve a niente.
 *
 * ⚠️ IL GUASTO: `used_by` — l'elenco dei piatti, dei pop-up e degli eventi che
 * mostrano una foto — arrivava nella risposta dell'API e la Accueil non lo
 * leggeva. Mostrava le ultime OTTO miniature, col solo nome nel titolo. Quali
 * foto non le usasse nessuno (le uniche che si possono cancellare: la pagina
 * Assets rifiuta di toccare le altre, e risponde 409 con l'elenco di chi le
 * mostra) si scopriva solo aprendo la pagina e guardando le card una per una.
 *
 * ⚠️ E il tetto a otto nascondeva proprio le foto VECCHIE, che sono quelle che
 * nessuno usa piu'.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  usata, recenti, conFiltro, libere, etaInGiorni, conti, peso, famiglieDi, FAMIGLIE,
} from "../src/lib/admin/fotoRegole.ts";

const chiave = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
const OGGI = "2026-10-08";

const LIBRERIA = [
  { bucket: "menu", name: "tagliata.jpg", url: "u1", size: 1_200_000, created_at: "2026-10-08T07:00:00Z", used_by: ["Plat : Tagliata"], tags: ["menu"] },
  { bucket: "popups", name: "halloween.png", url: "u2", size: 2_400_000, created_at: "2026-10-08T06:00:00Z", used_by: [], tags: [] },
  { bucket: "menu", name: "tiramisu.jpg", url: "u3", size: 800_000, created_at: "2026-10-07T09:00:00Z", used_by: ["Plat : Tiramisù"], tags: ["menu"] },
  { bucket: "popups", name: "apero.jpg", url: "u4", size: 500_000, created_at: "2026-10-02T09:00:00Z", used_by: ["Pop-up : Apéro"], tags: ["marketing"] },
  { bucket: "popups", name: "vecchia.jpg", url: "u5", size: 3_000_000, created_at: "2026-07-01T09:00:00Z", used_by: [], tags: [] },
  /* La foto grande della pagina d'accueil: sta nella bibliotheque come le
     altre, e il suo URL e' montato in uno slot del sito. */
  { bucket: "popups", name: "hero.jpg", url: "u6", size: 2_000_000, created_at: "2026-09-20T09:00:00Z", used_by: ["Site : Accueil — Hero (diaporama) Image 1"], tags: ["site"] },
];

test("una foto che non mostra nessuno e' «libera», ed e' l'unica cancellabile", () => {
  assert.equal(usata(LIBRERIA[0]), true);
  assert.equal(usata(LIBRERIA[1]), false);
  // ⚠️ `used_by` assente o rotto non vuol dire «usata»: nel dubbio una foto
  // non si cancella, ma qui il dubbio non c'e' — l'API manda sempre l'elenco.
  assert.equal(usata({ used_by: null }), false);
  assert.equal(usata({}), false);
  assert.equal(usata(null), false);
  assert.equal(libere(LIBRERIA), 2);
  /* ⚠️ IL GUASTO PEGGIORE, chiuso il 08/10/2026: le foto montate negli slot
     del sito pubblico (hero, galleria, bandone) risultavano LIBERE. Nessuno
     leggeva `app_config`, dove finisce il loro URL — quindi la bibliotheque
     le lasciava cancellare, e la pagina d'accueil restava col buco. Nessun
     errore, nessun avviso: lo si scopriva guardando il sito. */
  assert.equal(usata(LIBRERIA.at(-1)), true, "una foto del sito e' usata");
});

test("dalla piu' recente, e una data illeggibile finisce in fondo", () => {
  assert.deepEqual(recenti(LIBRERIA).map((f) => f.name),
    ["tagliata.jpg", "halloween.png", "tiramisu.jpg", "apero.jpg", "hero.jpg", "vecchia.jpg"]);
  // ⚠️ Un file arrivato nel bucket senza data NON va in cima: li' si
  // leggerebbe come «appena caricata».
  const conRotta = [...LIBRERIA, { name: "senza-data.jpg", created_at: null, used_by: [] }];
  assert.equal(recenti(conRotta).at(-1).name, "senza-data.jpg");
  assert.deepEqual(recenti(null), []);
});

test("i filtri: i tag vengono dall'USO, non dalla cartella", () => {
  // `halloween.png` sta nel bucket `popups` ma non la usa nessuno: non e'
  // marketing, e' libera. Lo decide l'API, e il filtro la segue.
  assert.deepEqual(conFiltro(LIBRERIA, "menu").map((f) => f.name), ["tagliata.jpg", "tiramisu.jpg"]);
  assert.deepEqual(conFiltro(LIBRERIA, "marketing").map((f) => f.name), ["apero.jpg"]);
  assert.deepEqual(conFiltro(LIBRERIA, "site").map((f) => f.name), ["hero.jpg"]);
  assert.deepEqual(conFiltro(LIBRERIA, "libere").map((f) => f.name), ["halloween.png", "vecchia.jpg"]);
  assert.equal(conFiltro(LIBRERIA, "").length, 6);
});

test("le famiglie di una foto: in ordine fisso, e senza doppioni", () => {
  // Una foto puo' stare in due famiglie: la stessa immagine su un piatto e in
  // un pop-up. Si leggono tutte, sempre nello stesso ordine.
  assert.deepEqual([...FAMIGLIE], ["menu", "marketing", "site"]);
  assert.deepEqual(famiglieDi({ tags: ["marketing", "menu"] }), ["menu", "marketing"]);
  assert.deepEqual(famiglieDi({ tags: ["menu", "menu"] }), ["menu"]);
  assert.deepEqual(famiglieDi({ tags: ["site"] }), ["site"]);
  // Nessuna famiglia = libera, e quella e' l'unica pastiglia rossa.
  assert.deepEqual(famiglieDi({ tags: [] }), []);
  assert.deepEqual(famiglieDi({}), []);
  assert.deepEqual(famiglieDi(null), []);
  // Un tag che non conosciamo non diventa una pastiglia senza nome.
  assert.deepEqual(famiglieDi({ tags: ["chissa"] }), []);
});

test("l'eta' in giorni di calendario, e niente quando la data non si legge", () => {
  assert.equal(etaInGiorni("2026-10-08T07:00:00Z", OGGI, chiave), 0);
  assert.equal(etaInGiorni("2026-10-07T09:00:00Z", OGGI, chiave), 1);
  assert.equal(etaInGiorni("2026-07-01T09:00:00Z", OGGI, chiave), 99);
  // ⚠️ `null` e non zero: «auj.» su un file di un anno fa e' una bugia che
  // sembra un dettaglio.
  assert.equal(etaInGiorni("ieri", OGGI, chiave), null);
  assert.equal(etaInGiorni(null, OGGI, chiave), null);
  // Una foto caricata un attimo fa, con l'orologio del server avanti di poco:
  // mai un'eta' negativa.
  assert.equal(etaInGiorni("2026-10-09T01:00:00Z", OGGI, chiave), 0);
});

test("i numeri del piede: quante, quante libere, quanto spazio", () => {
  const c = conti(LIBRERIA, OGGI, chiave);
  assert.equal(c.totale, 6);
  assert.equal(c.settimana, 4, "le ultime sette giornate");
  assert.equal(c.libere, 2);
  assert.equal(c.byte, 9_900_000);
  assert.equal(c.media, Math.round(9_900_000 / 6));
  // Senza foto non si divide per zero, e lo spazio e' zero.
  assert.deepEqual(conti([], OGGI, chiave), { totale: 0, settimana: 0, libere: 0, byte: 0, media: 0 });
  // Una dimensione rotta non azzera la somma delle altre.
  assert.equal(conti([{ size: null, created_at: null }, { size: 1024, created_at: null }], OGGI, chiave).byte, 1024);
});

test("i byte scritti: mai «0 Ko» per un file che esiste", () => {
  assert.equal(peso(1024, "Ko", "Mo"), "1 Ko");
  // ⚠️ Un file da 300 byte occupa poco, non niente.
  assert.equal(peso(300, "Ko", "Mo"), "1 Ko");
  assert.equal(peso(1_500_000, "Ko", "Mo"), "1.4 Mo");
  // Zero o illeggibile: niente, non «0 Ko».
  assert.equal(peso(0, "Ko", "Mo"), "");
  assert.equal(peso(null, "Ko", "Mo"), "");
  assert.equal(peso("abc", "Ko", "Mo"), "");
});

/* ---------- le guardie sul codice ---------- */

const HOME = readFileSync(new URL("../src/pages/admin/index.astro", import.meta.url), "utf8");
const ASSETS = readFileSync(new URL("../src/pages/admin/assets.astro", import.meta.url), "utf8");

test("guardia · la colonna e la pagina Assets contano i byte allo stesso modo", () => {
  assert.ok(/fotoRegole/.test(HOME), "la colonna importa fotoRegole");
  assert.ok(/fotoRegole/.test(ASSETS), "la pagina Assets pure");
  assert.ok(!/bytes < 1024 \* 1024/.test(ASSETS), "nessuna seconda copia della soglia");
});

test("guardia · il cestino sta solo sulle libere, e chiama l'API di sempre", () => {
  // La pagina Assets risponde 409 su una foto usata: un cestino che si puo'
  // premere e si sente dire «no» insegna a non fidarsi dei bottoni.
  assert.ok(/libera\s*\n?\s*\?\s*`<button type="button" class="ibtn ibtn-sm ibtn-danger ph-del"/.test(HOME),
    "il cestino compare solo quando la foto e' libera");
  assert.ok(/\/api\/admin\/images\?bucket=/.test(HOME), "e cancella con la DELETE di sempre");
  // Due tocchi, come tutti gli altri cestini del pannello.
  assert.ok(/classList\.contains\("confirm"\)[\s\S]{0,400}home\.deleteQ/.test(HOME), "guardia a due tocchi");
});

test("guardia · la cella non si clicca, e il cestino si vede sempre", () => {
  /* ⚠️ Un quadrato grande che porta alla pagina Assets, con dentro il solo
     comando che serve, e' un bersaglio che si preme per sbaglio mentre si
     cerca il cestino. Per andare alla libreria c'e' «Voir tout» in testa alla
     colonna, dove sta in tutte le altre. */
  assert.ok(/return `<div class="ph-cell"/.test(HOME), "la cella e' un div, non un `<a>`");
  assert.ok(!/<a class="ph-cell"/.test(HOME), "nessun link sulla miniatura");
  // ⚠️ `position: relative` sulla cella: senza, la pastiglia e il cestino si
  // appoggerebbero al primo antenato posizionato — cioe' da un'altra parte
  // nella pagina, tutti nello stesso punto.
  assert.ok(/\.ph-cell \{[^}]*position: relative/.test(HOME), "le pastiglie si appoggiano alla cella");
  // Sempre in vista: su un tablet appeso in sala non c'e' un passaggio del
  // dito che faccia comparire un comando.
  assert.ok(!/\.ph-cell:hover[^}]*\.ph-del/.test(HOME), "il cestino non compare solo al passaggio");
});

test("guardia · la tile «Photos récentes» non c'e' piu'", () => {
  assert.ok(!/TilePhotos/.test(HOME), "nessun resto della tile");
  assert.ok(!/\.slice\(0, 8\)/.test(HOME), "ne' il tetto a otto miniature");
});

/* ---------- caricare una foto: un gesto, due schermi ---------- */

import { troppoGrande, MAX_FOTO_BYTE, BUCKET_LIBERO } from "../src/lib/admin/caricaFoto.ts";

test("il peso si controlla PRIMA di spedire, e dopo la compressione", () => {
  /* ⚠️ Il server rifiuta comunque i file sopra i 4 Mo — ma dopo averli
     ricevuti: quattro mega in salita da un telefono in sala, per sentirsi dire
     «troppo grande». Il controllo sta anche qui, e sta DOPO la compressione:
     prima vorrebbe dire rifiutare uno scatto da 8 Mo che, compresso, ne pesa
     uno — cioe' quasi tutte le foto fatte col telefono. */
  assert.equal(MAX_FOTO_BYTE, 4 * 1024 * 1024);
  assert.equal(troppoGrande(MAX_FOTO_BYTE), false);
  assert.equal(troppoGrande(MAX_FOTO_BYTE + 1), true);
  assert.equal(troppoGrande(0), false);
  // Una dimensione illeggibile e' «troppo grande»: non si spedisce al buio.
  assert.equal(troppoGrande(null), true);
  assert.equal(troppoGrande("abc"), true);
});

test("una foto caricata senza dire a cosa serve nasce libera", () => {
  // ⚠️ Nel bucket `popups` e non `menu`: non e' la foto di un piatto finche'
  // qualcuno non la monta da qualche parte, e allora il tag arriva da solo.
  assert.equal(BUCKET_LIBERO, "popups");
});

test("guardia · il caricamento e' scritto in un posto solo", () => {
  const CARICA = readFileSync(new URL("../src/pages/admin/assets.astro", import.meta.url), "utf8");
  assert.ok(/caricaFoto/.test(HOME), "la colonna usa il gesto condiviso");
  assert.ok(/caricaFoto/.test(CARICA), "e la pagina Assets pure");
  /* ⚠️ La guardia riguarda il gesto «aggiungi un'immagine». La pagina Assets
     ha altri due caricamenti che restano suoi, e sono due cose diverse:
     SOSTITUIRE una foto esistente (una PATCH, che aggiorna anche i
     riferimenti) e caricare un PDF (altro bucket, altro tetto: 10 Mo). */
  assert.ok(!/4 \* 1024 \* 1024/.test(CARICA), "nessuna seconda copia della soglia del peso");
  assert.ok(/caricaFoto\(file, \{ headers \}\)/.test(CARICA), "l'aggiunta passa dal modulo");
});
