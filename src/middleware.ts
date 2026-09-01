import { defineMiddleware, sequence } from "astro:middleware";
import { colpisci, ipClient } from "./lib/rateLimit";

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

  // CSP — sottoinsieme SICURO da applicare (non limita il caricamento di
  // script/img/connect legittimi, quindi non rompe nulla): niente plugin,
  // niente base-tag injection, form solo verso il proprio dominio, e niente
  // framing dell'admin (anti-clickjacking). La CSP completa su script-src
  // richiede test dedicati (inline anti-flash) → TODO separato.
  const frameAnc = path.startsWith("/admin") ? "frame-ancestors 'none'" : "frame-ancestors 'self'";
  h.set("Content-Security-Policy", `object-src 'none'; base-uri 'self'; form-action 'self'; ${frameAnc}`);

  const host = new URL(context.request.url).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  const proto = context.request.headers.get("x-forwarded-proto") ?? new URL(context.request.url).protocol.replace(":", "");
  if (!isLocal && proto === "https") {
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return res;
});

/**
 * Cache edge (CDN Hostinger / Cloudflare) delle SOLE pagine pubbliche di
 * contenuto (home, carte, épicerie, contact, agenda + événement, links,
 * privacy, cookies), FR e EN. Si invia:
 *   Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=600
 * -> il browser rivalida sempre (contenuto fresco per l'utente), ma una cache
 *    condivisa/edge può servire l'HTML per 60s: TTFB quasi azzerato.
 * NON tocca: /api, /admin, il widget /reservation-embed, feedback, order,
 * annulla-token e le pagine con stato dinamico per-utente. Engine-safe.
 */
const CACHE_BASI = ["/menu", "/epicerie", "/contact", "/agenda", "/links", "/privacy", "/cookies"];
function paginaPubblicaCachabile(pathname: string): boolean {
  let p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/en") p = "/";
  else if (p.startsWith("/en/")) p = p.slice(3) || "/";
  if (p === "/") return true;
  return CACHE_BASI.some((b) => p === b || p.startsWith(b + "/"));
}

const cacheEdge = defineMiddleware(async (context, next) => {
  const res = await next();
  const metodo = context.request.method;
  if (metodo !== "GET" && metodo !== "HEAD") return res;
  if (res.status !== 200) return res;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html")) return res;
  const { pathname } = new URL(context.request.url);
  if (!paginaPubblicaCachabile(pathname)) return res;
  // Non sovrascrive un eventuale Cache-Control già impostato dalla pagina.
  if (!res.headers.has("cache-control")) {
    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
  }
  return res;
});

export const onRequest = sequence(securityHeaders, rateLimit, metodoOverride, redirectWww, cacheEdge);
