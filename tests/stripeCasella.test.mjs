/**
 * Intégrations → la casella Stripe (5/11/2026). Le regole pure, i tre
 * livelli (sede → marchio → .env) e le protezioni: niente segreti in
 * risposta, solo super admin, mai in chiaro, webhook creato accanto alla
 * chiave.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  chiaveStripeValida, chiavePubblicabile, firmaValida, modoChiave, chiaveStripeMascherata,
  urlWebhook, webhookGiusto, livelloStripe, EVENTI_WEBHOOK, PERCORSO_WEBHOOK,
} from "../src/lib/admin/stripeRegole.ts";

const SK = "sk_live_51AbCdEfGhIjKlMnOpQrSt4f2a";

test("le chiavi: forma, modo, e mai intere", () => {
  assert.ok(chiaveStripeValida(SK));
  assert.ok(chiaveStripeValida("rk_test_51AbCdEfGhIjKlMnOpQrSt"));
  assert.ok(!chiaveStripeValida("pk_live_51AbCdEfGhIjKlMnOpQrSt"));
  assert.ok(chiavePubblicabile("pk_live_51AbCdEfGhIjKlMnOpQrSt"));
  assert.ok(!chiaveStripeValida("sk_live_corta"));
  assert.ok(firmaValida("whsec_AbCdEfGhIjKlMnOpQrStUv12"));
  assert.ok(!firmaValida("sk_live_AbCdEfGhIjKlMnOpQrStUv"));
  assert.equal(modoChiave(SK), "live");
  assert.equal(modoChiave("rk_test_x"), "test");
  assert.equal(chiaveStripeMascherata(SK), "sk_live_••••4f2a");
  assert.ok(!chiaveStripeMascherata(SK).includes("51AbCd"));
  assert.equal(chiaveStripeMascherata(""), "");
});

test("il webhook: indirizzo esatto online, percorso in locale, eventi, spento", () => {
  assert.equal(urlWebhook("https://villa77.be/"), "https://villa77.be" + PERCORSO_WEBHOOK);
  const ok = { id: "we_1", url: "https://villa77.be/api/stripe-webhook", status: "enabled", enabled_events: [...EVENTI_WEBHOOK] };
  assert.deepEqual(webhookGiusto([ok], "https://villa77.be", true), { stato: "ok", id: "we_1", domini: ["villa77.be"] });
  assert.equal(webhookGiusto([{ ...ok, enabled_events: ["*"] }], "https://villa77.be", true).stato, "ok");
  assert.equal(webhookGiusto([{ ...ok, enabled_events: ["charge.succeeded"] }], "https://villa77.be", true).stato, "eventi");
  assert.equal(webhookGiusto([{ ...ok, status: "disabled" }], "https://villa77.be", true).stato, "spento");
  assert.equal(webhookGiusto([ok], "https://altro.be", true).stato, "assente");
  // In locale il sito vero non si conosce: conta il percorso, e si dice il dominio.
  assert.deepEqual(webhookGiusto([ok], "http://localhost:4321", false).domini, ["villa77.be"]);
  assert.equal(webhookGiusto([ok], "http://localhost:4321", false).stato, "ok");
  assert.equal(webhookGiusto(null, "https://villa77.be", true).stato, "ignoto");
});

test("il segno della casella: con le sedi contano le sedi", () => {
  const l = (id, pronto, fc = "marchio", ff = "marchio") => ({ id, nome: id, fonteChiave: fc, fonteFirma: ff, pronto });
  assert.equal(livelloStripe([l("marchio", true)]).livello, "ok");
  assert.equal(livelloStripe([l("marchio", true, "ambiente", "ambiente")]).livello, "parz"); // via .env
  assert.equal(livelloStripe([l("marchio", false, "nessuna")]).livello, "no");
  const tre = [l("marchio", true), l("a", true, "sede", "sede"), l("b", true), l("c", false, "sede", "marchio")];
  assert.deepEqual(livelloStripe(tre), { livello: "parz", pronti: 2, totale: 3, daEnv: false });
});

test("i tre livelli: sede → marchio → .env, e una riga illeggibile non scende", () => {
  const sede = readFileSync("src/lib/admin/sede.ts", "utf8");
  assert.match(sede, /export async function segretoDelMarchio\(/);
  assert.match(sede, /from\("brand_secrets"\)/);
  // Il ripiego passa da scegliSegreto: riga del marchio illeggibile = guasto, non .env.
  assert.match(sede, /return scegliSegreto\(await segretoDelMarchio\(chiave\), segretoDAmbiente\(chiave\), chiave\);/);
  assert.match(sede, /if \(suo === null\) return ripiegoSegreto\(chiave\);/);
  assert.match(sede, /if \(delMarchio\) return "marchio";/);
  // Il webhook prova anche la firma del marchio.
  assert.match(sede, /if \(delMarchio && delMarchio !== amb\) fuori\.push/);
});

test("l'API: solo super admin, mai in chiaro, niente segreti in risposta", () => {
  const api = readFileSync("src/pages/api/admin/stripe.ts", "utf8");
  for (const metodo of ["GET", "PUT", "POST", "DELETE"]) {
    const corpo = api.split(`export const ${metodo}`)[1]?.split("export const")[0] ?? "";
    assert.match(corpo, /isSuperUser\(staff\)/, `${metodo} senza controllo super`);
  }
  const st = readFileSync("src/lib/admin/stripeStato.ts", "utf8");
  const scrivi = st.split("async function scrivi")[1].split("\n}\n")[0];
  assert.ok(scrivi.indexOf("cifraturaPronta()") < scrivi.indexOf("cifra(valore)"), "si cifra senza controllare SECRETS_KEY");
  assert.doesNotMatch(scrivi, /value:\s*valore\b/, "un segreto in chiaro nel database");
  const ritorno = st.split("export async function statoStripe")[1].split("\n}\n")[0];
  assert.match(ritorno, /mascherata: chiaveStripeMascherata\(chiaveP\)/);
  assert.match(ritorno, /mascherata: chiaveStripeMascherata\(alt\.chiave\)/);
  assert.doesNotMatch(ritorno, /\bchiave:\s*(chiaveP|alt\.chiave)\b/);
  assert.doesNotMatch(st, /console\.(log|error)\(/);
});

test("il webhook si crea accanto alla chiave, e i vecchi si tolgono solo dopo", () => {
  const st = readFileSync("src/lib/admin/stripeStato.ts", "utf8");
  const crea = st.split("export async function creaWebhook")[1].split("\n}\n")[0];
  assert.match(crea, /const chiave = alt \? alt\.chiave : await proprio\(livello, K_CHIAVE\);/, "il webhook usa una chiave ereditata");
  assert.match(crea, /if \(!sitoRaggiungibile\(sito\)\) return \{ ok: false, errore: "localhost" \}/);
  assert.ok(crea.indexOf("await salvaFirma(nuovo.secret)") < crea.indexOf("for (const v of vecchi)"),
    "i webhook vecchi si cancellano prima di aver salvato il segreto nuovo");
  // Il conto alternativo: il segreto va nella SUA riga, cifrato.
  const alt = st.split("async function scriviAlternativo")[1].split("\n}\n")[0];
  assert.ok(alt.indexOf("cifraturaPronta()") < alt.indexOf("cifra(campi.chiave)"));
  assert.match(alt, /webhook_secret = cifra\(campi\.firma\)/);
});

test("la scheda della sede non scrive piu' le chiavi Stripe", () => {
  const pagina = readFileSync("src/pages/admin/super.astro", "utf8");
  assert.doesNotMatch(pagina, /id="loc-stripe"|id="loc-hook"/);
  assert.match(pagina, /new CustomEvent\("apri-stripe"/);
  assert.match(pagina, /addEventListener\("apri-stripe"/);
});

test("il marchio e' un posto come gli altri: chiave e firma devono venire da li' tutte e due", async () => {
  const { pagamentoOnlinePronto } = await import("../src/lib/admin/sedeRegole.ts");
  assert.equal(pagamentoOnlinePronto("marchio", "marchio"), true);
  assert.equal(pagamentoOnlinePronto("marchio", "ambiente"), false);
  assert.equal(pagamentoOnlinePronto("sede", "marchio"), false);
});

/* ---- PIU' CONTI (5/11/2026) ---- */

test("piu' conti: l'attivo crea i pagamenti, la sessione si cerca su tutti", () => {
  const stripe = readFileSync("src/lib/stripe.ts", "utf8");
  assert.match(stripe, /const chiave = \(await contoAttivo\(ambito\)\)\.chiave;/);
  assert.match(stripe, /export async function stripePerSessione\(/);
  // Solo «non esiste su questo conto» fa provare il prossimo.
  assert.match(stripe, /codice !== "resource_missing"/);
  // Nessuna operazione su una sessione gia' creata passa piu' dal conto attivo.
  for (const f of ["src/lib/ritornoTavolo.ts", "src/pages/api/order-cancel.ts", "src/pages/api/admin/orders-recupero.ts",
    "src/pages/api/admin/refund.ts", "src/pages/api/admin/table-tabs.ts", "src/pages/api/table-tab.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /stripeDi\(/, `${f}: una sessione gia' creata cercata sul conto attivo`);
    assert.match(src, /stripePerSessione\(/, f);
  }
});

test("piu' conti: i conti del marchio solo alle sedi che ereditano, e il webhook li prova tutti", () => {
  const sede = readFileSync("src/lib/admin/sede.ts", "utf8");
  assert.match(sede, /const delMarchio = !idSede \|\| fc !== "sede" \? righe\.filter\(\(r\) => r\.location_id === null\) : \[\];/);
  assert.match(sede, /return conti\.find\(\(c\) => c\.id === scelta\) \?\? conti\[0\];/, "una scelta che non vale piu' non torna al principale");
  assert.match(sede, /return \(await contoAttivo\(ambito\)\)\.pronto;/, "il pagamento online non guarda il conto attivo");
  assert.match(sede, /for \(const r of await righeConti\(\)\)/, "il webhook non prova le firme dei conti alternativi");
});

test("lo switch: solo admin, solo un conto pronto, si scrive chi e quando", async () => {
  const { API_PAGINA, PAGINE_SOLO_ADMIN } = await import("../src/lib/admin/permessiRegole.ts");
  assert.equal(API_PAGINA["stripe-conto"], "settings");
  assert.ok(PAGINE_SOLO_ADMIN.includes("settings"));
  const api = readFileSync("src/pages/api/admin/stripe-conto.ts", "utf8");
  assert.match(api, /haLaPagina\(staff, "settings"\)/);
  assert.match(api, /if \(!conto\.pronto\) return json/);
  assert.match(api, /\[K_CAMBIO\]: JSON\.stringify\(\{ da: staff\.email/);
  assert.doesNotMatch(api, /chiave: c\.chiave|firma: c\.firma/, "una chiave esce dall'API dello switch");
});

test("la #96: tabella cifrata, solo service_role", () => {
  const m = readFileSync("supabase/096_stripe_conti.sql", "utf8");
  assert.match(m, /grant select, insert, update, delete on public\.stripe_accounts to service_role;/);
  assert.match(m, /location_id\s+uuid references public\.locations\(id\) on delete cascade/);
});
