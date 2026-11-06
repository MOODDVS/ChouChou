/** Intégrations → la casella Newsletter (5/11/2026). */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { livelloNewsletter } from "../src/lib/admin/newsletterRegole.ts";

const q = (o = {}) => ({ total_remaining: 900, sent_this_month: 100, monthly_quota: 1000, purchased_balance: 0, ...o });

test("il segno della casella", () => {
  assert.equal(livelloNewsletter({ resend: true, quota: q() }), "ok");
  assert.equal(livelloNewsletter({ resend: false, quota: q() }), "no", "senza Resend non parte niente");
  assert.equal(livelloNewsletter({ resend: true, quota: q({ total_remaining: 0 }) }), "no");
  assert.equal(livelloNewsletter({ resend: true, quota: q({ sent_this_month: 850, total_remaining: 150 }) }), "parz");
  // I crediti di scorta tolgono l'allarme: il mese finisce, gli invii no.
  assert.equal(livelloNewsletter({ resend: true, quota: q({ sent_this_month: 850, purchased_balance: 500 }) }), "ok");
});

test("l'API e' del super, e la vecchia scheda non c'e' piu'", () => {
  const api = readFileSync("src/pages/api/admin/newsletter-casella.ts", "utf8");
  assert.match(api, /if \(!staff \|\| !isSuperUser\(staff\)\) return nonAutorizzato\(\);/);
  const p = readFileSync("src/pages/admin/super.astro", "utf8");
  assert.equal((p.match(/id="nl-quota"/g) ?? []).length, 1);
  assert.match(p, /id="nl-tile"/);
});
