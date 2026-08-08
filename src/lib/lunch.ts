import { supabaseAdmin } from "./db";

export interface LunchPiatto {
  id: string;
  name: string;
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

/**
 * Lunch attivo del giorno per il sito pubblico: active=true, con la data di
 * oggi dentro date_from/date_to (o senza limiti), il più recente. Risolve gli
 * UUID dei piatti da menu_items. Ritorna null se assente o se la tabella non
 * esiste (migrazione non lanciata) — così la sezione si nasconde da sola.
 */
export async function getLunchAttivo(): Promise<LunchAttivo | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("lunch_menus")
      .select("id, name, courses, date_from, date_to, items, combos, active, created_at")
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
    const allIds = [...new Set(courses.flatMap((c) => items[c] ?? []))];

    const mappa = new Map<string, LunchPiatto>();
    if (allIds.length) {
      const { data: piatti } = await supabaseAdmin
        .from("menu_items")
        .select("id, name, description_fr, description_en, is_bestseller, is_vegan, is_spicy")
        .in("id", allIds);
      for (const p of piatti ?? []) mappa.set((p as any).id, p as LunchPiatto);
    }

    const perCourse: Record<string, LunchPiatto[]> = {};
    for (const c of courses) {
      perCourse[c] = (items[c] ?? [])
        .map((id) => mappa.get(id))
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
