/**
 * IL MODULO DI CONTATTO — che il tranello antispam serva a qualcosa.
 *
 * ⚠️ Difetto vero, trovato l'11/10/2026 col primo sito online: il modulo
 * aveva il campo invisibile, il sito lo spediva, e qui non lo guardava
 * nessuno. Una trappola senza nessuno che controlla la gabbia.
 *
 * Perche' conta piu' della posta indesiderata: ogni invio buono manda DUE
 * email, una al ristorante e una all'indirizzo SCRITTO NEL MODULO. Senza il
 * controllo, chiunque puo' far spedire al dominio verificato del ristorante
 * un'email vestita col suo logo a un indirizzo scelto da lui — e quando la
 * reputazione del mittente si rovina, a non arrivare piu' sono anche le
 * conferme di prenotazione vere.
 *
 * ⚠️ Si legge il SORGENTE e non si chiama l'endpoint: `contact.ts` crea il
 * client Resend e legge la configurazione quando il modulo viene importato.
 * Quello che qui conta e' un ORDINE — il controllo prima dell'invio — e
 * l'ordine si vede nel file.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/pages/api/contact.ts", "utf8");

test("il tranello viene letto", () => {
  assert.match(SRC, /body\.societe/, "nessuno legge piu' il campo trappola");
});

test("⚠️ la chiave e' `societe`, NON `website`", () => {
  // Nel modulo il campo si chiama `website`; la chiave spedita resta
  // `societe`. Non e' una svista da raddrizzare: quando il CAMPO si chiamava
  // `societe`, Chrome lo riempiva da solo con l'organizzazione dell'utente e
  // il server buttava via i messaggi veri. Chi "sistema" questa differenza
  // rimette il guasto.
  assert.doesNotMatch(SRC, /body\.website/, "il sito spedisce `societe`: con `website` il tranello resta sempre vuoto");
});

test("il controllo sta PRIMA di ogni invio", () => {
  const controllo = SRC.indexOf("if (tranello)");
  const primoInvio = SRC.indexOf("resend.emails.send");
  assert.ok(controllo > 0, "il controllo non c'e' piu'");
  assert.ok(primoInvio > 0, "l'invio non c'e' piu': questa prova passerebbe a vuoto");
  assert.ok(controllo < primoInvio, "il tranello viene controllato DOPO aver gia' mandato le email");
});

test("a chi cade nel tranello si risponde OK, non errore", () => {
  // ⚠️ Il 200 non e' una svista: a un robot che riceve «errore» resta da
  // capire quale campo lo ha tradito, e riprova. A uno che riceve «grazie,
  // ricevuto» non resta niente da capire.
  const da = SRC.indexOf("if (tranello)");
  const ramo = SRC.slice(da, da + 400);
  assert.match(ramo, /status:\s*200/, "al tranello si risponde con un errore: dice al robot che e' stato scoperto");
  assert.doesNotMatch(ramo.split("}")[0] + "}", /resend/, "nel ramo del tranello si manda ancora qualcosa");
});

test("il consenso: letto, e rifiutato solo se dice NO", () => {
  assert.match(SRC, /"cgu" in body/, "il consenso non viene piu' letto");
  // ⚠️ Mancante NON vuol dire rifiutato: oggi solo alcuni moduli lo
  // spediscono, e un controllo rigido spegnerebbe il contatto degli altri.
  assert.match(SRC, /consensoDato === false/, "si rifiuta anche chi non lo manda: i moduli che non lo spediscono smettono di funzionare");
  assert.doesNotMatch(SRC, /if\s*\(\s*!consensoDato\s*\)/, "`!consensoDato` e' vero anche quando il campo manca");
});
