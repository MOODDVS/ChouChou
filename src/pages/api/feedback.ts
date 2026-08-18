import type { APIRoute } from "astro";
import { inviaFeedbackCliente } from "../../lib/notifications";

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// POST /api/feedback — riceve il feedback privato (1-3 stelle) dalla pagina
// /feedback e lo inoltra via email al ristoratore (lista email ordini).
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const rating = Math.round(Number(body.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return json({ error: "Note invalide" }, 400);
  }
  const message = String(body.message ?? "").trim().slice(0, 2000);
  const name = String(body.name ?? "").trim().slice(0, 200);
  const email = String(body.email ?? "").trim().slice(0, 200);
  const phone = String(body.phone ?? "").trim().slice(0, 60);
  const order = String(body.order ?? "").trim().slice(0, 40);

  // Sotto-valutazioni facoltative (0 = non valutato)
  const clamp05 = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 0;
  };
  const food = clamp05(body.food);
  const service = clamp05(body.service);
  const atmosphere = clamp05(body.atmosphere);

  if (!message) return json({ error: "Message requis" }, 400);

  const ok = await inviaFeedbackCliente({ rating, message, name, email, phone, order, food, service, atmosphere });
  if (!ok) return json({ error: "Envoi impossible" }, 502);
  return json({ ok: true });
};
