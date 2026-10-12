/**
 * LA TESTA SEO DEL MOTORE — il componente e le regole della scheda.
 *
 * ⚠️ Perche' queste prove: fino al 12/10/2026 ogni cliente si scriveva la
 * propria testa SEO. Sei in sei forme diverse, 450 Gradi senza niente. Il
 * difetto corretto l'11/10 (`url` della scheda = indirizzo della pagina, per
 * cui su /carte il ristorante «si trovava» a /carte) era in sei copie: una
 * correzione sola non lo chiudeva. Da oggi c'e' un posto, e queste prove
 * sono quello che impedisce di riaprirlo.
 *
 * ⚠️ `schedaRistorante` sono REGOLE PURE e si provano chiamandole. Il
 * componente no — e' un `.astro` — e li' si legge il sorgente: quello che
 * conta e' COSA NON FA (non legge niente da se', non stampa niente su una
 * pagina `noindex`), e si vede nel file.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { schedaRistorante, briciole, orariSpecifica } from "../src/lib/seo/schedaRistorante.ts";

const PIENO = {
  radice: "https://www.esempio.be/",
  nome: "Chez Essai",
  descrizione: "Cucina italiana a Bruxelles.",
  immagine: "https://www.esempio.be/og/og.jpg",
  cucina: "Italian",
  fasciaPrezzo: "€€",
  valuta: "EUR",
  pagamenti: "Cash, Visa",
  telefono: "+32 2 000 00 00",
  email: "info@esempio.be",
  carta: "https://www.esempio.be/carte",
  prenotazioni: "https://www.esempio.be/reservation",
  indirizzo: { via: "Rue Essai 7/9", cap: "1150", comune: "Woluwe-Saint-Pierre", regione: "Bruxelles-Capitale", paese: "BE" },
  mappa: "https://www.google.com/maps/search/?api=1&query=Chez%20Essai",
  orari: [{ "@type": "OpeningHoursSpecification", dayOfWeek: "Monday" }],
  social: ["https://www.facebook.com/chezessai"],
};

test("⚠️ `@id` e `url` puntano alla RADICE, non alla pagina", () => {
  // Il difetto dell'11/10/2026: con `url` = canonico, ogni pagina dichiarava
  // un ristorante diverso allo stesso nome. La radice e' l'unica risposta
  // giusta su TUTTE le pagine.
  const s = schedaRistorante(PIENO);
  assert.equal(s.url, "https://www.esempio.be/");
  assert.equal(s["@id"], "https://www.esempio.be/#restaurant");
  // E la barra finale non e' un dettaglio: due `@id` diversi per lo stesso
  // locale sono due locali.
  const senzaBarra = schedaRistorante({ ...PIENO, radice: "https://www.esempio.be" });
  assert.equal(senzaBarra["@id"], s["@id"], "la radice senza barra finale fa nascere un secondo @id");
  assert.equal(senzaBarra.url, s.url);
});

test("\u26a0\ufe0f una PAGINA non prende la barra in piu'", () => {
  // Un marchio con tre pizzerie ha un nodo per pagina: `/schaerbeek`, non
  // `/schaerbeek/`. La barra la vuole solo la radice, dove `https://sito.be`
  // e `https://sito.be/` sono lo stesso posto e devono dare lo stesso `@id`.
  const s = schedaRistorante({ ...PIENO, radice: "https://www.esempio.be/schaerbeek" });
  assert.equal(s["@id"], "https://www.esempio.be/schaerbeek#restaurant");
  assert.equal(s.url, "https://www.esempio.be/schaerbeek");
  const conBarra = schedaRistorante({ ...PIENO, radice: "https://www.esempio.be/schaerbeek/" });
  assert.equal(conBarra["@id"], s["@id"], "la stessa pagina con e senza barra fa due locali");
});

test("l'indirizzo esce intero", () => {
  const s = schedaRistorante(PIENO);
  assert.deepEqual(s.address, {
    "@type": "PostalAddress",
    streetAddress: "Rue Essai 7/9",
    postalCode: "1150",
    addressLocality: "Woluwe-Saint-Pierre",
    addressRegion: "Bruxelles-Capitale",
    addressCountry: "BE",
  });
});

test("⚠️ l'indirizzo o INTERO o NIENTE", () => {
  // Général non compilato: `datiRistorante` rende i pezzi vuoti. Una
  // `PostalAddress` col solo paese dice «questo locale sta in Belgio», che
  // come indirizzo non vale niente e sporca la scheda.
  for (const rotto of [
    { via: "", cap: "1150", comune: "Woluwe-Saint-Pierre", paese: "BE" },
    { via: "Rue Essai 7/9", cap: "", comune: "   ", paese: "BE" },
  ]) {
    const s = schedaRistorante({ ...PIENO, indirizzo: rotto });
    assert.equal(s.address, undefined, `indirizzo a meta' pubblicato: ${JSON.stringify(rotto)}`);
  }
  // Senza indirizzo del tutto la scheda esce comunque: il resto vale.
  const senza = schedaRistorante({ ...PIENO, indirizzo: undefined });
  assert.equal(senza.address, undefined);
  assert.equal(senza.name, "Chez Essai");
});

test("il CAP manca ma via e comune ci sono: l'indirizzo esce senza CAP", () => {
  const s = schedaRistorante({
    ...PIENO,
    indirizzo: { via: "Rue Essai 7/9", cap: "", comune: "Woluwe-Saint-Pierre", paese: "BE" },
  });
  assert.deepEqual(s.address, {
    "@type": "PostalAddress",
    streetAddress: "Rue Essai 7/9",
    addressLocality: "Woluwe-Saint-Pierre",
    addressCountry: "BE",
  });
});

test("⚠️ `geo` solo con due numeri veri", () => {
  assert.equal(schedaRistorante(PIENO).geo, undefined, "geo esce senza coordinate");
  assert.equal(schedaRistorante({ ...PIENO, geo: { lat: null, lng: null } }).geo, undefined);
  assert.equal(schedaRistorante({ ...PIENO, geo: { lat: 50.83, lng: null } }).geo, undefined, "mezza coordinata e' un punto a caso");
  assert.deepEqual(schedaRistorante({ ...PIENO, geo: { lat: 50.83, lng: 4.43 } }).geo, {
    "@type": "GeoCoordinates",
    latitude: 50.83,
    longitude: 4.43,
  });
});

test("i campi vuoti non entrano nella scheda", () => {
  // In JSON-LD un `telephone: ""` e' peggio che niente: Google lo legge come
  // un dato, e il dato e' sbagliato.
  const s = schedaRistorante({ radice: "https://www.esempio.be/", nome: "Chez Essai", telefono: "  ", email: "", social: [] });
  assert.equal(s.telephone, undefined);
  assert.equal(s.email, undefined);
  assert.equal(s.sameAs, undefined, "un `sameAs` vuoto non dice «non ho social», dice «ho sbagliato la scheda»");
  assert.equal(s.name, "Chez Essai");
});

test("il tipo si puo' cambiare (non tutti i clienti sono ristoranti)", () => {
  assert.equal(schedaRistorante(PIENO)["@type"], "Restaurant");
  assert.equal(schedaRistorante({ ...PIENO, tipo: "CafeOrCoffeeShop" })["@type"], "CafeOrCoffeeShop");
});

test("le briciole: due voci, e `null` in home", () => {
  const casa = "https://www.esempio.be/";
  assert.equal(briciole({ casa, nomeSito: "Chez Essai", pagina: null }), null);
  assert.equal(
    briciole({ casa, nomeSito: "Chez Essai", pagina: { nome: "Carte", url: "https://www.esempio.be" } }),
    null,
    "la home con un'altra barra finale non e' un'altra pagina",
  );
  const b = briciole({ casa, nomeSito: "Chez Essai", pagina: { nome: "Carte", url: "https://www.esempio.be/carte" } });
  assert.equal(b["@type"], "BreadcrumbList");
  assert.deepEqual(b.itemListElement, [
    { "@type": "ListItem", position: 1, name: "Chez Essai", item: casa },
    { "@type": "ListItem", position: 2, name: "Carte", item: "https://www.esempio.be/carte" },
  ]);
});

/* ------------------------------------------------------------------ */
/* IL COMPONENTE: si legge il sorgente, e si guarda cosa NON fa.      */
/* ------------------------------------------------------------------ */

const TESTA = readFileSync("src/components/TestaSeo.astro", "utf8");
const FRONT = TESTA.slice(0, TESTA.indexOf("\n---", 3));
/** Senza commenti: qui sopra la parola `CLIENT` compare apposta, nel
 *  commento che spiega perche' non deve comparire nel codice. */
const senzaCommenti = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CODICE = senzaCommenti(FRONT);

test("⚠️ il componente non legge NIENTE da se'", () => {
  // E' la regola che decide se il giorno dell'app unica questo file va
  // riscritto: tutto entra dalle props, risolto da chi lo monta. Un `CLIENT`
  // qui dentro sarebbe una costante decisa in compilazione, cioe' un
  // ristorante solo per processo.
  assert.doesNotMatch(CODICE, /\bimport\b[^\n]*\bfrom\b/, "il componente importa qualcosa: le props sono l'unica porta");
  assert.doesNotMatch(CODICE, /\bCLIENT\b/, "il componente legge il config del cliente");
  assert.doesNotMatch(CODICE, /Astro\.(site|url|request)/, "il componente si costruisce gli indirizzi da se': glieli passa il telaio");
  // E la prova non deve passare a vuoto: il sorgente c'e' e le props si leggono.
  assert.match(CODICE, /Astro\.props/, "il componente non legge nemmeno le props: letto il file sbagliato?");
});

test("⚠️ su una pagina `noindex` non esce niente da indicizzare", () => {
  // Il canonico di ripiego su una 404 diceva a Google «questa pagina e' la
  // home», con tanto di scheda del ristorante dentro.
  const righe = TESTA.split("\n");
  for (const segno of ['rel="canonical"', "hreflang={a.lang}", 'property="og:url"']) {
    const riga = righe.find((r) => r.includes(segno));
    assert.ok(riga, `riga spariita dal componente: ${segno}`);
    assert.match(riga, /indicizza/, `${segno} esce anche su una pagina noindex`);
  }
  assert.match(
    CODICE,
    /schedeVere\s*=\s*indicizza\s*\?/,
    "i dati strutturati non sono piu' legati a `indicizza`: una scheda Restaurant su una 404 e' un secondo ristorante",
  );
});

test("\u26a0\ufe0f i `<` del JSON-LD escono neutralizzati", () => {
  // Un valore che contiene `</script>` chiude lo script: i dati arrivano dal
  // pannello, e basta che qualcuno incolli dell'HTML nel nome del locale.
  // `\\u003c` e' lo stesso carattere per chi legge il JSON e non e' piu' una
  // parentesi per chi legge l'HTML.
  assert.match(CODICE, /JSON\.stringify\(o\)\.replace\(/, "la funzione che neutralizza i `<` non c'e' piu'");
  const riga = TESTA.split("\n").find((r) => r.includes("application/ld+json"));
  assert.ok(riga, "la riga dei dati strutturati non c'e' piu'");
  assert.doesNotMatch(riga, /set:html=\{JSON\.stringify/, "il JSON-LD va in pagina senza neutralizzare i `<`");
});

test("`x-default` e' una delle alternative, non un indirizzo nuovo", () => {
  assert.match(CODICE, /alternative\.find\(/, "x-default non viene piu' cercato fra le alternative");
  assert.doesNotMatch(TESTA, /hreflang="x-default"\s+href=\{(?!xdef)/, "x-default punta a un indirizzo che non e' in elenco");
});

/* ------------------------------------------------------------------ */
/* GLI ORARI                                                          */
/* ------------------------------------------------------------------ */

const MARTEDI = {
  day_of_week: 2,
  lunch_active: true, lunch_open: "12:00:00", lunch_close: "14:30:00",
  dinner_active: true, dinner_open: "18:30:00", dinner_close: "22:00:00",
};

test("\u26a0\ufe0f due servizi fanno DUE righe, non una fascia sola", () => {
  // Unire pranzo e cena in un intervallo 12:00-22:00 dice a Google che alle
  // 16 si mangia. Non e' un errore in un file: e' qualcuno che arriva e
  // trova chiuso, dopo averlo letto sulla scheda.
  const o = orariSpecifica([MARTEDI]);
  assert.equal(o.length, 2);
  assert.deepEqual(o[0], { "@type": "OpeningHoursSpecification", dayOfWeek: "Tuesday", opens: "12:00", closes: "14:30" });
  assert.deepEqual(o[1], { "@type": "OpeningHoursSpecification", dayOfWeek: "Tuesday", opens: "18:30", closes: "22:00" });
});

test("i secondi non entrano nell'orario", () => {
  assert.equal(orariSpecifica([MARTEDI])[0].opens, "12:00", "schema.org vuole hh:mm");
});

test("0 e' DOMENICA, come nel database", () => {
  // Uno scarto di un giorno qui pubblica gli orari di tutta la settimana
  // spostati: nessun errore, e un cliente davanti alla porta ogni giorno.
  assert.equal(orariSpecifica([{ ...MARTEDI, day_of_week: 0 }])[0].dayOfWeek, "Sunday");
  assert.equal(orariSpecifica([{ ...MARTEDI, day_of_week: 6 }])[0].dayOfWeek, "Saturday");
});

test("un servizio senza ore si salta, non si inventa", () => {
  assert.deepEqual(orariSpecifica([{ day_of_week: 1, dinner_active: true, dinner_open: "18:30", dinner_close: null }]), []);
  assert.deepEqual(orariSpecifica([{ day_of_week: 1, lunch_active: false, lunch_open: "12:00", lunch_close: "14:00" }]), [],
    "un servizio spento non e' un orario di apertura");
  assert.deepEqual(orariSpecifica([{ day_of_week: 9, lunch_active: true, lunch_open: "12:00", lunch_close: "14:00" }]), [],
    "un giorno che non esiste non diventa domenica");
  assert.deepEqual(orariSpecifica([]), []);
});
