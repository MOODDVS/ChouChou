import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// Documents (admin → Assets → Documents) : PDF nel bucket `documents`.
// Ogni PDF può avere un'ANTEPRIMA (prima pagina in webp) salvata come
// file nascosto `.thumb-<nome>.webp` nello stesso bucket: generata dal
// browser al caricamento (pdf.js), segue il PDF in rinomina/eliminazione.
// GET             → { documents: [{ name, url, thumb_url, size, created_at }] }
// POST { name, thumb } → attacca l'anteprima (base64 webp, max 512 Ko)
// DELETE ?name=   → elimina il file (+ anteprima)
// PATCH { name, new_name } → rinomina (estensione .pdf obbligatoria)

const BUCKET = "documents";

function thumbDi(nome: string): string {
  return `.thumb-${nome}.webp`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function nomeValido(nome: string): boolean {
  return !!nome && !nome.includes("/") && !nome.includes("..");
}

/** Nome file pulito, estensione .pdf garantita; null se irrecuperabile. */
function pulisciNome(nome: string): string | null {
  const pulito = nome
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 80);
  if (!pulito || pulito.includes("..") || !pulito.endsWith(".pdf")) return null;
  return pulito;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .list("", { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
  if (error) return json({ documents: [] }); // bucket non ancora creato

  const files = (data ?? []).filter((f) => !!f.name);
  const nascosti = new Set(files.filter((f) => f.name.startsWith(".")).map((f) => f.name));
  const documents = files
    .filter((f) => !f.name.startsWith("."))
    .map((f) => ({
      name: f.name,
      url: supabaseAdmin.storage.from(BUCKET).getPublicUrl(f.name).data.publicUrl,
      thumb_url: nascosti.has(thumbDi(f.name))
        ? supabaseAdmin.storage.from(BUCKET).getPublicUrl(thumbDi(f.name)).data.publicUrl
        : null,
      size: Number((f.metadata as Record<string, unknown> | null)?.size ?? 0),
      created_at: f.created_at ?? "",
    }));
  return json({ documents });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const name = url.searchParams.get("name") ?? "";
  if (!nomeValido(name)) return json({ error: "Nom invalide" }, 400);

  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([name, thumbDi(name)]);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};

// POST — attacca l'anteprima (prima pagina) a un PDF esistente
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { name?: string; thumb?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const name = body.name ?? "";
  if (!nomeValido(name) || !name.endsWith(".pdf")) return json({ error: "Nom invalide" }, 400);

  let bytes: Buffer;
  try {
    bytes = Buffer.from(body.thumb ?? "", "base64");
  } catch {
    return json({ error: "Aperçu illisible" }, 400);
  }
  if (bytes.length === 0 || bytes.length > 512 * 1024) return json({ error: "Aperçu invalide" }, 400);

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(thumbDi(name), bytes, { contentType: "image/webp", upsert: true });
  if (error) return json({ error: "Enregistrement impossible" }, 500);
  return json({ ok: true });
};

export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { name?: string; new_name?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const name = body.name ?? "";
  if (!nomeValido(name)) return json({ error: "Nom invalide" }, 400);
  const nuovoNome = pulisciNome(body.new_name ?? "");
  if (!nuovoNome) return json({ error: "Nouveau nom invalide" }, 400);
  if (nuovoNome === name) {
    const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
    return json({ ok: true, name, url });
  }

  const { error } = await supabaseAdmin.storage.from(BUCKET).move(name, nuovoNome);
  if (error) return json({ error: "Ce nom existe déjà ou renommage impossible" }, 409);
  // L'anteprima segue il PDF (se non esiste, l'errore si ignora)
  await supabaseAdmin.storage.from(BUCKET).move(thumbDi(name), thumbDi(nuovoNome));
  const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(nuovoNome).data.publicUrl;
  return json({ ok: true, name: nuovoNome, url });
};
