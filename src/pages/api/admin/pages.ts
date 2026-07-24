import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuper, PAGINE_ADMIN, TABS_VALIDI, TEMA_CHIAVI } from "../../../lib/admin/superAdmin";

export const prerender = false;

// Visibilità di pagine E tab dell'admin per gli utenti NON super (MOODD).
// - admin_pages_hidden : array JSON di chiavi pagina (es. ["stats","marketing"])
// - admin_tabs_hidden  : array JSON di "pagina:tab" (es. ["marketing:news"])
// GET → { hidden, hiddenTabs, super } : letto da AdminNav e dalle pagine con tab
// PUT → { hidden, hiddenTabs } : SOLO il super admin può modificarla

const CHIAVE = "admin_pages_hidden";
const CHIAVE_TABS = "admin_tabs_hidden";
// TEMA brand del cliente (Reglages -> Couleurs): oggetto {accent,hover,bg,...}
// con hex #rrggbb. Oggetto vuoto/assente = colori MOODD di default.
const CHIAVE_TEMA = "admin_theme";
const RE_HEX = /^#[0-9a-fA-F]{6}$/;

/** Favicon del brand (Admin -> General): URL pubblico nel bucket brand.
 *  Se caricato, l'header dell'admin lo usa al posto del logo di default. */
async function leggiLogo(): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "brand_favicon")
      .maybeSingle();
    const v = String(data?.value ?? "").trim();
    return v.startsWith("https://") || v.startsWith("/") ? v : null;
  } catch {
    return null;
  }
}

/** Tema letto da app_config: SOLO chiavi conosciute e hex validi. */
async function leggiTema(): Promise<Record<string, string>> {
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", CHIAVE_TEMA)
      .maybeSingle();
    const obj = JSON.parse(data?.value ?? "{}");
    const out: Record<string, string> = {};
    for (const k of TEMA_CHIAVI) {
      const v = obj?.[k];
      if (typeof v === "string" && RE_HEX.test(v)) out[k] = v.toLowerCase();
    }
    // Effet verre: "on" = trasparenze+blur (assente = opaco, il default)
    if (obj?.glass === "on") out.glass = "on";
    // Intensita' delle ombre: "0".."100" (assente = default 15)
    if (typeof obj?.shadow === "string" && /^\d{1,3}$/.test(obj.shadow) && Number(obj.shadow) <= 100) {
      out.shadow = obj.shadow;
    }
    return out;
  } catch {
    return {};
  }
}
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

  const [hidden, hiddenTabs, theme, logo] = await Promise.all([
    leggiLista(CHIAVE, VALIDE),
    leggiLista(CHIAVE_TABS, TABS_VALIDI),
    leggiTema(),
    leggiLogo(),
  ]);
  return json({ hidden, hiddenTabs, theme, logo, super: isSuper(staff.email) });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuper(staff.email)) {
    return json({ error: "Réservé à l'administrateur MOODD" }, 403);
  }

  let body: { hidden?: string[]; hiddenTabs?: string[]; theme?: Record<string, string> };
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

  // theme e' opzionale: se assente non lo tocca; {} = reset ai default MOODD.
  let theme: Record<string, string> | null = null;
  if (body.theme !== undefined) {
    if (typeof body.theme !== "object" || body.theme === null || Array.isArray(body.theme)) {
      return json({ error: "Thème invalide" }, 400);
    }
    theme = {};
    for (const k of TEMA_CHIAVI) {
      const v = (body.theme as Record<string, unknown>)[k];
      if (typeof v === "string" && RE_HEX.test(v)) theme[k] = v.toLowerCase();
    }
    if ((body.theme as Record<string, unknown>).glass === "on") theme.glass = "on";
    const sh = (body.theme as Record<string, unknown>).shadow;
    if (typeof sh === "string" && /^\d{1,3}$/.test(sh) && Number(sh) <= 100) theme.shadow = sh;
  }

  const upserts: { key: string; value: string }[] = [
    { key: CHIAVE, value: JSON.stringify(hidden) },
  ];
  if (hiddenTabs !== null) upserts.push({ key: CHIAVE_TABS, value: JSON.stringify(hiddenTabs) });
  if (theme !== null) upserts.push({ key: CHIAVE_TEMA, value: JSON.stringify(theme) });

  const { error } = await supabaseAdmin
    .from("app_config")
    .upsert(upserts, { onConflict: "key" });
  if (error) return json({ error: "Enregistrement impossible" }, 500);

  return json({ ok: true, hidden, hiddenTabs: hiddenTabs ?? undefined, theme: theme ?? undefined });
};
