import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";

export const prerender = false;

// Integrazioni di terzi (Réglages → Integrations). SOLO super admin:
// il codice incollato finisce nel sito pubblico del cliente.
//
// Prenotazioni:
//   resa_mode     : "moodd" (widget MOODD) | "link" | "embed" | "none"
//   resa_provider : nome del fornitore (Zenchef, TheFork…) — solo informativo
//   resa_url      : URL di prenotazione (modalità "link")
//   resa_embed    : codice HTML/JS del widget (modalità "embed")
//
// GET → configurazione (staff autenticato: serve alle pagine admin)
// PUT → salvataggio (super admin)

const MODI = ["moodd", "link", "embed", "none"];
// Google Business — livello 1: Place ID (lecture seule, clé API MOODD)
//                   livello 2: OAuth (répondre aux avis, horaires) — à venir
const K_GPLACE = "google_place_id";
const K_GTOKEN = "google_oauth_refresh"; // livello 2, scritto dal futuro callback OAuth
const K_MODE = "resa_mode";
const K_PROVIDER = "resa_provider";
const K_URL = "resa_url";
const K_EMBED = "resa_embed";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function leggi(chiavi: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const { data } = await supabaseAdmin.from("app_config").select("key, value").in("key", chiavi);
    for (const r of data ?? []) out[r.key as string] = String(r.value ?? "");
  } catch {
    /* niente config */
  }
  return out;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const c = await leggi([K_MODE, K_PROVIDER, K_URL, K_EMBED, K_GPLACE, K_GTOKEN]);
  const mode = MODI.includes(c[K_MODE]) ? c[K_MODE] : "moodd";
  return json({
    resa: {
      mode,
      provider: c[K_PROVIDER] ?? "",
      url: c[K_URL] ?? "",
      // il codice completo lo vede solo il super admin
      embed: isSuperUser(staff) ? (c[K_EMBED] ?? "") : "",
      has_embed: Boolean(c[K_EMBED]),
    },
    google: {
      place_id: c[K_GPLACE] ?? "",
      connected: Boolean(c[K_GTOKEN]),
      // la connessione OAuth è possibile solo con le credenziali MOODD configurate
      oauth_ready: Boolean(import.meta.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID),
    },
  });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuperUser(staff)) return json({ error: "Réservé au super admin" }, 403);

  let body: { mode?: string; provider?: string; url?: string; embed?: string; google_place_id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const mode = MODI.includes(String(body.mode)) ? String(body.mode) : "moodd";
  const url = String(body.url ?? "").trim().slice(0, 500);
  if (mode === "link" && url && !/^https:\/\//i.test(url)) {
    return json({ error: "Le lien doit commencer par https://" }, 400);
  }
  if (mode === "link" && !url) return json({ error: "Ajoute le lien de réservation." }, 400);
  if (mode === "embed" && !String(body.embed ?? "").trim()) {
    return json({ error: "Colle le code du widget." }, 400);
  }

  const placeId = String(body.google_place_id ?? "").trim().slice(0, 200);
  if (placeId && !/^[A-Za-z0-9_-]+$/.test(placeId)) {
    return json({ error: "Place ID invalide." }, 400);
  }

  const upserts = [
    { key: K_GPLACE, value: placeId },
    { key: K_MODE, value: mode },
    { key: K_PROVIDER, value: String(body.provider ?? "").trim().slice(0, 60) },
    { key: K_URL, value: url },
    { key: K_EMBED, value: String(body.embed ?? "").slice(0, 20000) },
  ];
  const { error } = await supabaseAdmin.from("app_config").upsert(upserts, { onConflict: "key" });
  if (error) return json({ error: "Enregistrement impossible" }, 500);
  return json({ ok: true });
};
