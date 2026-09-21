import { DateTime } from "luxon";
import { cacheOr } from "./cache";
import { fusoDi } from "./fuso";
import { leggi, ambitoPubblico, type Ambito } from "./admin/sede";
import { scegliPopup, titoloPopup, type RigaPopup } from "./popupRegole";

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


/** La riga come la legge il sito: le regole (`RigaPopup`) piu' tutto quello
 *  che serve solo a DISEGNARE il pop-up, e che nessuna regola guarda. */
interface RigaPopupPiena extends RigaPopup {
  body: string | null;
  image_url: string | null;
  btn1_label: string | null;
  btn1_url: string | null;
  btn2_label: string | null;
  btn2_url: string | null;
  body_en: string | null;
  btn1_label_en: string | null;
  btn2_label_en: string | null;
  body_i18n: Record<string, string> | null;
  btn1_label_i18n: Record<string, string> | null;
  btn2_label_i18n: Record<string, string> | null;
  position: string | null;
  max_shows: number;
}

export async function popupPerPagina(
  slug: string,
  lang: string = "fr",
  ambitoDato?: Ambito,
): Promise<PopupPubblico | null> {
  try {
    // ⚠️ LA SEDE STA NELLA CHIAVE DI CACHE. `popups` e' «mista»: il risultato
    // dipende dal punto, e una chiave sola servirebbe per 60 secondi il
    // pop-up di Stockel a chi guarda Jourdan. Stessa trappola gia' pagata su
    // `cfg:all:<id>` e `sched:settings:<id>`.
    // ⚠️ La sede la passa CHI DISEGNA LA PAGINA, che sa da quale punto la sta
    // disegnando. Il ripiego resta per un sito a punto unico, dove non c'e'
    // niente da scegliere. Un pop-up e' l'unica cosa del sito che parla al
    // visitatore senza che lui l'abbia chiesta: mostrare quello di un altro
    // punto non da' errore, annuncia una serata nel quartiere sbagliato.
    const ambito = ambitoDato ?? (await ambitoPubblico());
    const chiave = `popups:attivi:${ambito.modo === "sede" ? ambito.id : ambito.modo}`;
    const data = await cacheOr(chiave, async () => {
      const { data: righe, error } = await leggi(
        "popups",
        ambito,
        "id, title, body, image_url, btn1_label, btn1_url, btn2_label, btn2_url, title_en, body_en, btn1_label_en, btn2_label_en, title_i18n, body_i18n, btn1_label_i18n, btn2_label_i18n, position, max_shows, pages, schedule_kind, date_start, date_end, days, hour_start, hour_end"
      )
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (error || !righe) throw new Error("popups illeggibili");
      return righe;
    });

    const ora = DateTime.now().setZone(await fusoDi(ambito));
    const oggi = ora.toISODate() ?? "";
    const hhmm = ora.toFormat("HH:mm");
    const giorno = ora.weekday % 7; // luxon: 1=lundi…7=dimanche → 0=dimanche…6=samedi

    // La SCELTA sta in `popupRegole.ts`, che non importa niente e ha i suoi
    // test. Qui resta quello che non si puo' provare senza un database: le
    // righe e l'orologio.
    const p = scegliPopup(data as RigaPopupPiena[], { slug, lang, oggi, hhmm, giorno });
    if (p) {
      const legBody = lang === "en" ? p.body_en : lang === "fr" ? p.body : null;
      const legB1 = lang === "en" ? p.btn1_label_en : lang === "fr" ? p.btn1_label : null;
      const legB2 = lang === "en" ? p.btn2_label_en : lang === "fr" ? p.btn2_label : null;
      return {
        id: p.id,
        title: titoloPopup(p, lang),
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
