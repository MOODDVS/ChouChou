import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n").filter((r) => r.includes("=") && !r.trim().startsWith("#"))
    .map((r) => { const i = r.indexOf("="); return [r.slice(0, i).trim(), r.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const pub = env.BIZPRINT_PUBLIC_KEY, sec = env.BIZPRINT_SECRET_KEY;
if (!pub || !sec) { console.log("chiavi non trovate"); process.exit(1); }
const base = "https://print.bizswoop.app/api/connect-application/v1";
for (const risorsa of ["stations", "printers"]) {
  const q = new URLSearchParams({ publicKey: pub, time: String(Math.floor(Date.now() / 1000)) });
  q.set("hash", createHash("sha256").update(`${q.toString()}:${sec}`).digest("hex"));
  try {
    const r = await fetch(`${base}/${risorsa}?${q}`);
    const t = await r.text();
    console.log(`\n=== ${risorsa} (HTTP ${r.status}) ===`);
    const pulito = t
      .replace(/"(secretKey|publicKey|key|token|apiKey)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
      .replace(new RegExp(sec, "g"), "***")
      .replace(new RegExp(pub, "g"), "***");
    console.log(pulito.slice(0, 1500));
  } catch (e) { console.log(`${risorsa}: ${e.message}`); }
}
