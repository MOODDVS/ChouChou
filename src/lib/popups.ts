import { supabaseAdmin } from "./db";
import { DateTime } from "luxon";
import { cacheOr } from "./cache";
import { TIMEZONE } from "./slots";

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
  position: string;
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
  title_i18n: Record<string, string> | null;
  body_i18n: Record<string, string> | null;
  btn1_label_i18n: Record<string, string> | null;
  btn2_label_i18n: Record<string, string> | null;
  position: string | null;
  max_shows: number;
  pages: string[];
  schedule_kind: string;
  date_start: string | null;
  date_end: string | null;
  days: number[] | null;
  hour_start: string | null;
  hour_end: string | null;
}

export async function popupPerPagina(slug: string, lang: string = "fr"): Promise<PopupPubblico | null> {
  try {
    // Cache 60s: una sola query per TUTTE le pagine del sito
    const data = await cacheOr("popups:attivi", async () => {
      const { data: righe, error } = await supabaseAdmin
        .from("popups")
        .select(
          "id, title, body, image_url, btn1_label, btn1_url, btn2_label, btn2_url, title_en, body_en, btn1_label_en, btn2_label_en, title_i18n, body_i18n, btn1_label_i18n, btn2_label_i18n, position, max_shows, pages, schedule_kind, date_start, date_end, days, hour_start, hour_end"
        )
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (error || !righe) throw new Error("popups illeggibili");
      return righe;
    });

    const ora = DateTime.now().setZone(TIMEZONE);
    const oggi = ora.toISODate() ?? "";
    const hhmm = ora.toFormat("HH:mm");
    const giorno = ora.weekday % 7; // luxon: 1=lundi…7=dimanche → 0=dimanche…6=samedi

    for (const p of data as RigaPopup[]) {
      if (!Array.isArray(p.pages) || !p.pages.includes(slug)) continue;

      // Lingua: il pop-up appare solo se il titolo per quella lingua esiste.
      const legacyTitle = lang === "en" ? p.title_en : lang === "fr" ? p.title : null;
      const titolo = String(p.title_i18n?.[lang] ?? legacyTitle ?? "").trim();
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

      const legBody = lang === "en" ? p.body_en : lang === "fr" ? p.body : null;
      const legB1 = lang === "en" ? p.btn1_label_en : lang === "fr" ? p.btn1_label : null;
      const legB2 = lang === "en" ? p.btn2_label_en : lang === "fr" ? p.btn2_label : null;
      return {
        id: p.id,
        title: titolo,
        body: p.body_i18n?.[lang] ?? legBody,
        image_url: p.image_url,
        btn1_label: p.btn1_label_i18n?.[lang] ?? legB1,
        btn1_url: p.btn1_url,
        btn2_label: p.btn2_label_i18n?.[lang] ?? legB2,
        btn2_url: p.btn2_url,
        max_shows: p.max_shows ?? 3,
        position: p.position ?? "center",
      };
    }
    return null;
  } catch {
    return null; // DB irraggiungibile: nessun pop-up, nessun errore in pagina
  }
}
