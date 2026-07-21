import { defineMiddleware, sequence } from "astro:middleware";

/**
 * Host canonico: forza il www.
 * Se PUBLIC_SITE_URL = https://www.lamolisana.be, ogni richiesta GET/HEAD
 * arrivata su lamolisana.be (apex, senza www) riceve un 301 verso lo
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

export const onRequest = sequence(metodoOverride, redirectWww);
