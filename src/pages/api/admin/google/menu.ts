import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../../lib/admin/adminAuth";
import { supabaseAdmin } from "../../../../lib/db";
import { accessToken, locationSalvata, leggiFoodMenuStato, spingiFoodMenu } from "../../../../lib/googleBusiness";
import type { FMMenu, FMLabel } from "../../../../lib/googleBusiness";

export const prerender = false;

// GET  /api/admin/google/menu  -> anteprima menu RestoHub + stato menu Google
// POST /api/admin/google/menu  -> spinge il menu RestoHub su Google (Food Menus)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function preludio(request: Request) {
  const staff = await verificaStaff(request);
  if (!staff) return { err: nonAutorizzato() };
  const token = await accessToken();
  if (!token) return { err: json({ error: "Google non collegato" }, 400) };
  const loc = await locationSalvata();
  if (!loc?.path) return { err: json({ error: "Scheda Google non configurata" }, 400) };
  return { token, path: loc.path };
}

type RigaMenu = {
  category?: string | null;
  name?: string | null;
  name_i18n?: Record<string, string> | null;
  description_fr?: string | null;
  desc_i18n?: Record<string, string> | null;
  price_cents?: number | null;
  available?: boolean | null;
};

async function linguaDefault(): Promise<string> {
  try {
    const { data } = await supabaseAdmin.from("app_config").select("value").eq("key", "public_lang_default").maybeSingle();
    const v = String(data?.value ?? "").trim();
    return v || "fr";
  } catch {
    return "fr";
  }
}

async function leggiMenuRH(): Promise<RigaMenu[]> {
  const cols = "category, category_order, sort_order, name, name_i18n, description_fr, desc_i18n, price_cents, available";
  const base = "category, category_order, sort_order, name, description_fr, price_cents, available";
  const q = (sel: string) =>
    supabaseAdmin.from("menu_items").select(sel)
      .order("category_order", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
  let res = await q(cols);
  if (res.error) res = await q(base);
  return (res.data ?? []) as RigaMenu[];
}

// Righe -> sezioni ordinate { name, items:[{name, priceCents, desc}] } (solo disponibili con prezzo).
function raggruppa(righe: RigaMenu[], lang: string) {
  const nome = (r: RigaMenu) => String(r.name_i18n?.[lang] || r.name || "").trim();
  const descr = (r: RigaMenu) => String(r.desc_i18n?.[lang] || r.description_fr || "").trim();
  const out: { name: string; items: { name: string; desc: string; priceCents: number }[] }[] = [];
  for (const r of righe) {
    if (r.available === false) continue;
    const cents = Number(r.price_cents ?? 0);
    if (!cents || cents <= 0) continue;
    const nm = nome(r);
    if (!nm) continue;
    const cat = String(r.category ?? "").trim() || "Menu";
    let sez = out.length && out[out.length - 1].name === cat ? out[out.length - 1] : null;
    if (!sez) { sez = { name: cat, items: [] }; out.push(sez); }
    sez.items.push({ name: nm, desc: descr(r), priceCents: cents });
  }
  return out.filter((s) => s.items.length);
}

function costruisciPayload(sezioni: ReturnType<typeof raggruppa>, lang: string): FMMenu[] {
  const lab = (displayName: string, description?: string): FMLabel[] => {
    const l: FMLabel = { displayName: displayName.slice(0, 140), languageCode: lang };
    const d = (description ?? "").trim();
    if (d) l.description = d.slice(0, 1000);
    return [l];
  };
  const menu: FMMenu = {
    labels: lab("Menu"),
    sections: sezioni.map((s) => ({
      labels: lab(s.name),
      items: s.items.map((it) => ({
        labels: lab(it.name, it.desc),
        attributes: {
          price: {
            currencyCode: "EUR",
            units: String(Math.floor(it.priceCents / 100)),
            nanos: (it.priceCents % 100) * 10_000_000,
          },
        },
      })),
    })),
  };
  return [menu];
}

export const GET: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;
  const lang = await linguaDefault();
  const sezioni = raggruppa(await leggiMenuRH(), lang);
  const tot = sezioni.reduce((n, s) => n + s.items.length, 0);
  const stato = await leggiFoodMenuStato(p.token!, p.path!);
  return json({
    lang,
    sezioni,
    tot,
    googleSezioni: stato.sezioni,
    googleErr: stato.ok ? "" : stato.error,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const p = await preludio(request);
  if (p.err) return p.err;
  const lang = await linguaDefault();
  const sezioni = raggruppa(await leggiMenuRH(), lang);
  if (!sezioni.length) return json({ error: "Nessun piatto con prezzo da sincronizzare" }, 400);
  const menus = costruisciPayload(sezioni, lang);
  const { ok, error } = await spingiFoodMenu(p.token!, p.path!, menus);
  if (!ok) return json({ error: error || "Sincronizzazione impossibile" }, 502);
  const tot = sezioni.reduce((n, s) => n + s.items.length, 0);
  return json({ ok: true, sezioni: sezioni.length, tot });
};
