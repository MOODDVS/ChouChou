/**
 * L'ORDINE DEL CAMERIERE E LA VALIDAZIONE DAL PALMARE — le reti sul codice.
 * (Le funzioni parlano col database: qui si guarda che le regole ci siano.)
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";

const leggi = (f) => readFileSync(f, "utf8");
const nudo = (f) => leggi(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("un conto da validare non prende ordini dal palmare, un tavolo libero nemmeno", () => {
  const o = nudo("src/lib/admin/ordineCameriere.ts");
  assert.match(o, /if \(rigaConto && rigaConto\.tab_status === "pending"\) return \{ ok: false, errore: "valida_prima" \};/);
  assert.match(o, /if \(!seduta\) return \{ ok: false, errore: "libero" \};/);
});

test("sul conto: nel suo invio, che parte subito; senza conto: da incassare, ticket subito", () => {
  const o = nudo("src/lib/admin/ordineCameriere.ts");
  assert.match(o, /payment_method: "tab",\s*round_id: invioId,/);
  assert.match(o, /aggiorna\("table_rounds", ambito, \{ release_at: [^}]+\}\)\s*\.eq\("id", invioId\)/);
  assert.match(o, /payment_method: "onsite",/);
  assert.match(o, /void accodaTicket\(\{ id: ordine\.id, status: "pending", payment_method: "onsite"/);
});

test("i prezzi del palmare sono quelli dell'ordine manuale: una funzione sola", () => {
  assert.match(nudo("src/lib/admin/ordineCameriere.ts"), /from "\.\/righeOrdine"/);
  assert.match(nudo("src/pages/api/admin/orders.ts"), /from "\.\.\/\.\.\/\.\.\/lib\/admin\/righeOrdine"/);
  assert.doesNotMatch(nudo("src/pages/api/admin/orders.ts"), /function rigaOrdine\(/, "una seconda copia del calcolo");
});

test("validare e rifiutare: la stessa decisione per il tablet e per il palmare", () => {
  for (const f of ["src/pages/api/admin/table-tabs.ts", "src/pages/api/admin/salle-tab.ts"]) {
    const src = nudo(f);
    assert.match(src, /validaConto\(ambito, conto/, f);
    assert.match(src, /rifiutaConto\(ambito, conto/, f);
  }
  // Il palmare rifiuta col secondo tocco.
  assert.match(leggi("src/pages/admin/salle/table.astro"), /if \(armato\) \{ window\.clearTimeout\(armato\); armato = 0; void decidi\("rifiuta", rifiuta\); return; \}/);
});

test("annullare: solo seduti senza ordini e senza conto, ricontrollato sul server", () => {
  const src = nudo("src/lib/admin/installaTavolo.ts");
  assert.match(src, /if \(seduta\.tab_status === "pending" \|\| seduta\.tab_status === "open"\) return \{ ok: false, errore: "ordini" \};/);
  assert.match(src, /if \(\(count \?\? 0\) > 0\) return \{ ok: false, errore: "ordini" \};/);
  assert.match(src, /aggiorna\("reservations", ambito, \{ status: "cancelled" \}\)\s*\.eq\("id", seduta\.id\)\s*\.eq\("status", "seated"\)/);
  // Nella pagina: solo quando non c'e' nessun ordine, e col secondo tocco.
  const pag = leggi("src/pages/admin/salle/table.astro");
  assert.match(pag, /const annullabile = Boolean\(s && !s\.conto && s\.sessione && s\.sessione\.ordini\.length === 0\);/);
});

test("la freccia per tornare sta in basso, sotto il pollice", () => {
  for (const f of ["src/pages/admin/salle/table.astro", "src/pages/admin/salle/order.astro"]) {
    const pag = leggi(f);
    const testa = pag.slice(pag.indexOf("<header"), pag.indexOf("</header>"));
    assert.doesNotMatch(testa, /indietro/, `${f}: la freccia e' ancora in alto`);
  }
});
