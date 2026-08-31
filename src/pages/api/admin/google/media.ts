import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { accessToken, locationSalvata, listaMedia, caricaMedia, eliminaMedia } from "../../../../lib/googleBusiness";

export const prerender = false;

// GET    -> foto della scheda { logo, cover, gallery[] }
// POST   -> carica una foto { url, category }  (LOGO | COVER | ADDITIONAL)
// DELETE (via X-Method-Override) -> elimina una foto { name }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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

const CAT_OK = ["LOGO", "COVER", "ADDITIONAL"];

export const GET: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;
  const { media, error } = await listaMedia(p.token!, p.path!);
  if (error) return json({ error }, 502);
  const logo = media.find((m) => m.category === "LOGO") ?? media.find((m) => m.category === "PROFILE") ?? null;
  const cover = media.find((m) => m.category === "COVER") ?? null;
  const escl = ["LOGO", "PROFILE", "COVER"];
  const gallery = media.filter((m) => !escl.includes(m.category));
  return json({ logo, cover, gallery });
};

async function handlePost(request: Request) {
  const p = await preludio(request);
  if (p.err) return p.err;

  const override = request.headers.get("X-Method-Override");
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ error: "Corps invalide" }, 400); }

  if (override === "DELETE") {
    const name = String(b.name ?? "");
    if (!name.startsWith(`${p.path}/media/`)) return json({ error: "Foto non valida" }, 400);
    const { ok, error } = await eliminaMedia(p.token!, name);
    if (!ok) return json({ error: error || "Eliminazione impossibile" }, 502);
    return json({ ok: true });
  }

  const url = String(b.url ?? "").trim();
  const category = String(b.category ?? "").trim().toUpperCase();
  if (!/^https?:\/\//i.test(url)) return json({ error: "URL foto non valido" }, 400);
  if (!CAT_OK.includes(category)) return json({ error: "Categoria non valida" }, 400);
  const { ok, error } = await caricaMedia(p.token!, p.path!, url, category);
  if (!ok) return json({ error: error || "Caricamento impossibile" }, 502);
  return json({ ok: true });
}

export const POST: APIRoute = async ({ request }) => handlePost(request);
export const DELETE: APIRoute = async ({ request }) => handlePost(request);
