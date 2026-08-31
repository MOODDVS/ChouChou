import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { accessToken, locationSalvata, listaPost, creaPost, eliminaPost } from "../../../../lib/googleBusiness";

export const prerender = false;

// GET    /api/admin/google/posts              -> lista dei post pubblicati
// POST   /api/admin/google/posts   body {...} -> crea un post (STANDARD | EVENT | OFFER)
// DELETE /api/admin/google/posts?name=...     (via POST + X-Method-Override) -> elimina

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const CTA_OK = new Set(["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"]);

function dataGoogle(iso: unknown): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { year: y, month: mo, day: d };
}

function urlSicuro(u: unknown): string | null {
  const s = String(u ?? "").trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : null;
}

async function preludio(request: Request) {
  const staff = await verificaStaff(request);
  if (!staff) return { err: nonAutorizzato() };
  const token = await accessToken();
  if (!token) return { err: json({ error: "Google non collegato" }, 400) };
  const loc = await locationSalvata();
  if (!loc?.path) return { err: json({ error: "Scheda Google non configurata" }, 400) };
  return { token, path: loc.path };
}

export const GET: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;
  const { posts, error } = await listaPost(p.token!, p.path!);
  if (error) return json({ error }, 502);
  return json({ posts });
};

export const POST: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;

  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: "Corps invalide" }, 400); }

  const tipo = String(b.tipo ?? "STANDARD").toUpperCase();
  const lang = (String(b.lang ?? "fr").toLowerCase().slice(0, 5)) || "fr";
  const summary = String(b.summary ?? "").trim().slice(0, 1500);
  const photo = urlSicuro(b.photo);

  const corpo: Record<string, unknown> = { languageCode: lang };
  if (summary) corpo.summary = summary;
  if (photo) corpo.media = [{ mediaFormat: "PHOTO", sourceUrl: photo }];

  // Call to action (STANDARD ed EVENT)
  const ctaTipo = String(b.ctaType ?? "").toUpperCase();
  if ((tipo === "STANDARD" || tipo === "EVENT") && ctaTipo && CTA_OK.has(ctaTipo)) {
    if (ctaTipo === "CALL") {
      corpo.callToAction = { actionType: "CALL" };
    } else {
      const u = urlSicuro(b.ctaUrl);
      if (!u) return json({ error: "Lien du bouton invalide (http/https)" }, 400);
      corpo.callToAction = { actionType: ctaTipo, url: u };
    }
  }

  if (tipo === "EVENT" || tipo === "OFFER") {
    const title = String(b.title ?? "").trim().slice(0, 58);
    const d1 = dataGoogle(b.startDate);
    const d2 = dataGoogle(b.endDate);
    if (!title) return json({ error: "Titre requis" }, 400);
    if (!d1 || !d2) return json({ error: "Dates requises (début et fin)" }, 400);
    corpo.event = { title, schedule: { startDate: d1, endDate: d2 } };
  }

  if (tipo === "STANDARD") {
    if (!summary && !photo) return json({ error: "Texte ou photo requis" }, 400);
    corpo.topicType = "STANDARD";
  } else if (tipo === "EVENT") {
    corpo.topicType = "EVENT";
  } else if (tipo === "OFFER") {
    corpo.topicType = "OFFER";
    const offer: Record<string, string> = {};
    const coupon = String(b.couponCode ?? "").trim().slice(0, 58);
    const redeem = urlSicuro(b.redeemUrl);
    const terms = String(b.terms ?? "").trim().slice(0, 5000);
    if (coupon) offer.couponCode = coupon;
    if (redeem) offer.redeemOnlineUrl = redeem;
    if (terms) offer.termsConditions = terms;
    if (Object.keys(offer).length) corpo.offer = offer;
  } else {
    return json({ error: "Type inconnu" }, 400);
  }

  const { ok, error, post } = await creaPost(p.token!, p.path!, corpo);
  if (!ok) return json({ error: error || "Publication impossible" }, 502);
  return json({ ok: true, post });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const p = await preludio(request);
  if (p.err) return p.err;
  const name = url.searchParams.get("name") ?? "";
  if (!name || !name.includes("/localPosts/")) return json({ error: "name manquant" }, 400);
  const ok = await eliminaPost(p.token!, name);
  if (!ok) return json({ error: "Suppression impossible" }, 502);
  return json({ ok: true });
};
