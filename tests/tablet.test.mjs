/**
 * IPAD ORIZZONTALE — la scala ridotta regge solo se i tre pezzi combaciano.
 *
 * La riduzione non e' una regola sola: e' un piede di misura piu' corto
 * (`styles/tablet.css`, :root a 13px) piu' due ritocchi alle misure in px che
 * il `rem` non tocca (AdminHeader, AdminNav). Se uno dei tre si scolla dagli
 * altri — soglia cambiata, file non piu' importato — il risultato non e' un
 * errore: e' un pannello con l'header rimpicciolito e i bottoni giganti, o il
 * contrario. Niente diventa rosso da solo, quindi lo guarda questo file.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

// ⚠️ Via i commenti PRIMA di cercare: qui dentro si cerca la media query, e i
// commenti di questi file la nominano. Senza questo passaggio il test si
// accontenterebbe della propria spiegazione (gia' successo tre volte).
const nudo = (f) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const QUERY = "@media (min-width: 1024px) and (max-width: 1366px) and (pointer: coarse)";

test("la scala ridotta parte da un posto solo, e l'admin la carica", () => {
  const css = nudo("src/styles/tablet.css");
  assert.ok(css.includes(QUERY), "la fascia iPad orizzontale non e' piu' quella: header e nav resterebbero indietro");
  assert.match(css, /:root\s*\{[^}]*font-size:\s*1[0-9](\.\d+)?px/, "tablet.css non abbassa piu' il piede di misura: senza quello non si riduce niente");

  const head = nudo("src/components/admin/AdminHead.astro");
  assert.match(head, /styles\/tablet\.css/, "AdminHead non importa piu' tablet.css: la scala non arriva a nessuna pagina");
});

test("header e nav usano LA STESSA fascia del piede di misura", () => {
  for (const f of ["src/components/admin/AdminHeader.astro", "src/components/admin/AdminNav.astro"]) {
    assert.ok(nudo(f).includes(QUERY), `${f} non ha la stessa media query: le sue misure in px non seguono la scala`);
  }
});

test("sull'iPad orizzontale le sezioni diventano un bancone che si tira di lato", () => {
  // 1024 CSS px: per il motore e' un desktop, ma la fascia si impilava lo
  // stesso (la soglia stretta e' 1100) e dell'Accueil restava una colonna a
  // tutta larghezza. Su un iPad in mano le sezioni stanno tutte su UNA riga e
  // la riga si scorre col dito: mandata a capo, per vedere la quarta si
  // scorre in verticale e si perdono di vista le prime — che e' esattamente
  // cio' per cui si apre questa pagina.
  const home = nudo("src/pages/admin/index.astro");
  assert.ok(home.includes(QUERY), "la Accueil non e' piu' nella fascia iPad: a 1024px la giornata torna impilata");
  const blocco = home.split(QUERY)[1]?.split("@media")[0] ?? "";
  assert.match(blocco, /grid-auto-flow:\s*column/,
    "sull'iPad le sezioni non stanno piu' su una riga sola");
  assert.match(blocco, /overflow-x:\s*auto/,
    "la riga delle sezioni non si scorre piu' di lato: le ultime restano irraggiungibili");
  // Larghezza FISSA: un bancone ha le colonne tutte uguali. Con `1fr` la
  // stessa colonna sarebbe larga diversa da un locale all'altro, a seconda di
  // quante funzioni ha accese.
  assert.doesNotMatch(blocco, /grid-auto-columns:[^;]*\bfr\b/,
    "le colonne del bancone si allargano con lo schermo invece di avere la loro misura");

  // ⚠️ Le misure della fascia stanno in UN posto solo, e una media query che
  // se le ricopia resta indietro al primo cambio — due schermi, due disegni,
  // e nessuno l'ha deciso.
  assert.equal((home.match(/repeat\(3, minmax\(0, 1fr\)\)/g) ?? []).length, 1,
    "le colonne della giornata sono scritte in piu' di un posto");
  assert.equal((home.match(/--j-col-piena:/g) ?? []).length, 1,
    "l'altezza delle colonne e' calcolata in piu' di un posto");

  // ⚠️ QUI L'ALTEZZA SI RIACCENDE, e non e' un dettaglio del tablet: fra 1024
  // e 1100 valgono DUE media query, e quella stretta (le sezioni impilate)
  // spegne l'altezza con `auto`. Nessuna la contraddiceva, quindi su un iPad
  // mini in orizzontale le colonne del bancone crescevano col loro contenuto
  // e sbordavano sotto la barra — mentre sul desktop tutto sembrava a posto.
  assert.match(blocco, /--j-col-h:\s*var\(--j-col-piena\)/,
    "la fascia iPad non riaccende l'altezza delle colonne: a 1024-1100 vince l'`auto` della fascia stretta e il bancone sborda");
  assert.doesNotMatch(blocco, /--j-col-h:\s*(calc|max)\(/,
    "la fascia iPad si ricopia la formula dell'altezza invece di riusarla: al primo cambio resta indietro");

  // ⚠️ SUL BANCONE NON SI SCORRE IN VERTICALE. La fascia E' la pagina, alta
  // quanto lo schermo le concede: ogni millimetro sotto diventa una striscia
  // vuota da andare a scoprire scorrendo in giu'. Il piede del `main` serve a
  // far passare l'isola in fondo a una pagina che scorre — qui non scorre, e
  // la fascia si ferma gia' sopra l'isola per conto suo.
  assert.match(blocco, /main\s*\{[^}]*padding-bottom:\s*0/,
    "sul tablet torna il piede del `main` sotto il bancone: cento pixel di vuoto da scorrere");
  const giu = blocco.match(/\.jour\s*\{[\s\S]*?padding-bottom:\s*([^;]+);/);
  assert.ok(giu && parseFloat(giu[1]) <= 1,
    `sotto il bancone ci sono ${giu ? giu[1] : "?"} di spazio: basta un filo per la barra di scorrimento`);

  // ⚠️ E il marchio e' l'ULTIMA colonna, non la prima. La sua variante sta
  // DOPO la regola di base: scritta prima, a parita' di specificita' perdeva e
  // il marchio si riprendeva `grid-column: 1 / -1` — che su una griglia a
  // colonne automatiche vuol dire la PRIMA colonna, davanti alla giornata.
  const base = home.indexOf(".j-marchio { grid-column: 1 / -1");
  const variante = home.indexOf(".j-marchio { grid-column: auto");
  assert.ok(base > -1 && variante > -1, "il marchio non ha piu' le sue due regole");
  assert.ok(variante > base,
    "la regola del marchio sul bancone sta PRIMA di quella di base: perde, e il marchio torna davanti alla giornata");
});

test("le etichette della barra non scendono sotto il leggibile", () => {
  // 0.56rem col piede a 13px fa 7px. In quella fascia il valore deve essere
  // in px, cioe' non seguire la scala: e' l'icona a stringersi, non la parola.
  const nav = nudo("src/components/admin/AdminNav.astro");
  const blocco = nav.split(QUERY)[1] ?? "";
  const px = blocco.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
  assert.ok(px, "nella fascia iPad le etichette della nav non hanno piu' una misura in px: tornano a ~7px");
  assert.ok(Number(px[1]) >= 8, `etichette a ${px[1]}px: sotto gli 8px non si leggono a un braccio di distanza`);
});

test("nel modale ordine le due colonne scorrono per conto loro", () => {
  // ⚠️ Scoperto sull'iPad di un cliente: i piatti del menu non si potevano
  // scorrere. La colonna era `sticky`, cioe' inchiodata: piu' alta del
  // contenitore, la sua parte bassa non si raggiungeva. Un difetto di tutti
  // gli schermi larghi — su un monitor alto il menu ci stava e non si vedeva.
  const ord = nudo("src/pages/admin/orders.astro");
  // ⚠️ Da 1024px in su: sotto, le colonne si impilano e scorre il pannello,
  // come su telefono (il confine era 761 fino al 04/10, ma un iPad verticale
  // e' 768-834 e restava a due colonne strette).
  // ⚠️ I blocchi «da 1024 in su» sono PIU' DI UNO (lo step 3 a meta' e meta',
  // il modale che scorre, la riga del titolo): prendendone uno solo, il test
  // guardava la parte sbagliata e diventava rosso appena qualcuno ne
  // aggiungeva un altro prima — rosso per una regola spostata, non per un
  // difetto. Si guardano tutti insieme.
  const blocco = ord
    .split("@media (min-width: 1024px)")
    .slice(1)
    .map((p) => p.split("@media")[0])
    .join("\n");
  assert.ok(blocco, "la fascia da 1024px in su non c'e' piu': il modale ordine non ha piu' il suo layout a due colonne");

  assert.doesNotMatch(blocco, /position:\s*sticky/,
    "la colonna del menu e' tornata sticky: se e' piu' alta del modale, gli ultimi piatti non si raggiungono");

  for (const parte of ["nc-items", "nc-cart"]) {
    assert.ok(
      new RegExp(`${parte}[\\s\\S]{0,400}overflow-y:\\s*auto`).test(blocco),
      `${parte} non scorre piu' per conto suo: torna a dipendere dallo scorrimento del pannello`,
    );
  }
  assert.match(blocco, /overscroll-behavior:\s*contain/,
    "senza `overscroll-behavior: contain` il gesto, arrivato in fondo alla lista, trascina la pagina sotto");
});

test("barra e bottoni flottanti posano tutti sulla stessa linea", () => {
  // ⚠️ Abbassando la barra si e' scordato il «+ Ordine», che e' rimasto alla
  // sua altezza di prima: affiancati e disallineati di quattro pixel, che a
  // schermo si vedono benissimo. Lo stesso vale per i due tondi della pagina
  // prenotazioni. Qui il valore non e' fissato: devono solo essere TUTTI LO
  // STESSO, qualunque sia.
  const FILE = [
    "src/components/admin/AdminNav.astro",
    "src/styles/fab.css",
    "src/pages/admin/reservations.astro",
  ];
  const valori = new Map();
  for (const f of FILE) {
    const blocco = nudo(f).split(QUERY)[1]?.split("@media")[0] ?? "";
    // ⚠️ `bottom:` da solo pesca anche `border-bottom` e `margin-bottom`:
    // serve il confine davanti, se no il test accusa regole che non c'entrano.
    for (const m of blocco.matchAll(/(?:^|[;{\s])bottom:\s*([^;]+);/g)) valori.set(`${f} → ${m[1].trim()}`, m[1].trim());
  }
  const distinti = new Set(valori.values());
  assert.ok(distinti.size > 0, "nessuno di questi file posa piu' niente in quella fascia: l'allineamento non e' piu' garantito da nessuna parte");
  assert.equal(
    distinti.size, 1,
    `barra e bottoni flottanti hanno altezze diverse (${[...valori.keys()].join(" · ")}): a schermo si vede che non sono allineati`,
  );
});
