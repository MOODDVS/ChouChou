/**
 * LE RETI DELL'AUDIT DEL 3/11/2026 (claude/audit-motore-2026-11-03.md).
 *
 * Ogni prova qui sotto chiude una falla trovata dall'audit e impedisce che
 * torni: se un giorno fallisce, la ragione e' scritta accanto.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function tutti(dir, est) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...tutti(p, est));
    else if (est.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

test("un solo esc nell'admin: quello di lib/esc.ts, che chiude anche gli apici", () => {
  // Le copie locali dimenticavano `"`: un telefono con un apice usciva
  // dall'attributo href="tel:…" e diventava markup.
  const copie = tutti("src/pages/admin", [".astro"])
    .concat(tutti("src/components", [".astro"]))
    .filter((p) => /\b(function esc\(|const esc = )/.test(readFileSync(p, "utf8")));
  assert.deepEqual(copie, []);
});

test("i documenti dell'admin passano dal bucket privato quando c'e'", () => {
  const D = readFileSync("src/pages/api/admin/docs.ts", "utf8");
  assert.doesNotMatch(D, /getPublicUrl/, "un link pubblico a un contratto non scade mai");
  assert.doesNotMatch(D, /const BUCKET = "documents"/);
  assert.match(D, /spostaNelPrivato\(/);
  const B = readFileSync("src/lib/admin/bucketDocs.ts", "utf8");
  assert.match(B, /createSignedUrls\(percorsi, DURATA_LINK\)/);
  const M = readFileSync("supabase/093_documenti_privati.sql", "utf8");
  assert.match(M, /'admin_docs', 'admin_docs', false/);
});

test("il contatore del codice del conto si scrive solo se nessuno l'ha cambiato", () => {
  const C = readFileSync("src/lib/contoServer.ts", "utf8");
  const f = C.slice(C.indexOf("export async function verificaCodice"), C.indexOf("function eDoppione"));
  assert.match(f, /q\.eq\("tab_fails", prima\)/);
  assert.match(f, /\.select\("id"\)/);
  assert.match(f, /length === 0\) return "sbagliato"/);
});

test("le email del tavolo hanno la forma di un'email", async () => {
  const { emailValida } = await import("../src/lib/emailValida.ts");
  assert.equal(emailValida("a@b.be"), true);
  for (const x of ["", "ciao", "a@b", "a b@c.de", "x".repeat(250) + "@b.be"]) assert.equal(emailValida(x), false, x);
  for (const p of ["src/pages/api/table-session.ts", "src/pages/api/table-tab.ts"]) {
    assert.match(readFileSync(p, "utf8"), /if \(email && !emailValida\(email\)\)/, p);
  }
});

test("un'email dentro ilike vale solo per se stessa", async () => {
  const { likeEsatto } = await import("../src/lib/like.ts");
  assert.equal(likeEsatto("%"), "\\%");
  assert.equal(likeEsatto("a_b@c.be"), "a\\_b@c.be");
  // nessun ilike sull'email senza escape
  for (const p of tutti("src", [".ts"])) {
    const t = readFileSync(p, "utf8");
    for (const m of t.matchAll(/\.ilike\("(?:customer_)?email", ([^)]+)\)/g)) {
      assert.match(m[1], /^likeEsatto\(/, `${p}: ${m[0]}`);
    }
  }
});

test("niente filtri .or costruiti con un'email o un telefono della richiesta", () => {
  const t = readFileSync("src/pages/api/admin/clients.ts", "utf8");
  assert.doesNotMatch(t, /email\.eq\.\$\{/);
  assert.doesNotMatch(t, /phone\.eq\.\$\{/);
});

test("la scheda Google di una sede la tocca solo chi e' di quella sede", () => {
  const t = readFileSync("src/pages/api/admin/google/locations.ts", "utf8");
  assert.match(t, /if \(sua && id !== sua\)/);
  assert.doesNotMatch(t, /json\(\{ error: errore \}/, "la chiave grezza «err.…» arrivava fino allo schermo");
});

test("quantita' del carrello: un intero da 1 a 99, e un tetto alle righe", async () => {
  const { quantita, QTY_MAX } = await import("../src/lib/quantita.ts");
  assert.equal(quantita(1), 1);
  assert.equal(quantita(QTY_MAX), QTY_MAX);
  for (const x of [0, -1, 100, 1e9, 2.5, "abc", NaN, null]) assert.equal(quantita(x), null, String(x));
  const c = readFileSync("src/pages/api/checkout.ts", "utf8");
  assert.match(c, /body\.items\.length > RIGHE_MAX/);
  assert.doesNotMatch(c, /Math\.max\(1, Math\.floor\(richiesto\.qty\)\)/);
});

test("i poll della nav usano un token che si rinnova", () => {
  const nav = readFileSync("src/components/admin/AdminNav.astro", "utf8");
  assert.doesNotMatch(nav, /const headers = \{ Authorization: `Bearer \$\{token\}` \}/, "dopo un'ora i poll tornano 401 e tacciono");
  assert.equal((nav.match(/headersVivi\(token\)/g) ?? []).length, 2);
  assert.equal((nav.match(/recent_paid=1/g) ?? []).length, 1, "una lettura degli ordini pagati per due");
  const sd = readFileSync("src/components/admin/SpecialDaysForm.astro", "utf8");
  assert.match(sd, /headersVivi\(token\)/);
});

test("«Fermer les commandes» vale subito per tutti i processi", () => {
  const c = readFileSync("src/pages/api/checkout.ts", "utf8");
  assert.match(c, /leggiConfig\(ambitoPub, \["orders_closed"\]\)/);
  assert.doesNotMatch(c, /appConfigEq\("orders_closed"/);
});

test("aPagine legge oltre le mille righe", async () => {
  const { aPagine } = await import("../src/lib/aPagine.ts");
  const righe = Array.from({ length: 2345 }, (_, i) => i);
  const { data } = await aPagine(async (da, a) => ({ data: righe.slice(da, a + 1), error: null }));
  assert.equal(data.length, 2345);
  for (const p of ["src/pages/api/admin/gift-cards.ts", "src/pages/api/admin/gift-cards-pdf.ts"]) {
    assert.match(readFileSync(p, "utf8"), /aPagine/, p);
  }
});

test("i verdi e i rossi di stato sono token, non esadecimali sparsi", () => {
  const H = readFileSync("src/components/admin/AdminHead.astro", "utf8");
  assert.match(H, /--c-ko:#ed1c24;--c-ko-chiaro:#ff8a8f/);
  for (const p of tutti("src/pages/admin", [".astro"])) {
    const s = readFileSync(p, "utf8");
    if (!s.includes("AdminHead")) continue;
    for (const m of s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
      assert.doesNotMatch(m[1], /#(2e9e6b|4fbe8c|ed1c24|ff8a8f)\b/i, `${p}: usare var(--c-ok) / var(--c-ko)`);
    }
  }
});

test("da Commandes si chiudono gli ordini, ma la mail col fatturato resta di Réglages", () => {
  const s = readFileSync("src/pages/api/admin/settings.ts", "utf8");
  assert.match(s, /\(vuoleBrief \|\| vuoleBriefOra \|\| vuoleBriefEmail\) && !\(await haLaPagina\(staff, "settings"\)\)/);
  const t = readFileSync("src/pages/api/admin/tables.ts", "utf8");
  assert.match(t, /!\("priority" in body\) && !\(await haLaPagina\(staff, "settings"\)\)/);
  const a = readFileSync("src/lib/admin/adminAuth.ts", "utf8");
  assert.match(a, /pages: Array\.isArray\(\(data\.user\.app_metadata/, "il ripiego di rete perdeva le pagine");
});
