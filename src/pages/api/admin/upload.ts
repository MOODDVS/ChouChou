import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/adminAuth";

export const prerender = false;

// POST /api/admin/upload — carica un'immagine su Supabase Storage
// (bucket pubblico `popups`) e ritorna l'URL pubblico.
// Corpo JSON: { filename: "foto.webp", data: "<base64 senza prefisso>" }
// Usato dal modale pop-up (Marketing) per il campo Image.

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const TIPI: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { filename?: string; data?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const filename = (body.filename ?? "").trim();
  const estensione = filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType = TIPI[estensione];
  if (!contentType) {
    return json({ error: "Format non supporté (jpg, png, webp, gif, svg)" }, 400);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(body.data ?? "", "base64");
  } catch {
    return json({ error: "Fichier illisible" }, 400);
  }
  if (bytes.length === 0) return json({ error: "Fichier vide" }, 400);
  if (bytes.length > MAX_BYTES) return json({ error: "Fichier trop lourd (max 4 Mo)" }, 400);

  // Nome unico: timestamp + nome pulito (niente collisioni, niente caratteri strani)
  const pulito = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-60);
  const path = `${Date.now()}-${pulito}`;

  const { error } = await supabaseAdmin.storage
    .from("popups")
    .upload(path, bytes, { contentType, upsert: false });
  if (error) return json({ error: "Téléversement impossible" }, 500);

  const { data } = supabaseAdmin.storage.from("popups").getPublicUrl(path);
  return json({ ok: true, url: data.publicUrl }, 201);
};
