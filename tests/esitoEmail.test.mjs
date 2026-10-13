/**
 * L'ESITO DI UN INVIO EMAIL — che un rifiuto si veda. TUTTE le email.
 *
 * ⚠️ Difetto vero, 13/10/2026: un cliente si manda il test della newsletter
 * prima di spedirla a tutti, e «non funziona». Il pannello scriveva «Test
 * envoyé à …» e l'email non arrivava, senza un motivo da nessuna parte.
 *
 * ⚠️ LA CAUSA, che e' quella che queste prove tengono chiusa: il client di
 * Resend NON LANCIA ECCEZIONI quando l'API rifiuta un'email. Rende
 * `{ data, error }`. Un `try/catch` intorno non vede niente, e
 * `await resend.emails.send(...)` senza guardare il risultato vuol dire
 * «mandata» anche quando Resend ha risposto «dominio non verificato».
 *
 * ⚠️ E NON ERA SOLO IL TEST. Lo stesso modo di scrivere stava in tutte e
 * ventuno le email di `notifications.ts`: conferme di prenotazione, ordini,
 * buoni, annullamenti. Con la configurazione di un cliente rotta, le sue
 * conferme non partivano e da nessuna parte risultava che non erano
 * partite — il bottone di test era l'unico posto dove qualcuno guardava.
 * Queste prove valgono per le ventidue insieme.
 *
 * Due piani: la regola che legge il motivo si CHIAMA; che il motivo venga
 * poi guardato davvero si legge nel SORGENTE — e' un ordine fra due righe,
 * e l'ordine si vede nel file.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { motivoInvio } from "../src/lib/esitoEmail.ts";

test("un invio andato bene non ha motivi", () => {
  assert.equal(motivoInvio({ data: { id: "abc" }, error: null }), null);
  assert.equal(motivoInvio({}), null);
  assert.equal(motivoInvio(null), null);
  assert.equal(motivoInvio(undefined), null);
});

test("⚠️ il rifiuto di Resend esce in chiaro, col codice", () => {
  // Il caso vero piu' frequente: il mittente scritto nei Réglages non sta nel
  // dominio verificato. E' una cosa che il ristoratore sistema da se' in
  // trenta secondi — SE gliela diciamo.
  const m = motivoInvio({
    data: null,
    error: { message: "The example.be domain is not verified.", name: "validation_error", statusCode: 403 },
  });
  assert.match(m, /not verified/);
  assert.match(m, /validation_error/, "il tipo d'errore serve a capire dove guardare");
  assert.match(m, /403/, "il codice serve a distinguere un rifiuto da un limite");
});

test("un errore senza messaggio non diventa una riga vuota", () => {
  // Una stringa vuota a schermo e' peggio di un messaggio tecnico: sembra che
  // sia andato tutto bene.
  assert.equal(motivoInvio({ error: { name: "rate_limit_exceeded", statusCode: 429 } }), "rate_limit_exceeded (429)");
  assert.equal(motivoInvio({ error: { statusCode: 500 } }), "Refusé par Resend (500)");
  assert.ok(motivoInvio({ error: {} }), "un errore senza niente dentro resta un errore");
});

test("il nome non si ripete quando e' gia' nel messaggio", () => {
  const m = motivoInvio({ error: { message: "validation_error: champ invalide", name: "validation_error" } });
  assert.equal(m.match(/validation_error/g).length, 1);
});

/* ------------------------------------------------------------------ */
/* CHE IL MOTIVO VENGA GUARDATO: si legge nel sorgente.               */
/* ------------------------------------------------------------------ */

const SEND = readFileSync("src/lib/newsletterSend.ts", "utf8");
const API = readFileSync("src/pages/api/admin/newsletter.ts", "utf8");

test("⚠️ nessun invio della newsletter ignora l'esito", () => {
  // La riga «await resend.emails.send(...)» da sola e' il difetto: dice
  // «mandata» a prescindere. Ogni invio qui dentro deve finire in una
  // variabile che passa da `motivoInvio`.
  const righe = SEND.split("\n");
  const invii = righe.filter((r) => /resend\.(emails|batch)\.send\(/.test(r));
  assert.ok(invii.length >= 2, "gli invii sono spariti dal file: queste prove non guardano piu' niente");
  for (const r of invii) {
    assert.match(r, /=\s*await\s+resend\./, `esito buttato via: ${r.trim()}`);
  }
  // Una chiamata a `motivoInvio` per ogni invio: il controllo non si fa «in
  // generale», si fa su quella riga.
  const controlli = (SEND.match(/motivoInvio\(/g) ?? []).length;
  assert.ok(
    controlli >= invii.length,
    `${invii.length} invii ma ${controlli} controlli: qualche invio non guarda il proprio esito`,
  );
});

test("⚠️ le letture del test stanno DENTRO il try", () => {
  // Stavano fuori: se `datiRistorante` o `temaEmail` saltavano, l'eccezione
  // usciva dall'API come 500 con una pagina HTML, e il pannello mostrava
  // «errore di connessione» — che manda a cercare il guasto nella rete.
  const corpo = SEND.slice(SEND.indexOf("export async function inviaTest"));
  const fine = corpo.indexOf("\n}\n");
  const dentro = corpo.slice(0, fine);
  const posTry = dentro.indexOf("try {");
  for (const lettura of ["datiRistorante(SEDE_UNICA)", "temaEmail()", "logoNewsletter(", "mittenteNewsletter()"]) {
    const p = dentro.indexOf(lettura);
    assert.ok(p > posTry && posTry !== -1, `\`${lettura}\` sta fuori dal try: un suo errore diventa un 500 muto`);
  }
});

test("⚠️ l'API mostra il motivo, non solo «impossibile»", () => {
  assert.match(API, /esito\.motivo/, "l'API ha smesso di passare il motivo al pannello");
  assert.doesNotMatch(
    API,
    /const ok = await inviaTest/,
    "`inviaTest` e' tornata a rendere un si'/no: il perche' si perde di nuovo",
  );
});

/* ------------------------------------------------------------------ */
/* LE EMAIL TRANSAZIONALI: nessuna esce senza passare dal controllo.  */
/* ------------------------------------------------------------------ */

const NOTIF = readFileSync("src/lib/notifications.ts", "utf8");

test("⚠️ in notifications.ts nessuno chiama Resend direttamente", () => {
  // Il passaggio obbligato e' `spedisci()`. Una riga che chiama il client
  // diretta salta il controllo, e dentro `spedisci` c'e' l'unica chiamata
  // che deve esistere.
  const righe = NOTIF.split("\n");
  const dirette = righe
    .map((r, i) => [i + 1, r])
    .filter(([, r]) => /\bresend\.emails\.send\(/.test(r) && !/^\s*(\*|\/\/)/.test(r));
  assert.equal(
    dirette.length,
    1,
    `invii che saltano \`spedisci()\`: ${dirette.map(([n, r]) => `riga ${n}: ${r.trim()}`).join(" | ")}`,
  );
  const [[riga]] = dirette;
  const corpo = NOTIF.slice(NOTIF.indexOf("async function spedisci("));
  assert.match(
    corpo.slice(0, corpo.indexOf("\n}\n")),
    /resend\.emails\.send\(opzioni\)/,
    `l'unica chiamata diretta (riga ${riga}) non e' quella dentro \`spedisci\``,
  );
});

test("⚠️ tutte le email del motore passano dal controllo", () => {
  // Ventuno: se qualcuno ne aggiunge una e la scrive alla vecchia maniera,
  // questa prova non la vede — ma la precedente si'. Qui si controlla che
  // nessuna di quelle di oggi sia tornata indietro.
  const quante = (NOTIF.match(/await spedisci\(/g) ?? []).length;
  assert.ok(quante >= 21, `erano 21 email dal controllo, adesso ${quante}`);
  // E ognuna si riconosce nel log: senza etichetta, «refusé par Resend»
  // costringe a indovinare quale delle ventuno.
  for (const senzaNome of NOTIF.match(/await spedisci\(\s*[^"']/g) ?? []) {
    assert.fail(`invio senza etichetta: ${senzaNome.trim()}`);
  }
});

test("⚠️ `spedisci` guarda l'esito e lo scrive nel log", () => {
  const corpo = NOTIF.slice(NOTIF.indexOf("async function spedisci("));
  const dentro = corpo.slice(0, corpo.indexOf("\n}\n"));
  assert.match(dentro, /motivoInvio\(esito\)/, "`spedisci` non legge piu' il motivo");
  assert.match(dentro, /console\.error/, "il motivo non finisce nel log: nessuno lo vedrebbe");
  assert.match(dentro, /return esito/, "l'esito non torna al chiamante (emailReviewResa ne legge l'id)");
});
