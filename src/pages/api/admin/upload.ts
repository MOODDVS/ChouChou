import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// POST /api/admin/upload — carica un'immagine su Supabase Storage
// e ritorna l'URL pubblico.
// Corpo JSON: { filename: "foto.webp", data: "<base64 senza prefisso>",
//               bucket?: "popups" | "menu" | "documents" } (default: popups)
// Usato dal modale pop-up (Marketing) e dal modale piatto (Menu).

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const TIPI: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
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

  let body: { filename?: string; data?: string; bucket?: string; folder?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  // Bucket di destinazione: solo quelli previsti (mai libero dal client)
  const bucket =
    body.bucket === "menu" || body.bucket === "documents" || body.bucket === "brand" ? body.bucket : "popups";

  const filename = (body.filename ?? "").trim();
  const estensione = filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType = TIPI[estensione];
  if (!contentType) {
    return json({ error: "Format non supporté (jpg, png, webp, gif, svg, pdf)" }, 400);
  }
  // I PDF vanno SOLO nel bucket documents (e viceversa)
  if ((contentType === "application/pdf") !== (bucket === "documents")) {
    return json({ error: "Format et destination incohérents" }, 400);
  }
  // Le favicon .ico SOLO nel bucket brand
  if (contentType === "image/x-icon" && bucket !== "brand") {
    return json({ error: "Format et destination incohérents" }, 400);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(body.data ?? "", "base64");
  } catch {
    return json({ error: "Fichier illisible" }, 400);
  }
  if (bytes.length === 0) return json({ error: "Fichier vide" }, 400);
  const maxBytes = bucket === "documents" ? 10 * 1024 * 1024 : MAX_BYTES;
  if (bytes.length > maxBytes) {
    return json({ error: bucket === "documents" ? "Fichier trop lourd (max 10 Mo)" : "Fichier trop lourd (max 4 Mo)" }, 400);
  }

  // Nome unico: timestamp + nome pulito (niente collisioni, niente caratteri strani)
  const pulito = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-60);
  // Cartella opzionale (slug sicuro) per tenere ordinati i file per sezione.
  const folder = String(body.folder ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "").slice(0, 32);
  const path = folder ? `${folder}/${Date.now()}-${pulito}` : `${Date.now()}-${pulito}`;

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) return json({ error: "Téléversement impossible" }, 500);

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return json({ ok: true, url: data.publicUrl }, 201);
};
