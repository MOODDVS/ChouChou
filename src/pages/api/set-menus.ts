import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../lib/db";

export const prerender = false;

// GET /api/set-menus — menù fissi PUBBLICI (attivi, non bozza, nel periodo valido).
// Nomi/descrizioni/portate con le traduzioni grezze (name_i18n): la lingua viene
// scelta lato client. I piatti (item id) sono risolti in nome + name_i18n.

type Course = {
  category?: string | null;
  name?: string;
  name_i18n?: Record<string, string> | null;
  mode?: string;
  items?: string[];
  customs?: { name_i18n?: Record<string, string> | null }[];
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" },
  });
}

export const GET: APIRoute = async () => {
  try {
    const SEL = "id, name, name_i18n, desc_i18n, image_url, courses, price_cents, wine_supplement_cents, date_from, date_to, active, hide_items, is_draft, sort_order, created_at";
    let res = await supabaseAdmin
      .from("set_menus")
      .select(SEL)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (res.error && /is_draft|name_i18n|desc_i18n/i.test(res.error.message ?? "")) {
      res = await supabaseAdmin
        .from("set_menus")
        .select("id, name, image_url, courses, price_cents, wine_supplement_cents, date_from, date_to, active, sort_order, created_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
    }
    if (res.error || !res.data) return json({ menus: [] });

    const oggi = new Date().toISOString().slice(0, 10);
    const attivi = (res.data as Record<string, unknown>[]).filter((m) => {
      if (m.active === false) return false;
      if (m.is_draft === true) return false;
      if (m.date_from && oggi < String(m.date_from)) return false;
      if (m.date_to && oggi > String(m.date_to)) return false;
      return true;
    });

    // Risolve i nomi dei piatti referenziati nelle portate.
    const ids = new Set<string>();
    for (const m of attivi) {
      for (const c of (m.courses as Course[] | null) ?? []) {
        for (const id of c.items ?? []) ids.add(String(id));
      }
    }
    const nomiPiatti = new Map<string, { name: string; name_i18n: Record<string, string> }>();
    if (ids.size) {
      let ri = await supabaseAdmin.from("menu_items").select("id, name, name_i18n").in("id", [...ids]);
      if (ri.error && /name_i18n/i.test(ri.error.message ?? "")) {
        ri = await supabaseAdmin.from("menu_items").select("id, name").in("id", [...ids]);
      }
      for (const r of (ri.data as { id: string; name: string; name_i18n?: Record<string, string> | null }[] | null) ?? []) {
        nomiPiatti.set(r.id, { name: r.name, name_i18n: r.name_i18n ?? {} });
      }
    }

    const menus = attivi.map((m) => {
      const courses = ((m.courses as Course[] | null) ?? []).map((c) => {
        const pieces: { name: string; name_i18n: Record<string, string> }[] = [];
        for (const id of c.items ?? []) {
          const p = nomiPiatti.get(String(id));
          if (p) pieces.push({ name: p.name, name_i18n: p.name_i18n });
        }
        for (const cu of c.customs ?? []) {
          const i18n = cu.name_i18n ?? {};
          const primo = Object.values(i18n)[0] ?? "";
          if (primo) pieces.push({ name: primo, name_i18n: i18n });
        }
        return {
          title: c.category || c.name || "",
          title_i18n: c.category ? {} : (c.name_i18n ?? {}),
          mode: c.mode === "and" ? "and" : "choice",
          pieces,
        };
      });
      return {
        id: m.id,
        image_url: m.image_url ?? null,
        price_cents: m.price_cents ?? 0,
        wine_supplement_cents: m.wine_supplement_cents ?? null,
        date_from: m.date_from ?? null,
        date_to: m.date_to ?? null,
        name: m.name ?? "",
        name_i18n: (m.name_i18n as Record<string, string> | null) ?? {},
        desc_i18n: (m.desc_i18n as Record<string, string> | null) ?? {},
        courses,
      };
    });

    return json({ menus });
  } catch {
    return json({ menus: [] });
  }
};
