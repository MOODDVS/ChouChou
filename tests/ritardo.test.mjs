/**
 * IL RITARDO, E L'EMAIL CHE DICE «E' PRONTO».
 *
 * ⚠️ Le due cose che queste prove tengono chiuse hanno la stessa forma: un
 * messaggio giusto mandato nel momento sbagliato. «Votre commande est prete»
 * ricevuto a mezzanotte, col sacchetto gia' a casa, fa sembrare rotto tutto
 * il resto — e lo manda un bottone premuto in buona fede a fine serata.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { avvisaChePronto, ritardoAmmesso, RITARDI_MIN, FINESTRA_PRONTO_MIN } from "../src/lib/ordiniRegole.ts";

const leggi = (f) => readFileSync(f, "utf8");
const nudo = (f) => leggi(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ORA = Date.parse("2026-10-14T19:45:00.000Z");
const min = (n) => ORA + n * 60_000;

test("«c'e' pronto» si dice fino a mezz'ora dopo il ritiro, non oltre", () => {
  const iso = new Date(ORA).toISOString();
  // Prima dell'ora: la cucina ha finito in anticipo, ed e' una buona notizia.
  assert.equal(avvisaChePronto(iso, min(-120)), true, "la cucina in anticipo non puo' avvisare");
  assert.equal(avvisaChePronto(iso, min(0)), true);
  assert.equal(avvisaChePronto(iso, min(29)), true, "dentro la mezz'ora si avvisa ancora");
  assert.equal(avvisaChePronto(iso, min(FINESTRA_PRONTO_MIN)), true, "il minuto esatto e' ancora dentro");
  // ⚠️ Il caso vero: fine serata, si chiudono gli ordini rimasti aperti.
  assert.equal(avvisaChePronto(iso, min(31)), false,
    "si scrive «c'e' pronto» a chi e' gia' passato a ritirare");
  assert.equal(avvisaChePronto(iso, min(300)), false);
  // Una data illeggibile non e' «adesso»: senza il controllo, NaN farebbe
  // fallire il confronto e l'email partirebbe sempre.
  assert.equal(avvisaChePronto("non una data"), false);
  assert.equal(avvisaChePronto(null), false);
  assert.equal(avvisaChePronto(undefined), false);
});

test("i ritardi sono un elenco chiuso, e il server non si fida del bottone", () => {
  for (const m of RITARDI_MIN) assert.equal(ritardoAmmesso(m), true, `${m} doveva essere ammesso`);
  assert.equal(ritardoAmmesso(7), false, "un valore fuori elenco entra: il pannello e il server non dicono piu' la stessa cosa");
  // ⚠️ Il negativo ANTICIPEREBBE il ritiro, e il cliente riceverebbe un'email
  // che gli dice di correre.
  assert.equal(ritardoAmmesso(-10), false, "un ritardo negativo anticipa il ritiro");
  assert.equal(ritardoAmmesso(0), false);
  assert.equal(ritardoAmmesso("abc"), false);
  assert.equal(ritardoAmmesso(undefined), false);
});

test("l'elenco dei minuti esiste in UN posto solo", () => {
  // Scritto a mano nella pagina, un giorno il bottone offrirebbe un valore che
  // la rotta rifiuta: il ristoratore preme e non succede niente.
  const pagina = nudo("src/pages/admin/orders.astro");
  assert.match(pagina, /RITARDI_MIN/, "la pagina non chiede piu' l'elenco al motore");
  const rotta = nudo("src/pages/api/admin/order-delay.ts");
  assert.match(rotta, /ritardoAmmesso\(/, "la rotta non controlla piu' i minuti: accetterebbe qualsiasi numero");
});

test("l'email «c'e' pronto» parte solo da chi PREME, mai dal cron", () => {
  // ⚠️ Il cron chiude gli ordini rimasti aperti. Un'email partita da sola alle
  // tre di notte non la spiega nessuno.
  const cron = nudo("src/pages/api/cron/auto-complete-orders.ts");
  assert.doesNotMatch(cron, /emailOrdinePronto/,
    "il cron manda l'email «c'e' pronto»: partirebbe di notte, da sola, su ordini di ore prima");

  const rotta = nudo("src/pages/api/admin/orders.ts");
  assert.match(rotta, /emailOrdinePronto\(/, "la pressione su «Terminee» non avvisa piu' il cliente");
  // Le tre condizioni, tutte e tre nel ramo.
  assert.match(rotta, /avvisaChePronto\(/, "e' sparita la finestra della mezz'ora");
  assert.match(rotta, /prima\.status !== "done"/,
    "manca il controllo della transizione: ripremere il bottone manderebbe una seconda email");
});

test("il ritardo sposta l'ora vera, e non si somma due volte", () => {
  const rotta = nudo("src/pages/api/admin/order-delay.ts");
  // ⚠️ `pickup_time` lo leggono la colonna della Accueil, il semaforo dei
  // ritardatari e il ticket: una nota a margine non basterebbe.
  assert.match(rotta, /pickup_time:\s*dopoIso/, "il ritardo non sposta piu' l'ora di ritiro");
  // ⚠️ Due apparecchi che premono insieme sommerebbero due volte partendo
  // dalla stessa ora, e il secondo cancellerebbe il primo in silenzio.
  assert.match(rotta, /\.eq\("pickup_time", primaIso\)/,
    "manca la guardia sull'ora di partenza: due ritardi insieme si sovrascrivono");
  assert.match(rotta, /stato !== "paid" && stato !== "pending"/,
    "si puo' ritardare un ordine gia' consegnato o annullato");
  // L'ora di PRIMA arriva fino all'email: senza, il cliente non sa di quanto
  // e' cambiata.
  assert.match(rotta, /ora_prima:\s*primaIso/, "l'email del ritardo non dice piu' da che ora si parte");
});

test("le due email nuove passano da spedisci(), come tutte le altre", () => {
  // ⚠️ Il client di Resend NON lancia: senza `spedisci` un rifiuto sarebbe
  // muto, ed e' il difetto che il 13/10 era in venticinque invii.
  const n = leggi("src/lib/notifications.ts");
  const i = n.indexOf("async function emailStatoOrdine");
  assert.ok(i > 0, "la funzione comune delle due email di stato e' sparita");
  const corpo = n.slice(i, n.indexOf("export async function emailOrdinePronto"));
  assert.match(corpo, /await spedisci\(/,
    "le email di stato non passano da spedisci(): un rifiuto di Resend resterebbe muto");
  // Una sola funzione per due testi: scritte separate, la seconda nascerebbe
  // copiando la prima e il piede resterebbe indietro.
  assert.match(n, /emailStatoOrdine\(o, "pronto"\)/);
  assert.match(n, /emailStatoOrdine\(o, "ritardo"/);
});
