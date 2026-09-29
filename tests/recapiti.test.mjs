/**
 * I RECAPITI DEL RISTORANTE NON SI SCRIVONO NEL CODICE.
 *
 * ⚠️ IL GUASTO CHE QUESTA RETE CHIUDE (29/09/2026)
 *
 * ChouChou e L'Huile pubblicavano il NUMERO DI TELEFONO DI LA MOLISANA. La
 * pagina `/order` mostra, fuori orario, un riquadro «gli ordini sono chiusi,
 * chiamateci» con un bottone: quel numero era scritto a mano, ed era arrivato
 * col clone — quelle pagine nascono copiate da La Molisana, il cliente da cui
 * il motore e' nato, e nessuno l'aveva piu' guardato.
 *
 * Sei pagine su due clienti, per mesi. Nessun errore, nessuna riga nei log, e
 * visibile solo quando il servizio e' chiuso — cioe' quando nessuno guarda.
 * Chi provava a ordinare la sera telefonava a un altro ristorante.
 *
 * Lo stesso giorno, la stessa forma altre due volte: La Molisana pubblicava
 * DUE email diverse (`pizzeria@` nel footer, `info@` nella pagina contatti e
 * nei dati strutturati letti da Google), e tre pagine avevano il fuso orario
 * scritto a mano. Tre difetti, una sola causa: un dato del ristorante copiato
 * dentro il codice al momento del clone, e mai piu' toccato.
 *
 * ⚠️ E NON LI HA TROVATI NESSUNA PROVA. Le reti esistenti sorvegliano le
 * CHIAVI di `app_config` — che siano lette con l'ambito giusto, che una chiave
 * di sede non sia letta a livello marchio. Nessuna guardava i VALORI scritti
 * nel sito del cliente, che e' dove il clone li lascia.
 *
 * LA REGOLA. I recapiti veri stanno nell'admin (Reglages -> General) e si
 * leggono con `datiRistorante(ambito)`, come fanno footer e dati strutturati.
 * Nel codice ne esiste UNA copia sola, dichiarata: il ripiego in
 * `src/config/client.ts`, che serve a quando il database non risponde.
 *
 * ⚠️ Questa rete gira ANCHE nei clienti, ed e' li' che serve: il motore un
 * sito non ce l'ha, quindi da solo non proteggerebbe nessuno.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Un telefono internazionale: `+32 455 13 14 65`, `+32455131465`, `+33.1.42…` */
const TELEFONO = /\+\d{2}[\s.]?\d[\d\s.]{6,}\d/;
/** Un indirizzo email. */
const EMAIL = /[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * Dove si guarda: il SITO PUBBLICO del cliente.
 *
 * ⚠️ Fuori `src/config/client.ts`: e' il ripiego, ed e' il suo mestiere
 * contenere quei valori. Fuori l'admin: li' un recapito scritto in un esempio
 * non lo vede nessun cliente. Fuori `src/lib/`: e' codice del motore.
 */
const CARTELLE = ["src/pages", "src/components", "src/layouts"];

/**
 * Le pagine LEGALI possono nominare un recapito, ed e' il loro mestiere.
 *
 * ⚠️ Un'informativa privacy DEVE dire a chi si scrive per esercitare i propri
 * diritti, e un testo di legge non si compila da una tabella: e' un documento,
 * non un'interfaccia. Pretendere `datiRistorante()` li' dentro vorrebbe dire
 * un testo legale che cambia da solo — un'altra discussione, e peggiore.
 */
const LEGALI = /privacy|cookies|legal|terms|condizioni|mentions/i;

/**
 * Le eccezioni dichiarate, con il perche' accanto. Devono essere poche: ogni
 * riga qui e' un recapito che vive in due posti, e due posti prima o poi
 * divergono.
 */
const AMMESSI = {
  // (vuoto: oggi nessun cliente ne ha bisogno)
};

/** Via i commenti: una rete non deve leggere le frasi che la descrivono. */
function soloCodice(t) {
  return t
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

function fileDelSito() {
  const trovati = [];
  function scorri(dir) {
    let voci;
    try { voci = readdirSync(dir); } catch { return; }
    for (const nome of voci) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) { if (nome !== "admin") scorri(p); }
      else if (/\.(astro|ts|tsx)$/.test(nome)) trovati.push(p);
    }
  }
  for (const base of CARTELLE) scorri(base);
  return trovati;
}

/** I recapiti scritti a mano in un file, tolti i commenti e i domini nostri. */
function recapitiScrittiAMano(f) {
  const src = soloCodice(readFileSync(f, "utf8"));
  const trovati = [];
  for (const rx of [TELEFONO, EMAIL]) {
    for (const m of src.matchAll(new RegExp(rx, "g"))) {
      const v = m[0];
      // I nostri: MOODD e' il fornitore, non il ristorante. E i segnaposto
      // dichiarati tali non ingannano nessuno.
      if (/moodd|example\.(com|org)|@sentry|\.png|\.jpg|\.svg|\.webp/i.test(v)) continue;
      trovati.push(v);
    }
  }
  return [...new Set(trovati)];
}

test("la rete vede davvero un recapito (le prove sotto non passano a vuoto)", () => {
  // ⚠️ Senza questa, bastava un errore nelle espressioni per rendere tutto
  // verde per sempre — e nessuno se ne sarebbe accorto.
  assert.match("+32 455 13 14 65", TELEFONO);
  assert.match("+32455131465", TELEFONO);
  assert.match("info@comptoirchouchou.be", EMAIL);
  // E NON deve vedere cose che recapiti non sono.
  assert.doesNotMatch("+32", TELEFONO);
  assert.doesNotMatch("2026-09-29", EMAIL);
  assert.ok(fileDelSito().length >= 1, "non si legge piu' nessun file del sito");
});

test("nessun recapito del ristorante e' scritto a mano nel sito", () => {
  const colpevoli = [];
  for (const f of fileDelSito()) {
    if (LEGALI.test(f)) continue;
    const ammessi = AMMESSI[f] ?? [];
    for (const v of recapitiScrittiAMano(f)) {
      if (ammessi.includes(v)) continue;
      colpevoli.push(`${f}: ${v}`);
    }
  }
  assert.deepEqual(
    colpevoli.sort(),
    [],
    "un recapito scritto a mano arriva col clone e non lo ricontrolla nessuno: " +
      "si legge con `datiRistorante(ambito)`, il ripiego sta in config/client.ts\n  " +
      colpevoli.join("\n  "),
  );
});

test("le eccezioni dichiarate esistono ancora", () => {
  const morte = [];
  for (const [f, valori] of Object.entries(AMMESSI)) {
    let presenti;
    try { presenti = recapitiScrittiAMano(f); } catch { morte.push(`${f}: il file non c'e' piu'`); continue; }
    for (const v of valori) if (!presenti.includes(v)) morte.push(`${f}: ${v}`);
  }
  assert.deepEqual(morte, [], "dichiarati ammessi ma non ci sono piu': toglili dall'elenco");
});
