import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuper, PAGINE_ADMIN, TABS_VALIDI } from "../../../lib/admin/superAdmin";

export const prerender = false;

// Visibilità di pagine E tab dell'admin per gli utenti NON super (MOODD).
// - admin_pages_hidden : array JSON di chiavi pagina (es. ["stats","marketing"])
// - admin_tabs_hidden  : array JSON di "pagina:tab" (es. ["marketing:news"])
// GET → { hidden, hiddenTabs, super } : letto da AdminNav e dalle pagine con tab
// PUT → { hidden, hiddenTabs } : SOLO il super admin può modificarla

const CHIAVE = "admin_pages_hidden";
const CHIAVE_TABS = "admin_tabs_hidden";
const VALIDE = PAGINE_ADMIN.map((p) => p.key);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function leggiLista(chiave: string, validi: string[]): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", chiave)
      .maybeSingle();
    const arr = JSON.parse(data?.value ?? "[]");
    return Array.isArray(arr) ? arr.filter((k) => validi.includes(k)) : [];
  } catch {
    return [];
  }
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const [hidden, hiddenTabs] = await Promise.all([
    leggiLista(CHIAVE, VALIDE),
    leggiLista(CHIAVE_TABS, TABS_VALIDI),
  ]);
  return json({ hidden, hiddenTabs, super: isSuper(staff.email) });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuper(staff.email)) {
    return json({ error: "Réservé à l'administrateur MOODD" }, 403);
  }

  let body: { hidden?: string[]; hiddenTabs?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const hidden = Array.isArray(body.hidden)
    ? [...new Set(body.hidden.filter((k) => VALIDE.includes(k)))]
    : null;
  if (hidden === null) return json({ error: "Liste invalide" }, 400);

  // hiddenTabs è opzionale: se assente, non lo tocca.
  const hiddenTabs = Array.isArray(body.hiddenTabs)
    ? [...new Set(body.hiddenTabs.filter((k) => TABS_VALIDI.includes(k)))]
    : null;

  const upserts: { key: string; value: string }[] = [
    { key: CHIAVE, value: JSON.stringify(hidden) },
  ];
  if (hiddenTabs !== null) upserts.push({ key: CHIAVE_TABS, value: JSON.stringify(hiddenTabs) });

  const { error } = await supabaseAdmin
    .from("app_config")
    .upsert(upserts, { onConflict: "key" });
  if (error) return json({ error: "Enregistrement impossible" }, 500);

  return json({ ok: true, hidden, hiddenTabs: hiddenTabs ?? undefined });
};
