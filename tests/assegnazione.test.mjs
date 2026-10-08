/**
 * A CHI SI PUO' ASSEGNARE UNA NOTA.
 *
 * `team` e' una rubrica, non l'elenco del personale: contiene fornitori,
 * tecnici, consulenti e il commercialista. La regola che li tiene fuori e'
 * pura e sta in un posto solo, perche' la usano in due — l'elenco che si vede
 * nel modale e l'email che parte dal server. Se divergessero, il modale
 * offrirebbe una persona a cui poi non si scrive, o il contrario.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { assegnabile, assegnabili, CATEGORIE_INTERNE } from "../src/lib/admin/teamRegole.ts";

const chef = { id: "1", name: "Marco", email: "marco@x.be", category: "cuisine", active: true };

test("gli interni con un'email si possono assegnare", () => {
  for (const c of CATEGORIE_INTERNE) {
    assert.equal(assegnabile({ ...chef, category: c }), true, `${c} dovrebbe essere assegnabile`);
  }
});

test("fornitori, tecnici e consulenti NO, anche con l'email", () => {
  // ⚠️ Il caso da cui nasce la regola: assegnare «ordinare la farina» al
  // fornitore della farina, e spedirgli una nota interna della cucina.
  for (const c of ["fournisseurs", "technique", "marketing", "consultants", "partenaires"]) {
    assert.equal(assegnabile({ ...chef, category: c }), false, `${c} non deve comparire nell'elenco`);
  }
});

test("senza email non si assegna", () => {
  // Una nota che dice «tocca a Marco» mentre Marco non lo sa, e chi l'ha
  // scritta crede di averglielo detto.
  assert.equal(assegnabile({ ...chef, email: "" }), false);
  assert.equal(assegnabile({ ...chef, email: null }), false);
  assert.equal(assegnabile({ ...chef, email: "   " }), false);
});

test("chi e' disattivato esce dall'elenco", () => {
  assert.equal(assegnabile({ ...chef, active: false }), false);
});

test("una categoria che non esiste non passa", () => {
  // ⚠️ «Permesso cio' che non conosco» qui sarebbe sbagliato: una categoria
  // nuova aggiunta domani in rubrica (es. «livreurs») entrerebbe da sola fra
  // chi riceve le note interne, senza che nessuno l'abbia deciso.
  assert.equal(assegnabile({ ...chef, category: "livreurs" }), false);
  assert.equal(assegnabile({ ...chef, category: "" }), false);
});

test("l'elenco tiene l'ordine e scarta il resto", () => {
  const righe = [
    chef,
    { id: "2", name: "Fornitore", email: "f@x.be", category: "fournisseurs", active: true },
    { id: "3", name: "Luc", email: "luc@x.be", category: "salle", active: true },
  ];
  assert.deepEqual(assegnabili(righe).map((p) => p.id), ["1", "3"]);
  assert.deepEqual(assegnabili(null), []);
});
