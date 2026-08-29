// Lettura pubblica (vetrina) degli eventi agenda per le "stories" della
// pagina Links. Read-only, service key server-side (come getMenu).
import { supabaseAdmin } from "./db";
import { cacheOr } from "./cache";

export interface AgendaEvento {
  id: string;
  title: string;
  title_i18n: Record<string, string> | null;
  body: string | null;
  body_i18n?: Record<string, string> | null;
  body_long_i18n?: Record<string, string> | null;
  image_url: string | null;
  gallery?: string[] | null;
  date_start: string;
  date_end: string | null;
}

/** Prossimi eventi pubblicati (active), ordinati per data. Tollerante alle
 *  colonne i18n non ancora migrate. */
export async function getAgendaProchains(limite = 12): Promise<AgendaEvento[]> {
  return cacheOr("agenda:prochains:" + limite, () => getAgendaProchainsNoCache(limite));
}
async function getAgendaProchainsNoCache(limite = 12): Promise<AgendaEvento[]> {
  const oggi = new Date().toISOString().slice(0, 10);
  try {
    let res: { data: any[] | null; error: { message?: string } | null } = await supabaseAdmin
      .from("agenda_events")
      .select("id, title, title_i18n, body, image_url, date_start, date_end")
      .eq("active", true)
      .order("date_start", { ascending: true });
    if (res.error && /title_i18n/i.test(res.error.message ?? "")) {
      res = await supabaseAdmin
        .from("agenda_events")
        .select("id, title, body, image_url, date_start, date_end")
        .eq("active", true)
        .order("date_start", { ascending: true });
    }
    if (res.error || !res.data) return [];
    const righe = res.data as any[];
    return righe
      .filter((r) => (r.date_end || r.date_start) >= oggi)
      .slice(0, limite)
      .map((r) => ({
        id: r.id,
        title: r.title,
        title_i18n: r.title_i18n ?? null,
        body: r.body ?? null,
        image_url: r.image_url ?? null,
        date_start: r.date_start,
        date_end: r.date_end ?? null,
      }));
  } catch {
    return [];
  }
}

/** Tutti gli eventi pubblicati (active), per la PAGINA agenda: prima i prossimi
 *  (data crescente), poi i passati (piu recenti in cima). Tollerante all'i18n. */
export async function getAgendaTous(limite = 40): Promise<AgendaEvento[]> {
  return cacheOr("agenda:tous:" + limite, () => getAgendaTousNoCache(limite));
}
async function getAgendaTousNoCache(limite = 40): Promise<AgendaEvento[]> {
  const oggi = new Date().toISOString().slice(0, 10);
  try {
    let res: { data: any[] | null; error: { message?: string } | null } = await supabaseAdmin
      .from("agenda_events")
      .select("id, title, title_i18n, body, body_i18n, body_long_i18n, image_url, gallery, date_start, date_end")
      .eq("active", true);
    if (res.error && /title_i18n|body_i18n|body_long_i18n|gallery/i.test(res.error.message ?? "")) {
      res = await supabaseAdmin
        .from("agenda_events")
        .select("id, title, body, image_url, date_start, date_end")
        .eq("active", true);
    }
    if (res.error || !res.data) return [];
    const tutti: AgendaEvento[] = (res.data as any[]).map((r) => ({
      id: r.id,
      title: r.title,
      title_i18n: r.title_i18n ?? null,
      body: r.body ?? null,
      body_i18n: r.body_i18n ?? null,
      body_long_i18n: r.body_long_i18n ?? null,
      image_url: r.image_url ?? null,
      gallery: Array.isArray(r.gallery) ? r.gallery.filter(Boolean) : null,
      date_start: r.date_start,
      date_end: r.date_end ?? null,
    }));
    const fin = (e: AgendaEvento) => e.date_end || e.date_start;
    const futuri = tutti.filter((e) => fin(e) >= oggi).sort((a, b) => a.date_start.localeCompare(b.date_start));
    const passati = tutti.filter((e) => fin(e) < oggi).sort((a, b) => b.date_start.localeCompare(a.date_start));
    return [...futuri, ...passati].slice(0, limite);
  } catch {
    return [];
  }
}


/** Un seul événement publié (par id), pour la page /agenda/[id]. */
export async function getAgendaEvento(id: string): Promise<AgendaEvento | null> {
  try {
    let res: { data: any | null; error: { message?: string } | null } = await supabaseAdmin
      .from("agenda_events")
      .select("id, title, title_i18n, body, image_url, date_start, date_end")
      .eq("id", id)
      .eq("active", true)
      .maybeSingle();
    if (res.error && /title_i18n/i.test(res.error.message ?? "")) {
      res = await supabaseAdmin
        .from("agenda_events")
        .select("id, title, body, image_url, date_start, date_end")
        .eq("id", id)
        .eq("active", true)
        .maybeSingle();
    }
    if (res.error || !res.data) return null;
    const r = res.data as any;
    return {
      id: r.id,
      title: r.title,
      title_i18n: r.title_i18n ?? null,
      body: r.body ?? null,
      image_url: r.image_url ?? null,
      date_start: r.date_start,
      date_end: r.date_end ?? null,
    };
  } catch {
    return null;
  }
}


/** Slug SEO à partir du titre (sans accents, minuscules, tirets). Basé sur le
 *  titre par défaut (FR) pour un permalien stable quelle que soit la langue. */
export function slugifyTitre(s: string): string {
  const base = (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "evenement";
}

/** Événement dont le slug (titre par défaut) correspond, pour /agenda/<slug>. */
export async function getAgendaBySlug(slug: string): Promise<AgendaEvento | null> {
  const tous = await getAgendaTous(500);
  return tous.find((e) => slugifyTitre(e.title) === slug) ?? null;
}
