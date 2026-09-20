import { defineMiddleware, sequence } from "astro:middleware";
import { colpisci, ipClient } from "./lib/rateLimit";
import { sessioneRiconosciuta, claimsDaToken } from "./lib/admin/adminAuth";
import { caricaBootAdmin } from "./lib/admin/adminBoot";
import { ruoloDi, PAGINE_ADMIN } from "./lib/admin/superAdmin";
import { chiavePagina, puoVederePagina, chiaveApi, puoChiamareApi } from "./lib/admin/permessiRegole";

/**
 * Host canonico: forza il www.
 * Se PUBLIC_SITE_URL = https://www.dominiocliente.be, ogni richiesta GET/HEAD
 * arrivata su dominiocliente.be (apex, senza www) riceve un 301 verso lo
 * stesso percorso su www. Engine-safe:
 * - si attiva SOLO se l'host di PUBLIC_SITE_URL inizia con "www."
 *   (altrimenti il middleware non fa nulla);
 * - non tocca il dominio temporaneo Hostinger né localhost;
 * - non tocca i POST (webhook Stripe, API): un redirect perderebbe
 *   corpo e firma della richiesta.
 */
const SITE = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "";

let hostWww = "";
try {
  hostWww = new URL(SITE).hostname;
} catch {
  // PUBLIC_SITE_URL assente o non valido: middleware inattivo
}
const hostApex = hostWww.startsWith("www.") ? hostWww.slice(4) : "";

const redirectWww = defineMiddleware((context, next) => {
  if (!hostApex) return next();
  const metodo = context.request.method;
  if (metodo !== "GET" && metodo !== "HEAD") return next();
  const url = new URL(context.request.url);
  if (url.hostname !== hostApex) return next();
  url.hostname = hostWww;
  return context.redirect(url.toString(), 301);
});

/**
 * Method override: il WAF di Hostinger BLOCCA il metodo HTTP DELETE quando
 * arriva dai browser mobili (403 prima di arrivare all'app). I client admin
 * e il widget pubblico inviano quindi POST con header X-Method-Override:
 * DELETE, e qui la richiesta viene ricostruita come DELETE vero prima del
 * dispatch — gli endpoint restano INVARIATI. Solo percorsi /api/.
 */
const metodoOverride = defineMiddleware(async (context, next) => {
  const req = context.request;
  if (
    req.method === "POST" &&
    (req.headers.get("x-method-override") ?? "").toUpperCase() === "DELETE" &&
    new URL(req.url).pathname.startsWith("/api/")
  ) {
    const corpo = await req.arrayBuffer();
    const h = new Headers(req.headers);
    h.delete("x-method-override");
    context.request = new Request(req.url, {
      method: "DELETE",
      headers: h,
      body: corpo.byteLength ? corpo : undefined,
    });
  }
  return next();
});

/**
 * RATE LIMITING (anti-abuso / DoS) — solo su /api/*.
 * Limiti per IP + gruppo di endpoint. Gli endpoint che mandano email o
 * costano soldi hanno limiti stretti; le letture pubbliche un limite più
 * ampio; l'admin (autenticato) un tetto anti-runaway generoso.
 * Esclusi: webhook Stripe (firma) e cron (segreto), che si proteggono da soli.
 */
const M = 60_000;
interface Regola { bucket: string; max: number; finestra: number }

function regolaPer(path: string): Regola | null {
  if (!path.startsWith("/api/")) return null;
  if (path === "/api/stripe-webhook" || path.startsWith("/api/cron/")) return null;

  // Endpoint che INVIANO EMAIL → i più stretti
  if (path === "/api/contact" || path === "/api/feedback") return { bucket: "email", max: 5, finestra: M };
  if (path === "/api/reservation") return { bucket: "resa", max: 8, finestra: M };
  // Costano soldi / scrivono ordini
  if (path === "/api/checkout") return { bucket: "checkout", max: 10, finestra: M };
  if (path === "/api/coupon") return { bucket: "coupon", max: 20, finestra: M };
  if (path === "/api/order-cancel" || path === "/api/newsletter-unsubscribe")
    return { bucket: "token", max: 15, finestra: M };
  if (path === "/api/track") return { bucket: "track", max: 40, finestra: M };
  // Admin autenticato: tetto anti-runaway ampio (evita falsi positivi)
  if (path.startsWith("/api/admin/")) return { bucket: "admin", max: 1200, finestra: M };
  // Fallback: tutte le altre letture pubbliche (menu, orari, slots, popup…)
  return { bucket: "pub", max: 60, finestra: M };
}

const rateLimit = defineMiddleware((context, next) => {
  const path = new URL(context.request.url).pathname;
  const r = regolaPer(path);
  if (!r) return next();

  const ip = ipClient(context.request, context.clientAddress);
  const esito = colpisci(`${r.bucket}:${ip}`, r.max, r.finestra);
  if (!esito.ok) {
    return new Response(
      JSON.stringify({ error: "Trop de requêtes. Réessayez dans un instant." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(esito.retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }
  return next();
});

/**
 * Header di sicurezza HTTP, applicati a OGNI risposta.
 * - nosniff: niente MIME sniffing;
 * - frame-options: niente clickjacking (DENY sull'admin, SAMEORIGIN altrove);
 * - referrer-policy / permissions-policy: privacy e riduzione superficie;
 * - HSTS: forza HTTPS (solo in produzione, mai su localhost).
 * NB: la CSP non è impostata qui: l'admin usa script inline (anti-flash) e va
 * introdotta con test dedicati (prima in report-only) per non rompere nulla.
 */
const securityHeaders = defineMiddleware(async (context, next) => {
  // Nonce CSP per-richiesta: disponibile alle pagine via Astro.locals.cspNonce
  // (marcato sugli <script> inline dell'admin) e usato nell'header qui sotto.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  context.locals.cspNonce = nonce;
  const res = await next();
  const path = new URL(context.request.url).pathname;
  let h: Headers;
  try {
    h = res.headers;
    h.set("X-Content-Type-Options", "nosniff");
  } catch {
    return res; // header immutabili (risposta speciale): non tocco nulla
  }
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", path.startsWith("/admin") ? "DENY" : "SAMEORIGIN");
  h.set("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=(self)");
  h.set("X-XSS-Protection", "0"); // deprecato: disattivato esplicitamente (best practice)

  // CSP — base ovunque (niente plugin, niente base-tag injection, form solo
  // verso il proprio dominio, no framing dell'admin) + script-src ENFORCED
  // sull'admin (vedi sotto).
  const admin = path.startsWith("/admin");
  const frameAnc = admin ? "frame-ancestors 'none'" : "frame-ancestors 'self'";
  // CSP ENFORCED. script-src ('self' + nonce per-richiesta) SOLO sull'admin:
  // lì tutti gli <script> inline sono del motore e portano nonce={cspNonce},
  // i <script> processati da Astro diventano bundle serviti da 'self', e i
  // blocchi type="application/json" non sono eseguiti. Il PUBBLICO ha script
  // inline PER-CLIENTE (non nonce-abili dal motore) → niente script-src lì.
  // Verificato in dev (report-only pulito) prima di attivarlo. 04/09/2026.
  const base = `object-src 'none'; base-uri 'self'; form-action 'self'; ${frameAnc}`;
  h.set("Content-Security-Policy", admin ? `${base}; script-src 'self' 'nonce-${nonce}'` : base);
  // Pagine e API admin: MAI in cache (contenuto autenticato; e il nonce CSP è
  // per-richiesta: una pagina cachata riproporrebbe un nonce vecchio).
  if (admin || path.startsWith("/api/admin")) h.set("Cache-Control", "no-store");

  const host = new URL(context.request.url).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  const proto = context.request.headers.get("x-forwarded-proto") ?? new URL(context.request.url).protocol.replace(":", "");
  if (!isLocal && proto === "https") {
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return res;
});

/**
 * GUARD delle pagine /admin — PRIMA del render.
 * Senza questo, la pagina admin veniva renderizzata intera (nav compresa) per
 * chiunque, e solo il JS lato browser rimandava al login: da qui il «lampo»
 * della nav visto dai non loggati. Ora: cookie di sessione `mdd_at` assente o
 * con firma non valida → redirect al login prima di renderizzare qualsiasi cosa.
 * La firma è verificata in locale (JWKS in cache), scadenza ignorata (vedi
 * sessioneRiconosciuta). Solo pagine (GET/HEAD) e mai login/reset-password.
 */
const PUBBLICHE_ADMIN = new Set(["/admin/login", "/admin/reset-password"]);

/** Cosa serve per decidere: ruolo, pagine dell'utente, pagine spente. */
async function contestoPermessi(token: string) {
  const staff = await claimsDaToken(token);
  if (!staff) return null;
  let nascoste: string[] = [];
  try {
    nascoste = (await caricaBootAdmin()).hiddenPages;
  } catch {
    nascoste = [];
  }
  return {
    ruolo: ruoloDi(staff),
    pagineUtente: staff.pages,
    nascoste,
    tutte: PAGINE_ADMIN.map((pg) => pg.key),
  };
}

const authGuardAdmin = defineMiddleware(async (context, next) => {
  const { pathname } = new URL(context.request.url);
  const m = context.request.method;

  // ---- LE API ----------------------------------------------------------
  // Chiudere le pagine non bastava: /admin/stats era sbarrata e
  // /api/admin/stats rispondeva lo stesso a chiunque avesse fatto il login.
  // Qui si risponde 403 e non si redirige: chi chiama e' del codice, non un
  // browser che naviga, e un 302 verso una pagina HTML lo farebbe impazzire.
  // L'autenticazione resta di `verificaStaff` dentro ogni API: qui si decide
  // solo SE quell'utente puo' chiedere questa cosa.
  if (pathname.startsWith("/api/admin/")) {
    const chiave = chiaveApi(pathname);
    if (chiave) {
      const ctx = await contestoPermessi(context.cookies.get("mdd_at")?.value ?? "");
      // Nessun contesto leggibile: non si blocca. Il 401 lo dara' l'API.
      if (ctx && !puoChiamareApi(chiave, ctx)) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    }
    return next();
  }

  if ((m === "GET" || m === "HEAD") && (pathname === "/admin" || pathname.startsWith("/admin/")) && !PUBBLICHE_ADMIN.has(pathname.replace(/\/$/, ""))) {
    const token = context.cookies.get("mdd_at")?.value ?? "";
    if (!(await sessioneRiconosciuta(token))) {
      return context.redirect("/admin/login", 302);
    }

    // ---- PERMESSI: qui, non nel browser ----------------------------------
    // Prima il ruolo era un suggerimento: la nav nascondeva i link e
    // `settings`/`super` si difendevano dentro uno <script>, cioe' DOPO aver
    // mandato la pagina. Chi scriveva /admin/stats riceveva il fatturato del
    // giorno gia' calcolato dal server e incollato nell'HTML.
    //
    // Questo e' l'unico punto da cui passano tutte le pagine admin: la
    // decisione sta qui, e la regola che la prende e' pura e provata.
    //
    // ⚠️ Se i dati della sessione non sono leggibili (JWKS irraggiungibile,
    // token strano) NON si blocca: `sessioneRiconosciuta` e' gia' passata, e
    // trasformare un problema di rete in «non hai il permesso» chiuderebbe
    // fuori il proprietario dal suo admin. Chiudere la porta e' meglio che
    // lasciarla aperta, ma non se la chiave e' il meteo.
    const chiave = chiavePagina(pathname);
    if (chiave) {
      const ctx = await contestoPermessi(token);
      if (ctx) {
        const ok = puoVederePagina(chiave, ctx);
        // Rimandato alla home, non al login: e' loggato, semplicemente quella
        // pagina non e' sua. Un redirect al login sembrerebbe una sessione
        // scaduta e lo farebbe riaccedere all'infinito.
        if (!ok) return context.redirect("/admin", 302);
      }
    }
  }
  return next();
});

export const onRequest = sequence(securityHeaders, authGuardAdmin, rateLimit, metodoOverride, redirectWww);
