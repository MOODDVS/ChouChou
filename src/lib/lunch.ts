import { supabaseAdmin } from "./db";

export interface LunchPiatto {
  id: string;
  name: string;
  name_i18n: Record<string, string> | null;
  description_fr: string | null;
  description_en: string | null;
  is_bestseller: boolean;
  is_vegan: boolean;
  is_spicy: boolean;
}

export interface LunchAttivo {
  name: string | null;
  date_from: string | null;
  date_to: string | null;
  courses: string[]; // sottoinsieme di ["entree","plat","dessert"]
  piatti: Record<string, LunchPiatto[]>; // per portata
  combos: { parts: string[]; price_cents: number }[]; // prezzi delle combinazioni
}

const PORTATE = ["entree", "plat", "dessert"];

/** Voce "plat hors menu" salvata inline nel lunch come `free:FR` oppure
 *  `free:FR||EN` (traduzione facoltativa). Non è un piatto della carte. */
function piattoLibero(raw: string): LunchPiatto {
  const testo = raw.slice(5); // dopo "free:"
  const sep = testo.indexOf("||");
  const fr = (sep >= 0 ? testo.slice(0, sep) : testo).trim();
  const en = sep >= 0 ? testo.slice(sep + 2).trim() : "";
  return {
    id: raw,
    name: fr,
    name_i18n: en ? { en } : null,
    description_fr: null,
    description_en: null,
    is_bestseller: false,
    is_vegan: false,
    is_spicy: false,
  };
}

const isFree = (id: unknown): id is string => typeof id === "string" && id.startsWith("free:");

/**
 * Lunch attivo del giorno per il sito pubblico: active=true, con la data di
 * oggi dentro date_from/date_to (o senza limiti), il più recente. Risolve gli
 * UUID dei piatti da menu_items e gestisce i piatti "hors menu" (`free:`).
 * Ritorna null se assente o se la tabella non esiste (migrazione non lanciata).
 */
export async function getLunchAttivo(): Promise<LunchAttivo | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("lunch_menus")
      .select("id, name, name_i18n, courses, date_from, date_to, items, combos, active, created_at")
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (error || !data || !data.length) return null;

    const oggi = new Date().toISOString().slice(0, 10);
    const valido = data.find((l: any) => {
      const df = l.date_from as string | null;
      const dt = l.date_to as string | null;
      if (df && oggi < df) return false;
      if (dt && oggi > dt) return false;
      return true;
    });
    // Se nessun lunch copre oggi, ripiega sul più recente attivo (menu pubblicato).
    const scelto = valido ?? data[0];
    if (!scelto) return null;

    const courses: string[] =
      Array.isArray(scelto.courses) && scelto.courses.length
        ? PORTATE.filter((c) => (scelto.courses as string[]).includes(c))
        : ["plat"];
    const items = (scelto.items ?? {}) as Record<string, string[]>;
    // Solo gli UUID veri vanno cercati in menu_items (le voci `free:` no).
    const allIds = [
      ...new Set(courses.flatMap((c) => (items[c] ?? []).filter((id) => !isFree(id)))),
    ];

    const mappa = new Map<string, LunchPiatto>();
    if (allIds.length) {
      const SEL_I18N =
        "id, name, name_i18n, description_fr, description_en, is_bestseller, is_vegan, is_spicy";
      const SEL_BASE =
        "id, name, description_fr, description_en, is_bestseller, is_vegan, is_spicy";
      let q: { data: any[] | null; error: { message?: string } | null } = await supabaseAdmin.from("menu_items").select(SEL_I18N).in("id", allIds);
      if (q.error && /name_i18n/i.test(q.error.message ?? "")) {
        q = await supabaseAdmin.from("menu_items").select(SEL_BASE).in("id", allIds);
      }
      for (const p of q.data ?? []) {
        const row = p as any;
        mappa.set(row.id, { name_i18n: null, ...row } as LunchPiatto);
      }
    }

    const perCourse: Record<string, LunchPiatto[]> = {};
    for (const c of courses) {
      perCourse[c] = (items[c] ?? [])
        .map((id) => (isFree(id) ? piattoLibero(id) : mappa.get(id) ?? null))
        .filter((x): x is LunchPiatto => Boolean(x));
    }

    const combos = Array.isArray(scelto.combos) ? scelto.combos : [];
    return {
      name: scelto.name ?? null,
      date_from: (scelto.date_from as string | null) ?? null,
      date_to: (scelto.date_to as string | null) ?? null,
      courses,
      piatti: perCourse,
      combos,
    };
  } catch {
    return null;
  }
}
