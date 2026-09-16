import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi, inserisci, aggiorna, cancella } from "../../../lib/admin/sede";
import { eliminaFotoStorage } from "../../../lib/admin/eliminaFotoStorage";

export const prerender = false;

// CRUD della rubrica Team (Réglages → Team).
// GET    → elenco completo (per categoria, poi ordine/nome)
// POST   → crea
// PUT    → aggiorna (id) — oppure toggle rapido { id, active }
// DELETE → elimina (?id=…)

// Lista fissa delle categorie (scelta 2026-07-15). Restare allineati con
// le etichette nel front (settings.astro).
const CATEGORIE = [
  "direction",
  "cuisine",
  "salle",
  "admin",
  "fournisseurs",
  "technique",
  "marketing",
  "consultants",
  "partenaires",
];

interface TeamInput {
  id?: string;
  /** Multi-sede: questo persona vale per tutte le sedi. */
  all_locations?: boolean;
  name?: string;
  category?: string;
  role?: string;
  is_employee?: boolean;
  phone?: string;
  email?: string;
  phone2?: string;
  email2?: string;
  company?: string;
  website?: string;
  photo_url?: string;
  notes?: string;
  active?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function txt(v: unknown, max = 300): string | null {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
}

function valida(b: TeamInput): { errore?: string; valori?: Record<string, unknown> } {
  const name = (b.name ?? "").trim().slice(0, 120);
  if (!name) return { errore: "Le nom est obligatoire." };

  const category = CATEGORIE.includes(b.category ?? "") ? b.category! : "direction";

  return {
    valori: {
      name,
      category,
      role: txt(b.role, 120),
      is_employee: b.is_employee === true,
      phone: txt(b.phone, 60),
      email: txt(b.email, 180),
      phone2: txt(b.phone2, 60),
      email2: txt(b.email2, 180),
      company: txt(b.company, 160),
      website: txt(b.website, 300),
      photo_url: txt(b.photo_url, 500),
      notes: txt(b.notes, 1000),
      active: b.active !== false,
    },
  };
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // `team` e' «mista»: si vede il personale di QUESTO punto e quello che vale
  // per tutti (il direttore che gira fra le tre pizzerie).
  const { data, error } = await leggi("team", await ambitoDiRichiesta(request, staff), "*")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return json({ error: "Lecture impossible" }, 500);
  return json({ team: data ?? [] });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: TeamInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const v = valida(body);
  if (v.errore) return json({ error: v.errore }, 400);

  // ⚠️ Default: di QUESTA sede, non di tutte — l'opposto del menu. Un
  // cameriere lavora in un locale; chi gira fra i tre e' l'eccezione, e la
  // dichiara con l'interruttore. Sbagliare per difetto costa riscrivere una
  // scheda; sbagliare per eccesso mette una faccia sulla pagina «squadra» di
  // due ristoranti in cui non ha mai lavorato.
  const ambito = await ambitoDiRichiesta(request, staff);
  const { data, error } = await inserisci("team", ambito, v.valori!, body.all_locations === true)
    .select("id")
    .single();
  if (error) return json({ error: "Enregistrement impossible" }, 500);
  return json({ ok: true, id: data.id }, 201);
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: TeamInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  if (!body.id) return json({ error: "id manquant" }, 400);

  const ambito = await ambitoDiRichiesta(request, staff);

  // Toggle rapido attivo/nascosto: solo { id, active }
  if (body.name === undefined && typeof body.active === "boolean") {
    const { error } = await aggiorna("team", ambito, { active: body.active }).eq("id", body.id);
    if (error) return json({ error: "Enregistrement impossible" }, 500);
    return json({ ok: true });
  }

  const v = valida(body);
  if (v.errore) return json({ error: v.errore }, 400);

  // Foto precedente: se tolta o sostituita, il file va eliminato dallo Storage
  const { data: prima } = await leggi("team", ambito, "photo_url").eq("id", body.id).maybeSingle();
  const vecchiaFoto = (prima as { photo_url?: string | null } | null)?.photo_url ?? null;

  // L'ambito si cambia solo se il modale lo dice: un salvataggio che non
  // parla di sedi non deve spostare la persona da un punto all'altro.
  const campi = { ...v.valori! } as Record<string, unknown>;
  if ("all_locations" in body && ambito.modo === "sede") {
    campi.location_id = body.all_locations === true ? null : ambito.id;
  }
  const { error } = await aggiorna("team", ambito, campi).eq("id", body.id);
  if (error) return json({ error: "Enregistrement impossible" }, 500);
  if (vecchiaFoto && vecchiaFoto !== (v.valori!.photo_url || null)) {
    await eliminaFotoStorage(vecchiaFoto);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id manquant" }, 400);

  const ambito = await ambitoDiRichiesta(request, staff);
  const { data: prima } = await leggi("team", ambito, "photo_url").eq("id", id).maybeSingle();
  const { error } = await cancella("team", ambito).eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  await eliminaFotoStorage(prima?.photo_url ?? null);
  return json({ ok: true });
};
