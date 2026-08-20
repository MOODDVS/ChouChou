// Dizionario delle categorie/sezioni standard, già tradotte nelle lingue del
// sito pubblico. Copre l'80% dei casi: quando il ristoratore usa una di queste
// (in qualsiasi lingua), le traduzioni si applicano automaticamente e restano
// fisse. Se la categoria non è in lista, si usano campi personalizzati.
export type CatStd = {
  key: string;
  kind: "food" | "drink";
  fr: string; it: string; en: string; nl: string; es: string;
};

export const CATEGORIE_STANDARD: CatStd[] = [
  // ---------- CIBO ----------
  { key: "suggestioni",   kind: "food",  fr: "Suggestions",         it: "Suggestioni",            en: "Suggestions",       nl: "Suggesties",          es: "Sugerencias" },
  { key: "per_iniziare",  kind: "food",  fr: "Pour commencer",      it: "Per iniziare",           en: "To start",          nl: "Om te beginnen",      es: "Para empezar" },
  { key: "aperitivo",     kind: "food",  fr: "Apéritif",            it: "Aperitivo",              en: "Aperitif",          nl: "Aperitief",           es: "Aperitivo" },
  { key: "da_condividere",kind: "food",  fr: "À partager",          it: "Da condividere",         en: "To share",          nl: "Om te delen",         es: "Para compartir" },
  { key: "antipasti",     kind: "food",  fr: "Entrées",             it: "Antipasti",              en: "Starters",          nl: "Voorgerechten",       es: "Entrantes" },
  { key: "insalate",      kind: "food",  fr: "Salades",             it: "Insalate",               en: "Salads",            nl: "Salades",             es: "Ensaladas" },
  { key: "zuppe",         kind: "food",  fr: "Soupes",              it: "Zuppe",                  en: "Soups",             nl: "Soepen",              es: "Sopas" },
  { key: "pasta",         kind: "food",  fr: "Pâtes",               it: "Pasta",                  en: "Pasta",             nl: "Pasta",               es: "Pasta" },
  { key: "risotti",       kind: "food",  fr: "Risottos",            it: "Risotti",                en: "Risotto",           nl: "Risotto",             es: "Risottos" },
  { key: "pizze",         kind: "food",  fr: "Pizzas",              it: "Pizze",                  en: "Pizzas",            nl: "Pizza's",             es: "Pizzas" },
  { key: "carne",         kind: "food",  fr: "Viandes",             it: "Carne",                  en: "Meat",              nl: "Vlees",               es: "Carne" },
  { key: "pesce",         kind: "food",  fr: "Poissons",            it: "Pesce",                  en: "Fish",              nl: "Vis",                 es: "Pescado" },
  { key: "secondi",       kind: "food",  fr: "Plats principaux",    it: "Secondi",                en: "Main courses",      nl: "Hoofdgerechten",      es: "Segundos" },
  { key: "contorni",      kind: "food",  fr: "Accompagnements",     it: "Contorni",               en: "Sides",             nl: "Bijgerechten",        es: "Guarniciones" },
  { key: "fritti",        kind: "food",  fr: "Fritures",            it: "Fritti",                 en: "Fried",             nl: "Gefrituurd",          es: "Fritos" },
  { key: "panini",        kind: "food",  fr: "Sandwichs",           it: "Panini",                 en: "Sandwiches",        nl: "Broodjes",            es: "Bocadillos" },
  { key: "burger",        kind: "food",  fr: "Burgers",             it: "Burger",                 en: "Burgers",           nl: "Burgers",             es: "Hamburguesas" },
  { key: "formaggi",      kind: "food",  fr: "Fromages",            it: "Formaggi",               en: "Cheeses",           nl: "Kazen",               es: "Quesos" },
  { key: "dolci",         kind: "food",  fr: "Desserts",            it: "Dolci",                  en: "Desserts",          nl: "Desserts",            es: "Postres" },
  { key: "frutta",        kind: "food",  fr: "Fruits",              it: "Frutta",                 en: "Fruit",             nl: "Fruit",               es: "Fruta" },
  { key: "pane",          kind: "food",  fr: "Pain",                it: "Pane",                   en: "Bread",             nl: "Brood",               es: "Pan" },
  { key: "vegetariano",   kind: "food",  fr: "Végétarien",          it: "Vegetariano",            en: "Vegetarian",        nl: "Vegetarisch",         es: "Vegetariano" },
  { key: "vegano",        kind: "food",  fr: "Végan",               it: "Vegano",                 en: "Vegan",             nl: "Veganistisch",        es: "Vegano" },
  { key: "senza_glutine", kind: "food",  fr: "Sans gluten",         it: "Senza glutine",          en: "Gluten free",       nl: "Glutenvrij",          es: "Sin gluten" },
  { key: "menu_bambini",  kind: "food",  fr: "Menu enfants",        it: "Menù bambini",           en: "Kids menu",         nl: "Kindermenu",          es: "Menú infantil" },
  { key: "specialita",    kind: "food",  fr: "Spécialités du jour", it: "Specialità del giorno",  en: "Daily specials",    nl: "Dagspecialiteiten",   es: "Especialidades del día" },
  // ---------- BEVANDE ----------
  { key: "vino",          kind: "drink", fr: "Vins",                it: "Vino",                   en: "Wine",              nl: "Wijn",                es: "Vino" },
  { key: "vino_rosso",    kind: "drink", fr: "Vin rouge",           it: "Vino rosso",             en: "Red wine",          nl: "Rode wijn",           es: "Vino tinto" },
  { key: "vino_bianco",   kind: "drink", fr: "Vin blanc",           it: "Vino bianco",            en: "White wine",        nl: "Witte wijn",          es: "Vino blanco" },
  { key: "vino_rosato",   kind: "drink", fr: "Rosé",                it: "Vino rosato",            en: "Rosé wine",         nl: "Rosé",                es: "Vino rosado" },
  { key: "bollicine",     kind: "drink", fr: "Bulles",              it: "Bollicine",              en: "Sparkling",         nl: "Bubbels",             es: "Espumosos" },
  { key: "birra",         kind: "drink", fr: "Bières",              it: "Birra",                  en: "Beer",              nl: "Bier",                es: "Cerveza" },
  { key: "bibite",        kind: "drink", fr: "Boissons",            it: "Bibite",                 en: "Soft drinks",       nl: "Frisdrank",           es: "Refrescos" },
  { key: "soft",          kind: "drink", fr: "Softs",               it: "Soft",                   en: "Soft drinks",       nl: "Frisdranken",         es: "Refrescos" },
  { key: "senza_alcol",   kind: "drink", fr: "Sans alcool",         it: "Senza alcol",            en: "Non-alcoholic",     nl: "Alcoholvrij",         es: "Sin alcohol" },
  { key: "mocktails",     kind: "drink", fr: "Mocktails",           it: "Mocktails",              en: "Mocktails",         nl: "Mocktails",           es: "Mocktails" },
  { key: "succhi_freschi",kind: "drink", fr: "Jus frais",           it: "Succhi freschi",         en: "Fresh juices",      nl: "Verse sappen",        es: "Zumos frescos" },
  { key: "succhi",        kind: "drink", fr: "Jus",                 it: "Succhi",                 en: "Juices",            nl: "Sappen",              es: "Zumos" },
  { key: "acqua",         kind: "drink", fr: "Eaux",                it: "Acqua",                  en: "Water",             nl: "Water",               es: "Agua" },
  { key: "caffetteria",   kind: "drink", fr: "Cafés",               it: "Caffetteria",            en: "Coffee",            nl: "Koffie",              es: "Cafés" },
  { key: "te_tisane",     kind: "drink", fr: "Thés & infusions",    it: "Tè e tisane",            en: "Tea & infusions",   nl: "Thee & kruidenthee",  es: "Tés e infusiones" },
  { key: "tisane",        kind: "drink", fr: "Infusions",           it: "Tisane",                 en: "Herbal teas",       nl: "Kruidenthee",         es: "Infusiones" },
  { key: "aperitivi",     kind: "drink", fr: "Apéritifs",           it: "Aperitivi",              en: "Aperitifs",         nl: "Aperitieven",         es: "Aperitivos" },
  { key: "cocktail",      kind: "drink", fr: "Cocktails",           it: "Cocktail",               en: "Cocktails",         nl: "Cocktails",           es: "Cócteles" },
  { key: "digestivi",     kind: "drink", fr: "Digestifs",           it: "Digestivi",              en: "Digestifs",         nl: "Digestieven",         es: "Digestivos" },
  { key: "amari",         kind: "drink", fr: "Liqueurs",            it: "Amari e liquori",        en: "Liqueurs",          nl: "Likeuren",            es: "Licores" },
];

const LINGUE: (keyof CatStd)[] = ["fr", "it", "en", "nl", "es"];

/** Cerca una categoria standard il cui nome (in una qualsiasi lingua) coincide
 *  con `nome` (case-insensitive, trim). Ritorna la voce o null. */
export function trovaCategoriaStandard(nome: string): CatStd | null {
  const n = nome.trim().toLowerCase();
  if (!n) return null;
  for (const c of CATEGORIE_STANDARD) {
    for (const l of LINGUE) if (String(c[l]).toLowerCase() === n) return c;
  }
  return null;
}

/** name_i18n (solo le lingue richieste) per una categoria standard. */
export function i18nStandard(c: CatStd, langs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of langs) {
    const v = (c as Record<string, unknown>)[l];
    if (typeof v === "string" && v) out[l] = v;
  }
  return out;
}
