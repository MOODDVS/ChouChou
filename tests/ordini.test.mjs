/**
 * COME SI PAGA UN ORDINE — le regole che non devono cambiare da sole.
 *
 * ⚠️ Fino al 29/09/2026 il motore sapeva fare una cosa sola: si ordina e si
 * paga con la carta. Da qui in avanti sa farne due, e la seconda — si ordina
 * ora, si paga in cassa al ritiro — ha un difetto naturale: assomiglia a un
 * carrello abbandonato. Sono due righe `pending` che si distinguono per una
 * colonna sola. Sbagliare quella distinzione vuol dire o una lista piena di
 * carrelli mai confermati, o un ordine vero che non compare da nessuna parte.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
// ⚠️ Si importa `ordiniRegole`, NON `ordiniOpzioni`: il secondo arriva a
// `db.ts`, che in vitest lancia all'import — e un file di prova che non parte
// viene contato come «0 test», cioe' verde. Vedi ENGINE.md.
import { acceso, RIPIEGO_ORDINI, CHIAVI_ORDINI } from "../src/lib/ordiniRegole.ts";

const leggi = (f) => readFileSync(f, "utf8");

test("chi non ha mai visto queste opzioni si comporta come ieri", () => {
  // ⚠️ I cinque clienti di oggi non hanno nessuna di queste righe nel
  // database. Se il ripiego cambiasse, un ristorante si troverebbe il
  // pagamento con carta spento — o peggio acceso uno che non lo vuole — da
  // un merge, senza aver toccato niente.
  assert.equal(acceso(undefined, "orders_pay_online"), true);
  assert.equal(acceso(undefined, "orders_pay_onsite"), false);
  assert.equal(acceso(undefined, "orders_coupons"), true);
  assert.deepEqual(Object.keys(RIPIEGO_ORDINI).sort(), [...CHIAVI_ORDINI].sort());
});

test("un valore storto ricade sul ripiego, non su «spento»", () => {
  // ⚠️ Una riga scritta a mano nel database, o rimasta da una versione
  // precedente, non deve spegnere gli ordini di un ristorante: «si», «true» e
  // «» non sono interruttori, e valgono quanto una riga che non c'e'.
  for (const v of ["si", "true", "oui", "", "  ", null, undefined, {}]) {
    assert.equal(acceso(v, "orders_pay_online"), true, `valore: ${String(v)}`);
    assert.equal(acceso(v, "orders_pay_onsite"), false, `valore: ${String(v)}`);
  }
  assert.equal(acceso("1", "orders_pay_onsite"), true);
  assert.equal(acceso("0", "orders_pay_online"), false);
  // Gli spazi intorno non cambiano cosa ha chiesto il ristoratore.
  assert.equal(acceso(" 1 ", "orders_pay_onsite"), true);
  // ⚠️ Il NUMERO 1 non e' un valore storto: `app_config.value` e' testo, ma
  // un 1 arrivato come numero da un JSON dice la stessa cosa della stringa
  // "1", e leggerlo come «spento» spegnerebbe un interruttore che qualcuno
  // aveva acceso. (La prova prima lo elencava fra gli storti: aveva torto
  // lei, non la regola.)
  assert.equal(acceso(1, "orders_pay_onsite"), true);
  assert.equal(acceso(0, "orders_pay_online"), false);
});

test("il checkout chiede come si paga PRIMA di creare l'ordine", () => {
  const src = leggi("src/pages/api/checkout.ts");
  const iModi = src.indexOf("modiDiPagamento(");
  const iInsert = src.indexOf('inserisci("orders"');
  assert.ok(iModi > 0, "il checkout non guarda piu' i modi di pagamento");
  assert.ok(iInsert > 0, "il checkout non crea piu' l'ordine (?)");
  assert.ok(
    iModi < iInsert,
    "l'ordine si crea prima di sapere se qui si puo' pagare: con tutto spento nascerebbe un ordine che nessuno onorera'",
  );
  // ⚠️ E il caso «nessuno dei due» si dice, non si subisce: senza questo il
  // carrello arriverebbe in fondo e si fermerebbe li' senza spiegazioni.
  assert.match(src, /modi\.nessuno/);
});

test("l'ordine da incassare si riconosce dalla riga, non dalla configurazione", () => {
  // ⚠️ La tentazione era filtrare con «se il locale ha spento il pagamento
  // online allora mostra i pending»: sbagliato, perche' un locale puo' avere
  // accesi tutti e due, e allora avrebbe insieme ordini da incassare e
  // carrelli abbandonati. Li distingue `payment_method`, che sta sulla riga.
  assert.match(leggi("src/pages/api/checkout.ts"), /payment_method: "onsite"/);
  assert.match(leggi("src/pages/api/admin/orders.ts"), /eq\("payment_method", "onsite"\)/);
  assert.match(leggi("src/pages/admin/orders.astro"), /payment_method\.eq\.onsite/);
});

test("chi ordina senza pagare viene annunciato lo stesso", () => {
  // ⚠️ Senza Stripe non c'e' nessun webhook, e l'annuncio — email al cliente,
  // email alla cucina, notifica — non lo farebbe nessuno: l'ordine
  // resterebbe una riga nel database mentre il cliente aspetta la sua pizza.
  const src = leggi("src/pages/api/checkout.ts");
  assert.match(src, /annunciaOrdine\(/);
  const iCassa = src.indexOf("if (inCassa) {");
  const iAnnuncio = src.indexOf("annunciaOrdine(", iCassa);
  assert.ok(iCassa > 0 && iAnnuncio > iCassa, "l'annuncio non e' piu' nel ramo dell'ordine in cassa");
});

test("solo un ordine nato per la cassa puo' diventare pagato dal pannello", () => {
  // ⚠️ Il resto dei `pending` sono carrelli abbandonati: segnarli pagati
  // sarebbe inventare un incasso, e le statistiche lo riporterebbero.
  const src = leggi("src/pages/api/admin/orders.ts");
  assert.match(src, /const daIncassare\s*=/);
  assert.match(src, /String\(prima\?\.payment_method \?\? ""\) === "onsite"/);
  assert.match(src, /status !== "cancelled" && !\(status === "paid" && daIncassare\)/);
});

test("spegnere tutti i pagamenti non si puo'", () => {
  // ⚠️ Sarebbe un sito che accetta ordini fino all'ultimo bottone e poi si
  // ferma, senza che niente lo dica. Si rifiuta al salvataggio, che e'
  // l'unico momento in cui c'e' una persona davanti allo schermo.
  const src = leggi("src/pages/api/admin/settings.ts");
  assert.match(src, /!vuole\("orders_pay_online"\) && !vuole\("orders_pay_onsite"\)/);
  assert.match(src, /err\.noPayment/);
});

test("volere il pagamento con carta non basta: ci vuole il conto", () => {
  // ⚠️ Un interruttore acceso su un conto Stripe che non esiste e' una
  // promessa che il checkout non puo' mantenere: il cliente arriverebbe a un
  // errore di pagamento senza capire perche'.
  const src = leggi("src/lib/ordiniOpzioni.ts");
  assert.match(src, /const online = volute\.online && stripePronto;/);
});

test("il coupon in cassa e' una scelta del ristoratore, non un automatismo", () => {
  // ⚠️ Online lo sconto lo applica il sistema; in cassa deve applicarlo una
  // persona mentre c'e' fila. Se il ristoratore non lo vuole, il campo del
  // codice sparisce appena il cliente sceglie di pagare al ritiro — e il
  // server RIFIUTA un codice arrivato lo stesso, invece di ignorarlo in
  // silenzio: il cliente ha visto un totale scontato sullo schermo.
  assert.equal(acceso(undefined, "orders_coupons_onsite"), false);
  const chk = leggi("src/pages/api/checkout.ts");
  assert.match(chk, /const couponAmmesso = modi\.coupon && \(!inCassa \|\| modi\.couponInCassa\);/);
  assert.match(chk, /TXT_COUPON_SOLO_ONLINE/);
  // Vale solo se ENTRAMBI gli interruttori sono accesi.
  assert.match(leggi("src/lib/ordiniOpzioni.ts"), /couponInCassa: volute\.coupon && volute\.couponInCassa/);
});

test("la comanda non dice «pagato» su un ordine da incassare", () => {
  // ⚠️ E' la bugia che costa denaro: chi consegna legge la pastiglia verde,
  // da' la pizza e non chiede niente. Con l'importo DENTRO la pastiglia, la
  // cifra da chiedere si trova senza cercarla.
  const n = leggi("src/lib/notifications.ts");
  assert.match(n, /da_incassare\?: boolean;/);
  assert.match(n, /const pastigliaPagamento = o\.da_incassare/);
  assert.match(n, /\$\{k\.toCollect\} · \$\{euro\(o\.total_cents\)\}/);
  // E il cliente deve sapere di uscire con i contanti.
  assert.match(n, /o\.da_incassare \? t\.payAtPickup : t\.total/);
  // L'ordine in cassa lo dichiara: senza, la riga direbbe solo `pending`.
  assert.match(leggi("src/pages/api/checkout.ts"), /annunciaOrdine\(ordine, true\)/);
});

test("con due strade aperte, la carta e' quella preselezionata", () => {
  // ⚠️ E' la strada in cui l'incasso e' gia' fatto quando la pizza esce. Chi
  // vuole pagare al ritiro lo dice con un tocco.
  const app = leggi("src/components/OrderApp.tsx");
  assert.match(app, /useState<"online" \| "onsite">\(\s*pagamento\.online \? "online" : "onsite",?\s*\)/);
  // La scelta compare solo dove c'e' da scegliere...
  assert.match(app, /const scegliePagamento = pagamento\.online && pagamento\.locale;/);
  // ...e il ripiego e' il comportamento di sempre, per i siti che non la
  // passano: niente elementi nuovi e nudi il giorno del merge.
  assert.match(app, /pagamento = \{ online: true, locale: false, coupon: true, couponInCassa: false \}/);
  // Pagando al ritiro il bottone non promette un pagamento che non avviene.
  assert.match(app, /pagaInCassa \? \(invio \? tp\.ordinando : tp\.ordina\)/);
});

test("questa rete non dipende dal database (o non parte, e non lo dice nessuno)", () => {
  // ⚠️ E' l'errore fatto scrivendo questo file, il 29/09/2026: le prove
  // importavano `ordiniOpzioni`, che arriva a `db.ts`, che LANCIA all'import
  // quando mancano le variabili Supabase — come in vitest. Risultato: «0
  // test», che nell'elenco sembra una riga verde. Era gia' successo con
  // `slots.test.ts`, sedici prove ferme per mesi.
  //
  // Questa guardia non puo' proteggersi da sola (se il file non parte, non
  // gira nemmeno lei): protegge il file DI REGOLE, che e' la ragione per cui
  // le prove sopra riescono a partire.
  const regole = readFileSync("src/lib/ordiniRegole.ts", "utf8");
  const importa = [...regole.matchAll(/^\s*import\s.+from\s+["'][^"']+["']/gm)].map((m) => m[0]);
  assert.deepEqual(
    importa,
    [],
    "ordiniRegole.ts ha un import: se porta a db.ts, le prove qui sopra smettono di partire e vitest le conta come zero",
  );
  assert.match(regole, /export function acceso/);
});
