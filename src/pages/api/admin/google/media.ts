import type { APIRoute } from "astro";
import { msg } from "../../../../lib/admin/msgApi";
import { json } from "../../../../lib/rispostaJson";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { tokenGoogle, erroreGoogle, locationSalvata, listaMedia, caricaMedia, eliminaMedia } from "../../../../lib/googleBusiness";
import { ambitoDiRichiesta } from "../../../../lib/admin/sede";

export const prerender = false;



// GET    -> foto della scheda { logo, cover, gallery[] }
// POST   -> carica una foto { url, category }  (LOGO | COVER | ADDITIONAL)
// DELETE (via X-Method-Override) -> elimina una foto { name }


async function preludio(request: Request) {
  const staff = await verificaStaff(request);
  if (!staff) return { err: nonAutorizzato() };
  const { token: token, stato: sttoken } = await tokenGoogle();
  if (!token) return { err: json({ error: await erroreGoogle(sttoken) }, 400) };
  const loc = await locationSalvata(await ambitoDiRichiesta(request, staff));
  if (!loc?.path) return { err: json({ error: await msg("err.googleNotLinked") }, 400) };
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
  try { b = await request.json(); } catch { return json({ error: await msg("err.body") }, 400); }

  if (override === "DELETE") {
    const name = String(b.name ?? "");
    if (!name.startsWith(`${p.path}/media/`)) return json({ error: await msg("err.photoBad") }, 400);
    const { ok, error } = await eliminaMedia(p.token!, name);
    if (!ok) return json({ error: error || (await msg("err.delete")) }, 502);
    return json({ ok: true });
  }

  const url = String(b.url ?? "").trim();
  const category = String(b.category ?? "").trim().toUpperCase();
  if (!/^https?:\/\//i.test(url)) return json({ error: await msg("err.photoUrl") }, 400);
  if (!CAT_OK.includes(category)) return json({ error: await msg("err.category") }, 400);
  const { ok, error } = await caricaMedia(p.token!, p.path!, url, category);
  if (!ok) return json({ error: error || (await msg("err.upload")) }, 502);
  return json({ ok: true });
}

export const POST: APIRoute = async ({ request }) => handlePost(request);
export const DELETE: APIRoute = async ({ request }) => handlePost(request);
