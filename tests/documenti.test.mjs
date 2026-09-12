// Test unitari delle funzioni pure dei flussi "aggiungi" e "cancella" documento.
// Copiate VERBATIM da src/pages/api/admin/upload.ts, documents.ts e assets.astro.
import assert from "node:assert/strict";
import { test } from "vitest"; // il progetto ha gia' vitest: `npm test`

/* ---------- upload.ts : nome del file caricato ---------- */
const TIPI = { jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp",
               gif:"image/gif", svg:"image/svg+xml", ico:"image/x-icon", pdf:"application/pdf" };
function uploadPath(filename, now = 1789126495298) {
  const estensione = filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType = TIPI[estensione];
  if (!contentType) return { error: "Format non supporté" };
  const pulito = filename.toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-60);
  return { path: `${now}-${pulito}` };
}

/* ---------- documents.ts ---------- */
const thumbDi = (nome) => `.thumb-${nome}.webp`;
const nomeValido = (nome) => !!nome && !nome.includes("/") && !nome.includes("..");
function pulisciNome(nome) {
  const pulito = nome.toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+/, "").slice(0, 80);
  if (!pulito || pulito.includes("..") || !pulito.endsWith(".pdf")) return null;
  return pulito;
}
// GET: come vengono divisi file, cartelle e anteprime.
// `id !== null` scarta i PREFISSI (cartelle), che non sono oggetti.
function listaDocumenti(files) {
  const veri = files.filter((f) => !!f.name && f.id !== null);
  const nascosti = new Set(veri.filter((f) => f.name.startsWith(".")).map((f) => f.name));
  return veri.filter((f) => !f.name.startsWith(".")).map((f) => ({
    name: f.name,
    thumb: nascosti.has(thumbDi(f.name)) ? thumbDi(f.name) : null,
    size: Number(f.metadata?.size ?? 0),
  }));
}

/* ---------- assets.astro (client) ---------- */
function spezzaNome(nome) {
  const i = nome.lastIndexOf(".");
  return i > 0 ? { base: nome.slice(0, i), ext: nome.slice(i) } : { base: nome, ext: "" };
}
// nome dedotto dall'URL restituito dall'upload, per attaccare l'anteprima
const nomeDaUrl = (url) => decodeURIComponent(String(url ?? "").split("/").pop() ?? "");
const urlPubblico = (path) => `https://x.supabase.co/storage/v1/object/public/documents/${encodeURIComponent(path)}`;

/* =================== AGGIUNGI =================== */
test("aggiungi: nome semplice → prefisso timestamp + .pdf", () => {
  assert.equal(uploadPath("contrat.pdf").path, "1789126495298-contrat.pdf");
});

test("aggiungi: spazi e accenti diventano trattini, l'estensione resta", () => {
  assert.equal(uploadPath("Contrat de Bail 2026.pdf").path, "1789126495298-contrat-de-bail-2026.pdf");
});

test("aggiungi: l'anteprima si attacca al NOME REALE del file caricato", () => {
  const { path } = uploadPath("contrat.pdf");
  const nome = nomeDaUrl(urlPubblico(path));
  assert.equal(nome, path, "il nome dedotto dall'URL deve combaciare col path caricato");
  // la GET ritrova l'anteprima solo se i due nomi combaciano
  const [doc] = listaDocumenti([{ name: path }, { name: thumbDi(nome) }]);
  assert.equal(doc.thumb, thumbDi(path));
});

test("aggiungi: nome con accenti → l'anteprima si attacca lo stesso", () => {
  const { path } = uploadPath("Réglement Intérieur.pdf");
  const nome = nomeDaUrl(urlPubblico(path));
  const [doc] = listaDocumenti([{ name: path }, { name: thumbDi(nome) }]);
  assert.equal(doc.thumb, thumbDi(path), "anteprima persa: nome dedotto ≠ nome caricato");
});

test("aggiungi: nome MOLTO lungo — l'estensione .pdf deve sopravvivere", () => {
  const lungo = "a".repeat(120) + ".pdf";
  const { path } = uploadPath(lungo);
  assert.ok(path.endsWith(".pdf"), `estensione persa: ${path.slice(-20)}`);
});

test("aggiungi: due file con lo STESSO nome non si sovrascrivono", () => {
  const a = uploadPath("contrat.pdf", 1000).path;
  const b = uploadPath("contrat.pdf", 2000).path;
  assert.notEqual(a, b);
});

/* =================== RINOMINA =================== */
test("rinomina: base + .pdf, l'anteprima segue", () => {
  const vecchio = "1789126495298-contrat.pdf";
  const base = spezzaNome(vecchio).base;
  assert.equal(base, "1789126495298-contrat");
  const nuovo = pulisciNome("contrat-2026.pdf");
  assert.equal(nuovo, "contrat-2026.pdf");
  assert.equal(thumbDi(nuovo), ".thumb-contrat-2026.pdf.webp");
});

test("rinomina: nome al limite del campo (70 char) resta valido", () => {
  const base = "b".repeat(70); // maxlength dell'input
  const n = pulisciNome(base + ".pdf");
  assert.ok(n && n.endsWith(".pdf"), "il taglio a 80 non deve mangiare l'estensione");
});

test("rinomina: oltre gli 80 caratteri il taglio MANGIA l'estensione", () => {
  const n = pulisciNome("c".repeat(90) + ".pdf");
  assert.equal(n, null, "atteso rifiuto: il troncamento a 80 toglie .pdf");
});

test("rinomina: un nome che inizia con un punto non diventa un file nascosto", () => {
  const n = pulisciNome(".segreto.pdf");
  assert.ok(n === null || !n.startsWith("."), `file nascosto creato: ${n}`);
});

/* =================== CANCELLA =================== */
test("cancella: il nome passa la validazione e l'anteprima viene inclusa", () => {
  const nome = "1789126495298-contrat.pdf";
  assert.ok(nomeValido(nome));
  assert.deepEqual([nome, thumbDi(nome)], [nome, ".thumb-1789126495298-contrat.pdf.webp"]);
});

test("cancella: nomi pericolosi rifiutati", () => {
  assert.equal(nomeValido("../../secret.pdf"), false);
  assert.equal(nomeValido("cartella/file.pdf"), false);
  assert.equal(nomeValido(""), false);
});

test("cancella: il nome viene codificato nella query e torna identico", () => {
  const nome = "1789126495298-contrat-de-bail.pdf";
  assert.equal(decodeURIComponent(encodeURIComponent(nome)), nome);
});

/* =================== LISTA =================== */
test("lista: le anteprime non compaiono come documenti", () => {
  const files = [
    { name: "contrat.pdf" },
    { name: ".thumb-contrat.pdf.webp" },
    { name: ".emptyFolderPlaceholder" },
  ];
  const docs = listaDocumenti(files);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].name, "contrat.pdf");
  assert.equal(docs[0].thumb, ".thumb-contrat.pdf.webp");
});

/* =================== TRASPORTO =================== */
// Il file viaggia in JSON come base64: +33% di peso. Il controllo del client
// guarda il file SUL DISCO, il server guarda i byte DECODIFICATI — nessuno
// dei due guarda quanto viaggia davvero sulla rete.
const pesoJson = (bytes) => Math.ceil(bytes / 3) * 4;

test("trasporto: un PDF al limite dei 10 MB viaggia come ~13,3 MB", () => {
  const dieciMb = 10 * 1024 * 1024;
  const viaggia = pesoJson(dieciMb);
  assert.ok(viaggia > 13 * 1024 * 1024, `${(viaggia / 1048576).toFixed(1)} MB`);
});

test("trasporto: il limite lato client deve tenere conto della codifica", () => {
  // Perche' il corpo resti sotto i 10 MB, il file non puo' superare ~7,5 MB.
  const limiteReale = Math.floor((10 * 1024 * 1024 * 3) / 4);
  assert.ok(limiteReale < 8 * 1024 * 1024);
  assert.ok(pesoJson(limiteReale) <= 10 * 1024 * 1024);
});

/* =================== CESTINO A DUE TEMPI =================== */
// Riproduce il comportamento ATTUALE della griglia documenti: ogni bottone
// si arma per conto suo, senza disarmare gli altri.
function cestinoSenzaGuardia() {
  const armati = new Set();
  return {
    click(id) { if (!armati.has(id)) { armati.add(id); return null; } return id; },
    armati: () => [...armati],
  };
}
function cestinoConGuardia() {
  let armato = null;
  return {
    click(id) { if (armato !== id) { armato = id; return null; } return id; },
    armati: () => (armato ? [armato] : []),
  };
}

test("cestino: senza guardia restano armati PIU' bottoni insieme", () => {
  const c = cestinoSenzaGuardia();
  c.click("a.pdf");
  c.click("b.pdf");
  assert.deepEqual(c.armati(), ["a.pdf", "b.pdf"], "due cestini armati contemporaneamente");
  // un click distratto su «a» cancella un documento che l'utente non stava guardando
  assert.equal(c.click("a.pdf"), "a.pdf");
});

test("cestino: con la guardia ne resta armato UNO solo", () => {
  const c = cestinoConGuardia();
  c.click("a.pdf");
  c.click("b.pdf");
  assert.deepEqual(c.armati(), ["b.pdf"], "armare il secondo deve disarmare il primo");
  assert.equal(c.click("a.pdf"), null, "«a» e' tornato al primo tempo: non cancella");
});

/* =================== CARTELLE FANTASMA E CANCELLAZIONE REALE ===================
   Bug del 11/09: `list()` restituisce anche i PREFISSI (cartelle) con id null,
   e `remove()` non protesta per un file che non esiste. Insieme facevano un
   documento che non si poteva cancellare e che diceva di esserlo. */
// DELETE, versione CORRETTA: `remove()` non protesta per un file inesistente.
function cancella(esistenti, name) {
  const tolti = [name, thumbDi(name)].filter((n) => esistenti.includes(n));
  if (!tolti.includes(name)) return { status: 404, error: "Fichier introuvable" };
  return { status: 200, ok: true, tolti };
}

test("lista: una CARTELLA non e' un documento", () => {
  const files = [
    { name: "contrat.pdf", id: "u1", metadata: { size: 335000 } },
    { name: "contrat", id: null, metadata: null }, // prefisso, non un oggetto
  ];
  const docs = listaDocumenti(files);
  assert.deepEqual(docs.map((d) => d.name), ["contrat.pdf"]);
});

test("lista: il documento fantasma aveva peso e data vuoti — il sintomo visibile", () => {
  const [fantasma] = listaDocumenti([{ name: "contrat", id: null, metadata: null }]);
  assert.equal(fantasma, undefined, "non deve nemmeno comparire");
});

test("cancella: un file che non esiste NON deve dire «eliminato»", () => {
  const r = cancella(["altro.pdf"], "contrat");
  assert.equal(r.status, 404, "remove() non protesta: il controllo lo deve fare l'endpoint");
});

test("cancella: un file vero viene tolto con la sua anteprima", () => {
  const r = cancella(["contrat.pdf", ".thumb-contrat.pdf.webp"], "contrat.pdf");
  assert.equal(r.status, 200);
  assert.deepEqual(r.tolti, ["contrat.pdf", ".thumb-contrat.pdf.webp"]);
});

test("cancella: un file senza anteprima si cancella lo stesso", () => {
  const r = cancella(["contrat.pdf"], "contrat.pdf");
  assert.equal(r.status, 200);
  assert.deepEqual(r.tolti, ["contrat.pdf"]);
});
