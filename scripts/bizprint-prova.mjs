/**
 * PROVA DI STAMPA — manda UNA pagina alla stampante, e dice com'e' andata.
 *
 *   node scripts/bizprint-prova.mjs <printerId> [url]
 *
 * ⚠️ BizPrint non riceve il contenuto del ticket: riceve l'INDIRIZZO di una
 * pagina, e il tablet se la va a leggere da internet. Quindi la pagina deve
 * stare su un sito pubblico: `localhost` non esiste, per il tablet.
 *
 * ⚠️ «Inviato» non vuol dire «stampato». Il lavoro passa per il cloud, poi per
 * il tablet, poi per il bluetooth: puo' morire in ognuno dei tre. Per questo
 * qui si chiede lo stato tre volte invece di fermarsi all'HTTP 200 — la stessa
 * ragione per cui la tabella `print_tickets` segna `printed` solo quando il
 * servizio lo conferma.
 *
 * Nessuna chiave viene stampata: l'output e' mascherato come in bizprint-lista.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n").filter((r) => r.includes("=") && !r.trim().startsWith("#"))
    .map((r) => { const i = r.indexOf("="); return [r.slice(0, i).trim(), r.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const pub = env.BIZPRINT_PUBLIC_KEY, sec = env.BIZPRINT_SECRET_KEY;
if (!pub || !sec) { console.log("chiavi non trovate in .env"); process.exit(1); }

const printerId = Number(process.argv[2]);
const url = process.argv[3] || "https://restohub.moodd.online/ticket-prova.html";
if (!Number.isFinite(printerId) || printerId <= 0) {
  console.log("uso: node scripts/bizprint-prova.mjs <printerId> [url]");
  process.exit(1);
}

const base = "https://print.bizswoop.app/api/connect-application/v1";
const maschera = (t) => String(t)
  .replace(/"(secretKey|publicKey|key|token|apiKey|hash)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
  .replaceAll(sec, "***").replaceAll(pub, "***");

/** La firma di un POST: publicKey e time ENTRANO nel corpo, e si firma il
 *  corpo intero. Firmare solo i campi nostri da' 401 senza spiegazioni. */
function firma(dati) {
  const conChiave = { ...dati, publicKey: pub, time: Math.floor(Date.now() / 1000) };
  const hash = createHash("sha256").update(`${JSON.stringify(conChiave)}:${sec}`).digest("hex");
  return { ...conChiave, hash };
}

const corpo = firma({ printerId, url, description: "RestoHub — prova di stampa" });
const r = await fetch(`${base}/jobs`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(corpo),
});
const testo = await r.text();
console.log(`\n=== invio (HTTP ${r.status}) ===\n${maschera(testo).slice(0, 800)}`);
if (!r.ok) process.exit(1);

let jobId;
try { const j = JSON.parse(testo); jobId = j?.data?.id ?? j?.id; } catch { /* risposta non JSON */ }
if (!jobId) { console.log("\nnessun id di lavoro nella risposta: lo stato non si puo' seguire"); process.exit(0); }

for (const attesa of [3, 7, 15]) {
  await new Promise((ok) => setTimeout(ok, attesa * 1000));
  const q = new URLSearchParams({ publicKey: pub, time: String(Math.floor(Date.now() / 1000)) });
  q.set("hash", createHash("sha256").update(`${q.toString()}:${sec}`).digest("hex"));
  const s = await fetch(`${base}/jobs/${jobId}?${q}`);
  const t = await s.text();
  let stato = "?";
  try { const j = JSON.parse(t); stato = j?.data?.status ?? j?.status ?? "?"; } catch { /* non JSON */ }
  console.log(`dopo ${attesa}s → ${stato}`);
  if (stato === "done") { console.log("\nSTAMPATO."); process.exit(0); }
  if (stato === "failed") { console.log(`\nNON stampato:\n${maschera(t).slice(0, 500)}`); process.exit(1); }
}
console.log("\nancora in corso: il lavoro e' partito ma la stampante non ha ancora confermato.");
