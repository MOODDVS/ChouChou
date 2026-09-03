import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import {
  K_PRINT_CATALOG,
  PRINT_DEFAULTS,
  normalizzaCatalogo,
  validaCatalogo,
} from "../../../config/printCatalog";

export const prerender = false;

// Catalogo PRINT (prodotti stampabili on-demand ordinabili a MOODD).
// STEP 1: solo lettura + salvataggio dei prezzi. Nessun ordine.
//
// GET → catalogo del cliente (staff autenticato). Se app_config non ha
//       ancora la chiave, restituisce i default consigliati (seed).
//       Include sempre `defaults` per il bottone « Réinitialiser ».
// PUT → salvataggio (SOLO super admin): valida e fa l'upsert del JSON.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let catalog = PRINT_DEFAULTS;
  let custom = false;
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", K_PRINT_CATALOG)
      .maybeSingle();
    const grezzo = data?.value ?? "";
    if (grezzo && String(grezzo).trim()) {
      catalog = normalizzaCatalogo(String(grezzo));
      custom = true;
    }
  } catch {
    /* niente config: si usano i default */
  }

  return json({ catalog, defaults: PRINT_DEFAULTS, custom });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuperUser(staff)) return json({ error: "Réservé au super admin" }, 403);

  let body: { catalog?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const { catalog, error } = validaCatalogo(body?.catalog);
  if (error || !catalog) return json({ error: error ?? "Catalogue invalide." }, 400);

  const { error: dbErr } = await supabaseAdmin
    .from("app_config")
    .upsert({ key: K_PRINT_CATALOG, value: JSON.stringify(catalog) }, { onConflict: "key" });
  if (dbErr) return json({ error: "Enregistrement impossible" }, 500);

  return json({ ok: true, catalog });
};
