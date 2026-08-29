import { defineMiddleware, sequence } from "astro:middleware";

/**
 * Host canonico: forza il www.
 * Se PUBLIC_SITE_URL = https://www.dominiocliente.be, ogni richiesta GET/HEAD
 * arrivata su dominiocliente.be (apex, senza www) riceve un 301 verso lo
 * stesso percorso su www. Engine-safe:
 * - si attiva SOLO se l’host di PUBLIC_SITE_URL inizia con "www."
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

export const onRequest = sequence(metodoOverride, redirectWww, cacheEdge);
