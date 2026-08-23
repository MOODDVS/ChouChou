import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// Bibliothèque d'images (admin → Images) : tutte le immagini caricate
// nei bucket Storage `menu` (foto dei piatti) e `popups` (pop-up e
// newsletter), con l'indicazione di dove ogni immagine è utilizzata.
// Le foto dei contatti Team (stesso bucket `popups`) sono ESCLUSE
// dalla bibliothèque (scelta Enzo 2026-07-17) e protette dal DELETE.
// GET                   → { images: [{ bucket, name, url, size, created_at, used_by }] }
// DELETE ?bucket=&name= → elimina il file (bloccato se l'immagine è usata)
// PATCH { bucket, name, new_name, data? } → rinomina e/o sostituisce con
//   la versione compressa (data = base64); i riferimenti nei piatti e
//   nei pop-up vengono aggiornati al nuovo URL

const BUCKETS = ["menu", "popups"] as const;
type Bucket = (typeof BUCKETS)[number];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Un utilizzo dell'immagine: etichetta leggibile + categoria.
 *  I tag Menu/Marketing derivano dall'USO, non dal bucket: un'immagine
 *  usata da un piatto E da un pop-up ha entrambi i tag; una mai usata
 *  non ha alcuna correlazione ("Libre"). */
type Uso = { label: string; kind: "menu" | "marketing" };

async function mappaUsi(): Promise<Map<string, Uso[]>> {
  const usi = new Map<string, Uso[]>();
  const aggiungi = (url: string | null, uso: Uso) => {
    if (!url) return;
    const arr = usi.get(url) ?? [];
    arr.push(uso);
    usi.set(url, arr);
  };
  const [piatti, pops, eventi] = await Promise.all([
    supabaseAdmin.from("menu_items").select("name, image_url").not("image_url", "is", null),
    supabaseAdmin.from("popups").select("title, title_en, image_url").not("image_url", "is", null),
    supabaseAdmin.from("agenda_events").select("title, image_url").not("image_url", "is", null),
  ]);
  for (const p of piatti.data ?? []) aggiungi(p.image_url, { label: `Plat : ${p.name}`, kind: "menu" });
  for (const p of pops.data ?? [])
    aggiungi(p.image_url, { label: `Pop-up : ${p.title || p.title_en || "sans titre"}`, kind: "marketing" });
  for (const e of eventi.data ?? [])
    aggiungi((e as { image_url?: string | null }).image_url ?? null, { label: `Événement : ${(e as { title?: string }).title ?? ""}`, kind: "marketing" });
  return usi;
}

const TIPI: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

/** Nome file pulito e con estensione valida; null se irrecuperabile. */
function pulisciNome(nome: string): string | null {
  const pulito = nome
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 80);
  const ext = pulito.split(".").pop() ?? "";
  if (!pulito || pulito.includes("..") || !TIPI[ext]) return null;
  return pulito;
}

/** Dopo rinomina/sostituzione: aggiorna i riferimenti al nuovo URL. */
async function aggiornaRiferimenti(vecchio: string, nuovo: string): Promise<void> {
  await supabaseAdmin.from("menu_items").update({ image_url: nuovo }).eq("image_url", vecchio);
  await supabaseAdmin.from("popups").update({ image_url: nuovo }).eq("image_url", vecchio);
}

/** URL delle foto dei contatti Team E dei CLIENTI: esclusi dalla
 *  bibliothèque (sono avatar privati, non asset riutilizzabili). */
async function fotoTeam(): Promise<Set<string>> {
  const escluse = new Set<string>();
  try {
    const { data } = await supabaseAdmin
      .from("team")
      .select("photo_url")
      .not("photo_url", "is", null);
    for (const r of data ?? []) escluse.add(String(r.photo_url));
  } catch { /* tabella assente */ }
  try {
    const { data } = await supabaseAdmin
      .from("clients")
      .select("photo_url")
      .not("photo_url", "is", null);
    for (const r of data ?? []) escluse.add(String(r.photo_url));
  } catch { /* migrazione #31 non lanciata */ }
  return escluse;
}

/** Elenco RICORSIVO dei file di un bucket: entra anche nelle sottocartelle
 *  (es. popups/agenda/…). Le voci "cartella" (id null) vengono espanse. */
async function listaFile(
  bucket: string,
  prefix = "",
  depth = 0
): Promise<{ path: string; size: number; created_at: string }[]> {
  if (depth > 3) return [];
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
  if (error || !data) return [];
  const out: { path: string; size: number; created_at: string }[] = [];
  for (const f of data) {
    if (!f.name || f.name.startsWith(".")) continue;
    const full = prefix ? `${prefix}/${f.name}` : f.name;
    const isFolder = f.id === null || f.metadata == null;
    if (isFolder) {
      out.push(...(await listaFile(bucket, full, depth + 1)));
    } else {
      out.push({
        path: full,
        size: Number((f.metadata as Record<string, unknown> | null)?.size ?? 0),
        created_at: f.created_at ?? "",
      });
    }
  }
  return out;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const [usi, escluse] = await Promise.all([mappaUsi(), fotoTeam()]);
  const images: {
    bucket: Bucket;
    name: string;
    url: string;
    size: number;
    created_at: string;
    used_by: string[];
    tags: string[];
  }[] = [];

  for (const bucket of BUCKETS) {
    const files = await listaFile(bucket, "", 0);
    for (const f of files) {
      const url = supabaseAdmin.storage.from(bucket).getPublicUrl(f.path).data.publicUrl;
      if (escluse.has(url)) continue; // foto di un contatto Team: non è nella bibliothèque
      const usiImg = usi.get(url) ?? [];
      images.push({
        bucket,
        name: f.path,
        url,
        size: f.size,
        created_at: f.created_at,
        used_by: usiImg.map((u) => u.label),
        tags: [...new Set(usiImg.map((u) => u.kind))],
      });
    }
  }
  images.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return json({ images });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const bucketParam = url.searchParams.get("bucket") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!(BUCKETS as readonly string[]).includes(bucketParam)) {
    return json({ error: "Bucket invalide" }, 400);
  }
  const bucket = bucketParam as Bucket;
  if (!name || name.includes("..") || name.startsWith("/")) {
    return json({ error: "Nom invalide" }, 400);
  }

  // Un'immagine ancora utilizzata da un piatto o un pop-up non si elimina
  const publicUrl = supabaseAdmin.storage.from(bucket).getPublicUrl(name).data.publicUrl;
  const [usi, escluse] = await Promise.all([mappaUsi(), fotoTeam()]);
  const dove = usi.get(publicUrl);
  if (dove?.length) {
    return json({ error: `Image utilisée par : ${dove.map((u) => u.label).join(", ")}` }, 409);
  }
  if (escluse.has(publicUrl)) {
    return json({ error: "Photo d'un contact (Team) ou d'un client — gérée depuis sa fiche" }, 409);
  }

  const { error } = await supabaseAdmin.storage.from(bucket).remove([name]);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};

// PATCH /api/admin/images — rinomina e/o sostituisce (versione compressa).
// body: { bucket, name, new_name, data? } — data = base64 del file compresso.
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { bucket?: string; name?: string; new_name?: string; data?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const bucketParam = body.bucket ?? "";
  const name = body.name ?? "";
  if (!(BUCKETS as readonly string[]).includes(bucketParam)) {
    return json({ error: "Bucket invalide" }, 400);
  }
  const bucket = bucketParam as Bucket;
  if (!name || name.includes("..") || name.startsWith("/")) {
    return json({ error: "Nom invalide" }, 400);
  }
  const nuovoNome = pulisciNome(body.new_name ?? "");
  if (!nuovoNome) return json({ error: "Nouveau nom invalide" }, 400);

  const vecchioUrl = supabaseAdmin.storage.from(bucket).getPublicUrl(name).data.publicUrl;

  // Le foto dei contatti Team non si toccano da qui
  if ((await fotoTeam()).has(vecchioUrl)) {
    return json({ error: "Photo d'un contact (Team) ou d'un client — gérée depuis sa fiche" }, 409);
  }

  // --- Sostituzione con la versione compressa ---
  if (body.data) {
    const ext = nuovoNome.split(".").pop() ?? "";
    let bytes: Buffer;
    try {
      bytes = Buffer.from(body.data, "base64");
    } catch {
      return json({ error: "Fichier illisible" }, 400);
    }
    if (bytes.length === 0) return json({ error: "Fichier vide" }, 400);
    if (bytes.length > 4 * 1024 * 1024) return json({ error: "Fichier trop lourd (max 4 Mo)" }, 400);

    const sovrascrive = nuovoNome === name;
    const { error: errUp } = await supabaseAdmin.storage
      .from(bucket)
      .upload(nuovoNome, bytes, { contentType: TIPI[ext], upsert: sovrascrive });
    if (errUp) return json({ error: "Ce nom existe déjà ou téléversement impossible" }, 409);

    if (!sovrascrive) {
      const nuovoUrl = supabaseAdmin.storage.from(bucket).getPublicUrl(nuovoNome).data.publicUrl;
      await aggiornaRiferimenti(vecchioUrl, nuovoUrl);
      await supabaseAdmin.storage.from(bucket).remove([name]);
      return json({ ok: true, name: nuovoNome, url: nuovoUrl });
    }
    return json({ ok: true, name, url: vecchioUrl });
  }

  // --- Semplice rinomina ---
  if (nuovoNome === name) return json({ ok: true, name, url: vecchioUrl });
  const { error: errMove } = await supabaseAdmin.storage.from(bucket).move(name, nuovoNome);
  if (errMove) return json({ error: "Ce nom existe déjà ou renommage impossible" }, 409);
  const nuovoUrl = supabaseAdmin.storage.from(bucket).getPublicUrl(nuovoNome).data.publicUrl;
  await aggiornaRiferimenti(vecchioUrl, nuovoUrl);
  return json({ ok: true, name: nuovoNome, url: nuovoUrl });
};
