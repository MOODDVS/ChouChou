// Lettura pubblica (vetrina) degli eventi agenda per le "stories" della
// pagina Links. Read-only, service key server-side (come getMenu).
import { supabaseAdmin } from "./db";

export interface AgendaEvento {
  id: string;
  title: string;
  title_i18n: Record<string, string> | null;
  body: string | null;
  image_url: string | null;
  date_start: string;
  date_end: string | null;
}

/** Prossimi eventi pubblicati (active), ordinati per data. Tollerante alle
 *  colonne i18n non ancora migrate. */
export async function getAgendaProchains(limite = 12): Promise<AgendaEvento[]> {
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
