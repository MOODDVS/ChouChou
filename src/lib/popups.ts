import { supabaseAdmin } from "./db";
import { DateTime } from "luxon";

/**
 * Pop-up di comunicazione (admin Marketing → Pop-up) valido ADESSO
 * per una pagina del sito. Regole:
 * - active = true e pagina inclusa in `pages`
 * - programmazione rispettata (sempre / intervallo date / giorni+ore,
 *   ora di Bruxelles)
 * - se più pop-up sono validi, vince il più recente
 * Il limite di visualizzazioni per visitatore (max_shows) è applicato
 * lato client con localStorage, in SitePopup.astro.
 */

export interface PopupPubblico {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  btn1_label: string | null;
  btn1_url: string | null;
  btn2_label: string | null;
  btn2_url: string | null;
  max_shows: number;
}

interface RigaPopup {
  id: string;
  title: string | null;
  body: string | null;
  image_url: string | null;
  btn1_label: string | null;
  btn1_url: string | null;
  btn2_label: string | null;
  btn2_url: string | null;
  title_en: string | null;
  body_en: string | null;
  btn1_label_en: string | null;
  btn2_label_en: string | null;
  max_shows: number;
  pages: string[];
  schedule_kind: string;
  date_start: string | null;
  date_end: string | null;
  days: number[] | null;
  hour_start: string | null;
  hour_end: string | null;
}

export async function popupPerPagina(slug: string, lang: "fr" | "en" = "fr"): Promise<PopupPubblico | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("popups")
      .select(
        "id, title, body, image_url, btn1_label, btn1_url, btn2_label, btn2_url, title_en, body_en, btn1_label_en, btn2_label_en, max_shows, pages, schedule_kind, date_start, date_end, days, hour_start, hour_end"
      )
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (error || !data) return null;

    const ora = DateTime.now().setZone("Europe/Brussels");
    const oggi = ora.toISODate() ?? "";
    const hhmm = ora.toFormat("HH:mm");
    const giorno = ora.weekday % 7; // luxon: 1=lundi…7=dimanche → 0=dimanche…6=samedi

    for (const p of data as RigaPopup[]) {
      if (!Array.isArray(p.pages) || !p.pages.includes(slug)) continue;

      // Lingua: il pop-up appare solo se la versione richiesta esiste.
      const titolo = lang === "en" ? (p.title_en ?? "").trim() : (p.title ?? "").trim();
      if (!titolo) continue;

      if (p.schedule_kind === "dates") {
        if (!p.date_start || !p.date_end) continue;
        if (oggi < p.date_start || oggi > p.date_end) continue;
      } else if (p.schedule_kind === "weekly") {
        if (!Array.isArray(p.days) || !p.days.includes(giorno)) continue;
        const da = String(p.hour_start ?? "").slice(0, 5);
        const a = String(p.hour_end ?? "").slice(0, 5);
        if (!da || !a) continue;
        if (hhmm < da || hhmm > a) continue;
      }

      const en = lang === "en";
      return {
        id: p.id,
        title: titolo,
        body: en ? p.body_en : p.body,
        image_url: p.image_url,
        btn1_label: en ? p.btn1_label_en : p.btn1_label,
        btn1_url: p.btn1_url,
        btn2_label: en ? p.btn2_label_en : p.btn2_label,
        btn2_url: p.btn2_url,
        max_shows: p.max_shows ?? 3,
      };
    }
    return null;
  } catch {
    return null; // DB irraggiungibile: nessun pop-up, nessun errore in pagina
  }
}
