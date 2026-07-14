import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/adminAuth";
import { isSuper, PAGINE_ADMIN } from "../../../lib/superAdmin";

export const prerender = false;

// Visibilità delle pagine admin per gli utenti NON super (MOODD).
// La lista delle pagine nascoste vive in app_config.admin_pages_hidden
// (array JSON di chiavi, es. ["stats","marketing"]).
// GET → { hidden, super } : letto da AdminNav su ogni pagina
// PUT → { hidden } : SOLO il super admin può modificarla

const CHIAVE = "admin_pages_hidden";
const VALIDE = PAGINE_ADMIN.map((p) => p.key);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function leggiNascoste(): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", CHIAVE)
      .maybeSingle();
    const arr = JSON.parse(data?.value ?? "[]");
    return Array.isArray(arr) ? arr.filter((k) => VALIDE.includes(k)) : [];
  } catch {
    return [];
  }
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  return json({
    hidden: await leggiNascoste(),
    super: isSuper(staff.email),
  });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuper(staff.email)) {
    return json({ error: "Réservé à l'administrateur MOODD" }, 403);
  }

  let body: { hidden?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const hidden = Array.isArray(body.hidden)
    ? [...new Set(body.hidden.filter((k) => VALIDE.includes(k)))]
    : null;
  if (hidden === null) return json({ error: "Liste invalide" }, 400);

  const { error } = await supabaseAdmin
    .from("app_config")
    .upsert({ key: CHIAVE, value: JSON.stringify(hidden) }, { onConflict: "key" });
  if (error) return json({ error: "Enregistrement impossible" }, 500);

  return json({ ok: true, hidden });
};
