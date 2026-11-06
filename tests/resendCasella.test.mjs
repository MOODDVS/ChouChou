/**
 * Intégrations → la casella Resend (5/11/2026). Le regole pure e le
 * protezioni: la chiave non esce mai, solo super admin, nessun file del
 * motore legge piu' la chiave dal `.env` per conto suo.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import {
  chiaveValida, chiaveMascherata, pulisciMittente, emailValida, componiMittente,
  emailDelMittente, nomeDelMittente, dominioDi, scegliChiave, scegliMittente,
  statoDominio, livelloResend,
} from "../src/lib/admin/resendRegole.ts";

const CHIAVE = "re_AbCdEf12_3456789012345678a91f";

test("la chiave: forma, e mostrata solo mascherata", () => {
  assert.ok(chiaveValida(CHIAVE));
  assert.ok(!chiaveValida("sk_live_123456789012345678"));
  assert.ok(!chiaveValida("re_corta"));
  assert.ok(!chiaveValida(""));
  assert.equal(chiaveMascherata(CHIAVE), "re_••••a91f");
  assert.equal(chiaveMascherata(""), "");
  assert.ok(!chiaveMascherata(CHIAVE).includes(CHIAVE.slice(3, 10)));
});

test("il mittente: virgolette stray tolte, nome ripulito, parti separate", () => {
  assert.equal(pulisciMittente('"Villa 77 <ciao@villa77.be>"'), "Villa 77 <ciao@villa77.be>");
  assert.equal(componiMittente("Villa <77>", "ciao@villa77.be"), "Villa 77 <ciao@villa77.be>");
  assert.equal(componiMittente("", "ciao@villa77.be"), "ciao@villa77.be");
  assert.equal(componiMittente("Villa", "non-una-mail"), "");
  assert.ok(emailValida("a@b.be") && !emailValida("a@b") && !emailValida("<a@b.be>"));
  assert.equal(emailDelMittente("Villa 77 <ciao@villa77.be>"), "ciao@villa77.be");
  assert.equal(nomeDelMittente("Villa 77 <ciao@villa77.be>"), "Villa 77");
  assert.equal(nomeDelMittente("ciao@villa77.be"), "");
  assert.equal(dominioDi("Villa 77 <ciao@Villa77.BE>"), "villa77.be");
});

test("quale chiave vale: la casella, poi il .env; la riga illeggibile si dice", () => {
  assert.deepEqual(scegliChiave(CHIAVE, "re_env"), { chiave: CHIAVE, fonte: "casella", rotta: false });
  assert.deepEqual(scegliChiave(null, "re_env"), { chiave: "re_env", fonte: "env", rotta: false });
  assert.deepEqual(scegliChiave("", "re_env"), { chiave: "re_env", fonte: "env", rotta: true });
  assert.deepEqual(scegliChiave(null, ""), { chiave: "", fonte: "nessuna", rotta: false });
  assert.deepEqual(scegliMittente("Villa", "ciao@villa77.be", "X <x@moodd.online>"), { mittente: "Villa <ciao@villa77.be>", fonte: "casella" });
  assert.deepEqual(scegliMittente("", "", '"X <x@moodd.online>"'), { mittente: "X <x@moodd.online>", fonte: "env" });
  assert.deepEqual(scegliMittente("", "", ""), { mittente: "", fonte: "nessuna" });
});

test("il dominio e il segno della casella", () => {
  const domini = [{ name: "villa77.be", status: "verified" }, { name: "bros.be", status: "pending" }];
  assert.equal(statoDominio(domini, "villa77.be"), "verificato");
  assert.equal(statoDominio(domini, "bros.be"), "attesa");
  assert.equal(statoDominio(domini, "altro.be"), "assente");
  assert.equal(statoDominio(null, "villa77.be"), "ignoto"); // chiave «sending access»
  const base = { fonteChiave: "casella", rotta: false, fonteMittente: "casella", dominio: "verificato" };
  assert.deepEqual(livelloResend(base), { livello: "ok", daFare: 0 });
  assert.deepEqual(livelloResend({ ...base, dominio: "ignoto" }), { livello: "ok", daFare: 0 });
  assert.deepEqual(livelloResend({ ...base, fonteChiave: "env", fonteMittente: "env" }), { livello: "parz", daFare: 2 });
  assert.equal(livelloResend({ ...base, fonteChiave: "nessuna" }).livello, "no");
  assert.equal(livelloResend({ ...base, dominio: "assente" }).livello, "no");
});

test("la #95: tabelle con GRANT, contatore solo per il service_role", () => {
  const m = readFileSync("supabase/095_resend_casella.sql", "utf8");
  assert.match(m, /grant select, insert, update, delete on public\.brand_secrets to service_role;/);
  assert.match(m, /grant select, insert, update, delete on public\.email_counter to service_role;/);
  assert.match(m, /revoke all on function public\.email_counter_bump\(text, integer\) from public, anon, authenticated;/);
  assert.match(m, /on conflict \(month\) do update/);
});

test("nessun file legge piu' la chiave Resend dal .env per conto suo", () => {
  const file = [
    "src/lib/notifications.ts", "src/lib/newsletterSend.ts", "src/lib/admin/dailyBrief.ts",
    "src/pages/api/admin/print-order.ts", "src/pages/api/admin/docs.ts", "src/pages/api/contact.ts",
  ];
  for (const f of file) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /new Resend\(/, `${f} crea ancora il suo client`);
    assert.doesNotMatch(src, /import\.meta\.env\.RESEND_(API_KEY|FROM)/, `${f} legge ancora il .env`);
    assert.match(src, /resendCliente\(\)/, `${f} non passa da emailResend.ts`);
  }
  const lib = readFileSync("src/lib/emailResend.ts", "utf8");
  assert.match(lib, /import\.meta\.env\.RESEND_API_KEY/); // il ripiego, scritto per esteso
});

test("l'API: solo super admin, e la chiave non esce mai", () => {
  const api = readFileSync("src/pages/api/admin/resend.ts", "utf8");
  for (const metodo of ["GET", "PUT", "POST", "DELETE"]) {
    const corpo = api.split(`export const ${metodo}`)[1]?.split("export const")[0] ?? "";
    assert.match(corpo, /isSuperUser\(staff\)/, `${metodo} senza controllo super`);
  }
  const stato = readFileSync("src/lib/admin/resendStato.ts", "utf8");
  const ritorno = stato.split("export async function statoResend")[1].split("\n}\n")[0];
  assert.match(ritorno, /chiaveMascherata\(cfg\.chiave\)/);
  assert.doesNotMatch(ritorno, /chiave: cfg\.chiave/);
  assert.doesNotMatch(stato, /console\.(log|error)\([^)]*chiave/);
  assert.match(stato, /cifra\(chiave\.trim\(\)\)/, "la chiave va scritta cifrata");
});
