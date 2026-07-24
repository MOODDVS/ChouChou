import type { APIRoute } from "astro";
import { Resend } from "resend";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { datiRistorante } from "../../../lib/ristorante";

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const RESEND_FROM = import.meta.env.RESEND_FROM;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export const prerender = false;

// Documents della pagina ADMIN (tab Documents): PDF classificati per
// CATEGORIA in cartelle del bucket `documents` (contrat/ facture/ recu/
// legal/ autre/). Il tab Assets → Documents usa la RADICE del bucket:
// i due archivi non si mischiano.
// - Anteprima `.thumb-<nome>.webp` nella stessa cartella (pdf.js, browser).
// - METADATI (#40, admin_docs_meta, chiave = "cat/nome"): email di
//   riferimento, scadenza e preavviso — pensati per i CONTRATTI.
//   Tutte le operazioni sui metadati sono best-effort: senza la #40
//   i documents funzionano lo stesso, semplicemente senza scadenze.
// GET  → { documents: [{ cat, name, url, thumb_url, size, created_at,
//                        email, expires, notice_value, notice_unit }] }
// POST { cat, filename, data, email?, expires?, notice_value?, notice_unit? }
//      → upload PDF (base64, max 10 Mo) → { name, url }
// POST { cat, name, thumb } → attacca l'anteprima (base64 webp, max 512 Ko)
// PATCH { cat, name, new_name?, new_cat?, email?, expires?, notice_value?, notice_unit? }
//      → rinomina / cambia categoria / aggiorna metadati
// DELETE ?cat=&name= → elimina (client: POST + X-Method-Override)

const BUCKET = "documents";
const CATS = ["contrat", "facture", "recu", "legal", "autre"];
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function frData(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Lettera FORMALE di résiliation: fondo bianco, serif, firma semplice. */
function htmlResiliation(p: {
  societa: string; vat: string; nome: string; indirizzo: string; tel: string; email: string;
  file: string; scadenza: string; preavviso: string;
}): string {
  const quando = p.scadenza
    ? ` à son échéance du <b>${escHtml(p.scadenza)}</b>`
    : " à la prochaine échéance contractuelle";
  const preavviso = p.preavviso ? `, dans le respect du préavis prévu (${escHtml(p.preavviso)})` : "";
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px 12px;background:#f2f0ed;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d8d3cd;padding:40px 44px;color:#222222;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.75;">
    <p style="margin:0 0 18px;">Madame, Monsieur,</p>
    <p style="margin:0 0 18px;">Par la présente, nous vous informons de notre volonté de <b>résilier le contrat</b> « ${escHtml(p.file)} » qui lie votre société à la nôtre,${quando}${preavviso}.</p>
    <p style="margin:0 0 18px;">Nous vous prions de bien vouloir <b>confirmer la bonne réception</b> de la présente demande ainsi que la prise en compte de la résiliation à la date indiquée.</p>
    <p style="margin:0 0 18px;">Si la résiliation ne peut être valablement demandée par simple email, nous vous remercions de nous <b>indiquer en réponse la procédure à suivre</b> (courrier recommandé, formulaire dédié ou autre modalité), afin que nous puissions l'accomplir dans les délais.</p>
    <p style="margin:0 0 18px;">Nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.</p>
    <div style="margin-top:30px;border-top:1px solid #e3ded8;padding-top:18px;font-size:14px;line-height:1.7;color:#333333;">
      <b style="font-size:15px;">${escHtml(p.societa)}</b> — ${escHtml(p.nome)}<br />
      ${escHtml(p.indirizzo)}<br />
      ${p.vat ? escHtml(p.vat) + "<br />" : ""}
      ${escHtml(p.tel)} · ${escHtml(p.email)}
    </div>
  </div>
</body>
</html>`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function thumbDi(nome: string): string {
  return `.thumb-${nome}.webp`;
}

function catValida(cat: string): boolean {
  return CATS.includes(cat);
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

interface Meta {
  email: string | null;
  expires: string | null;
  notice_value: number | null;
  notice_unit: string | null;
  resiliation_at?: string | null; // solo in lettura (GET)
}

/** Metadati dal body (solo per i contrats; per le altre categorie → null). */
function metaDalBody(body: Record<string, unknown>, cat: string): Meta {
  if (cat !== "contrat") return { email: null, expires: null, notice_value: null, notice_unit: null };
  const email = String(body.email ?? "").trim().slice(0, 120) || null;
  const exp = String(body.expires ?? "").trim();
  const expires = RE_DATA.test(exp) ? exp : null;
  const nv = Math.round(Number(body.notice_value));
  const notice_value = Number.isFinite(nv) && nv > 0 && nv <= 365 ? nv : null;
  const unit = String(body.notice_unit ?? "");
  const notice_unit = notice_value && (unit === "jours" || unit === "mois") ? unit : notice_value ? "mois" : null;
  return { email, expires, notice_value, notice_unit };
}

/** Upsert / pulizia della riga metadati (best-effort: mai bloccante). */
async function salvaMeta(path: string, meta: Meta) {
  try {
    if (!meta.email && !meta.expires && !meta.notice_value) {
      await supabaseAdmin.from("admin_docs_meta").delete().eq("path", path);
      return;
    }
    await supabaseAdmin
      .from("admin_docs_meta")
      .upsert({ path, ...meta, updated_at: new Date().toISOString() }, { onConflict: "path" });
  } catch {
    /* migrazione #40 assente: si va avanti senza metadati */
  }
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Metadati (se la #40 è lanciata)
  const metaMap = new Map<string, Meta>();
  try {
    const { data } = await supabaseAdmin.from("admin_docs_meta").select("path, email, expires, notice_value, notice_unit, resiliation_at");
    for (const r of data ?? []) metaMap.set(r.path, r as unknown as Meta);
  } catch {
    /* senza metadati */
  }

  const documents: Record<string, unknown>[] = [];
  for (const cat of CATS) {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(cat, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
    if (error) continue; // cartella non ancora creata
    const files = (data ?? []).filter((f) => !!f.name);
    const nascosti = new Set(files.filter((f) => f.name.startsWith(".")).map((f) => f.name));
    for (const f of files) {
      if (f.name.startsWith(".")) continue;
      const meta = metaMap.get(`${cat}/${f.name}`);
      documents.push({
        cat,
        name: f.name,
        url: supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${cat}/${f.name}`).data.publicUrl,
        thumb_url: nascosti.has(thumbDi(f.name))
          ? supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${cat}/${thumbDi(f.name)}`).data.publicUrl
          : null,
        size: Number((f.metadata as Record<string, unknown> | null)?.size ?? 0),
        created_at: f.created_at ?? "",
        email: meta?.email ?? null,
        expires: meta?.expires ?? null,
        notice_value: meta?.notice_value ?? null,
        notice_unit: meta?.notice_unit ?? null,
        resiliation_at: meta?.resiliation_at ?? null,
      });
    }
  }
  documents.sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1));
  return json({ documents });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const cat = String(body.cat ?? "");
  if (!catValida(cat)) return json({ error: "Catégorie invalide" }, 400);

  // ---- Richiesta FORMALE di résiliation del contratto (email al référent) ----
  if (body.resiliation === true) {
    if (cat !== "contrat") return json({ error: "Réservé aux contrats" }, 400);
    const name = String(body.name ?? "");
    if (!nomeValido(name)) return json({ error: "Nom invalide" }, 400);
    if (!resend || !RESEND_FROM) return json({ error: "Resend non configuré" }, 500);

    let meta: Record<string, unknown> | null = null;
    try {
      const { data } = await supabaseAdmin
        .from("admin_docs_meta")
        .select("email, expires, notice_value, notice_unit")
        .eq("path", `contrat/${name}`)
        .maybeSingle();
      meta = data;
    } catch {
      meta = null;
    }
    const dest = String(meta?.email ?? "").trim();
    if (!dest) return json({ error: "Email de référence manquante — modifie le document et ajoute-la" }, 400);

    const dati = await datiRistorante();
    const { data: cfg } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", ["company_name", "company_vat"]);
    const m = new Map((cfg ?? []).map((r) => [r.key, String(r.value ?? "").trim()]));
    const societa = m.get("company_name") || dati.nome;
    const scadIso = String(meta?.expires ?? "");
    const nv = Number(meta?.notice_value ?? 0);
    const preavviso = nv > 0 ? `${nv} ${String(meta?.notice_unit ?? "mois")}` : "";

    const html = htmlResiliation({
      societa,
      vat: m.get("company_vat") ?? "",
      nome: dati.nome,
      indirizzo: dati.indirizzo,
      tel: dati.tel,
      email: dati.email,
      file: name,
      scadenza: RE_DATA.test(scadIso) ? frData(scadIso) : "",
      preavviso,
    });
    try {
      await resend.emails.send({
        from: RESEND_FROM as string,
        to: dest,
        replyTo: dati.email, // la risposta del fornitore arriva al ristorante
        subject: `Demande de résiliation de contrat — ${societa} (${name})`,
        html,
      });
    } catch {
      return json({ error: "Envoi impossible" }, 502);
    }
    const adesso = new Date().toISOString();
    try {
      await supabaseAdmin
        .from("admin_docs_meta")
        .update({ resiliation_at: adesso, updated_at: adesso })
        .eq("path", `contrat/${name}`);
    } catch {
      /* senza #40 aggiornata: l'email è comunque partita */
    }
    return json({ ok: true, resiliation_at: adesso });
  }

  // ---- Anteprima (webp) di un PDF esistente ----
  if (body.thumb !== undefined) {
    const name = String(body.name ?? "");
    if (!nomeValido(name) || !name.endsWith(".pdf")) return json({ error: "Nom invalide" }, 400);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(String(body.thumb ?? ""), "base64");
    } catch {
      return json({ error: "Aperçu illisible" }, 400);
    }
    if (bytes.length === 0 || bytes.length > 512 * 1024) return json({ error: "Aperçu invalide" }, 400);
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(`${cat}/${thumbDi(name)}`, bytes, { contentType: "image/webp", upsert: true });
    if (error) return json({ error: "Enregistrement impossible" }, 500);
    return json({ ok: true });
  }

  // ---- Upload del PDF (+ metadati contratto) ----
  const nome = pulisciNome(String(body.filename ?? ""));
  if (!nome) return json({ error: "Nom invalide (PDF uniquement)" }, 400);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(String(body.data ?? ""), "base64");
  } catch {
    return json({ error: "Fichier illisible" }, 400);
  }
  if (bytes.length === 0) return json({ error: "Fichier vide" }, 400);
  if (bytes.length > 10 * 1024 * 1024) return json({ error: "Fichier trop lourd (max 10 Mo)" }, 400);

  // Timestamp nel nome: niente collisioni (rinominabile dopo)
  const fileName = `${Date.now()}-${nome}`;
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(`${cat}/${fileName}`, bytes, { contentType: "application/pdf", upsert: false });
  if (error) return json({ error: "Téléversement impossible" }, 500);

  await salvaMeta(`${cat}/${fileName}`, metaDalBody(body, cat));

  const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${cat}/${fileName}`).data.publicUrl;
  return json({ ok: true, name: fileName, url }, 201);
};

export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const cat = String(body.cat ?? "");
  if (!catValida(cat)) return json({ error: "Catégorie invalide" }, 400);
  const name = String(body.name ?? "");
  if (!nomeValido(name)) return json({ error: "Nom invalide" }, 400);

  const nuovaCat = body.new_cat !== undefined ? String(body.new_cat) : cat;
  if (!catValida(nuovaCat)) return json({ error: "Catégorie invalide" }, 400);
  const nuovoNome = body.new_name !== undefined ? pulisciNome(String(body.new_name)) : name;
  if (!nuovoNome) return json({ error: "Nouveau nom invalide (.pdf obligatoire)" }, 400);

  // Spostamento file (nome e/o categoria cambiati)
  if (nuovaCat !== cat || nuovoNome !== name) {
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .move(`${cat}/${name}`, `${nuovaCat}/${nuovoNome}`);
    if (error) return json({ error: "Ce nom existe déjà ou déplacement impossible" }, 409);
    // L'anteprima segue il PDF (se non esiste, l'errore si ignora)
    await supabaseAdmin.storage.from(BUCKET).move(`${cat}/${thumbDi(name)}`, `${nuovaCat}/${thumbDi(nuovoNome)}`);
    // La vecchia riga metadati si elimina (la nuova si scrive sotto)
    try {
      await supabaseAdmin.from("admin_docs_meta").delete().eq("path", `${cat}/${name}`);
    } catch {
      /* senza metadati */
    }
  }

  await salvaMeta(`${nuovaCat}/${nuovoNome}`, metaDalBody(body, nuovaCat));

  const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${nuovaCat}/${nuovoNome}`).data.publicUrl;
  return json({ ok: true, cat: nuovaCat, name: nuovoNome, url });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const cat = url.searchParams.get("cat") ?? "";
  if (!catValida(cat)) return json({ error: "Catégorie invalide" }, 400);
  const name = url.searchParams.get("name") ?? "";
  if (!nomeValido(name)) return json({ error: "Nom invalide" }, 400);

  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([`${cat}/${name}`, `${cat}/${thumbDi(name)}`]);
  if (error) return json({ error: "Suppression impossible" }, 500);
  try {
    await supabaseAdmin.from("admin_docs_meta").delete().eq("path", `${cat}/${name}`);
  } catch {
    /* senza metadati */
  }
  return json({ ok: true });
};
