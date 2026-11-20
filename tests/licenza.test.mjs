/**
 * L'abbonamento del ristorante (20/11/2026): attivo / avviso / sospeso,
 * deciso in admin.restohub.cloud. Le regole pure e le protezioni.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { regolaLicenza, decisioneSospeso, paginaSospesa, testiLicenza, linguaDaHeader, PUBBLICHE_FERMATE } from "../src/lib/licenzaRegole.ts";

test("una risposta strana vale «attivo», un link non https non esiste", () => {
  assert.deepEqual(regolaLicenza(null), { stato: "attivo", link: "" });
  assert.deepEqual(regolaLicenza({ stato: "chiuso" }), { stato: "attivo", link: "" });
  assert.deepEqual(regolaLicenza({ stato: "avviso", link: "https://buy.stripe.com/abc" }), { stato: "avviso", link: "https://buy.stripe.com/abc" });
  assert.equal(regolaLicenza({ stato: "sospeso", link: "javascript:alert(1)" }).link, "");
  assert.equal(regolaLicenza({ stato: "sospeso", link: "http://x.be" }).link, "");
});

test("da sospeso: il sito resta su, si fermano solo ordini, prenotazioni e admin", () => {
  assert.equal(decisioneSospeso("/", "GET"), "passa");
  assert.equal(decisioneSospeso("/menu", "GET"), "passa");
  assert.equal(decisioneSospeso("/api/menu", "GET"), "passa");
  assert.equal(decisioneSospeso("/api/slots", "GET"), "passa");
  for (const p of PUBBLICHE_FERMATE) {
    assert.equal(decisioneSospeso(p, "POST"), "ordini");
    assert.equal(decisioneSospeso(p, "GET"), "passa");
  }
  assert.equal(decisioneSospeso("/admin", "GET"), "admin-pagina");
  assert.equal(decisioneSospeso("/admin/orders", "GET"), "admin-pagina");
  assert.equal(decisioneSospeso("/api/admin/orders", "GET"), "admin-api");
  // il login resta aperto: il super admin deve poter entrare
  assert.equal(decisioneSospeso("/admin/login", "GET"), "passa");
  assert.equal(decisioneSospeso("/admin/reset-password/", "GET"), "passa");
});

test("mai fermati: il pagamento gia' fatto, i job, la scheda di MOODD", () => {
  assert.equal(decisioneSospeso("/api/stripe-webhook", "POST"), "passa");
  assert.equal(decisioneSospeso("/api/cron/newsletter", "GET"), "passa");
  assert.equal(decisioneSospeso("/api/restohub/stato", "GET"), "passa");
});

test("la pagina sospesa: niente script, il link escapato, la lingua giusta", () => {
  const p = paginaSospesa("Chez <Toto>", "it", "https://buy.stripe.com/x?a=1&b=\"2\"");
  assert.doesNotMatch(p, /<script/i);
  assert.match(p, /Chez &lt;Toto&gt;/);
  assert.match(p, /a=1&amp;b=&quot;2&quot;/);
  assert.match(p, /Accesso sospeso/);
  assert.match(p, /Paga adesso/);
  assert.doesNotMatch(paginaSospesa("X", "fr", ""), /class="paga"/);
  assert.equal(testiLicenza("de").titolo, "Accès suspendu");
  assert.equal(linguaDaHeader("nl-BE,nl;q=0.9"), "nl");
  assert.equal(linguaDaHeader(null), "fr");
});

test("il motore: prudente (attivo se l'admin non risponde), super admin passa, header della fascia", () => {
  const lib = readFileSync("src/lib/licenza.ts", "utf8");
  assert.match(lib, /let ultima: Licenza = \{ stato: "attivo", link: "" \};/);
  assert.match(lib, /host === "localhost"/);
  assert.match(lib, /"x-restohub-key": chiave/);
  assert.match(lib, /redirect: "error"/);
  const m = readFileSync("src/middleware.ts", "utf8");
  assert.match(m, /sequence\(securityHeaders, authGuardAdmin, licenzaGuard,/);
  assert.match(m, /if \(ctx\?\.ruolo === "super"\) return next\(\);/);
  const h = readFileSync("src/components/admin/AdminHeader.astro", "utf8");
  assert.match(h, /lic\.stato !== "attivo"/);
  assert.match(h, /rel="noopener noreferrer">\{tLic\.paga\}/);
});
