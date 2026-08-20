import { supabaseAdmin } from "./db";
import { TEMA_DEFAULT } from "./admin/superAdmin";

// Legge il TEMA brand del cliente (app_config "admin_theme") e ne deriva una
// palette pronta per le EMAIL, robusta sia su fondo chiaro che scuro anche se
// il cliente ha impostato solo alcune chiavi. Fallback: colori MOODD.
const RE_HEX = /^#[0-9a-fA-F]{6}$/;

export interface TemaEmail {
  bg: string;        // fondo esterno (cornice)
  card: string;      // fondo del contenitore (dove sta il testo)
  accent: string;    // colore brand: barra, bordo box, bottone
  onAccent: string;  // testo sul bottone accent
  title: string;     // titolo/valori: massimo contrasto sul card
  text: string;      // corpo del testo
  muted: string;     // testo secondario (insegna, footer)
  border: string;    // bordi e separatori
  tint: string;      // fondo tenue del box messaggio
  tintBorder: string;// bordo del box messaggio
  isDark: boolean;
}

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return "rgba(" + r + ", " + g + ", " + b + ", " + a + ")";
}

export async function temaEmail(): Promise<TemaEmail> {
  const t: Record<string, string> = { ...TEMA_DEFAULT };
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "admin_theme")
      .maybeSingle();
    const obj = JSON.parse(String((data as { value?: unknown } | null)?.value ?? "{}"));
    for (const k of Object.keys(TEMA_DEFAULT)) {
      const v = (obj as Record<string, unknown>)?.[k];
      if (typeof v === "string" && RE_HEX.test(v)) t[k] = v.toLowerCase();
    }
  } catch {
    /* tema di default MOODD */
  }

  const card = t.card || t.bg;
  const isDark = lum(card) < 0.4;
  const contrast = isDark ? "#ffffff" : "#1a1a1a";
  const accentDark = lum(t.accent) < 0.55;
  // Testo leggibile anche se il tema non ridefinisce text/muted per il suo fondo.
  const text = isDark
    ? (lum(t.text) > 0.5 ? t.text : "#c9c2ba")
    : (lum(t.text) < 0.6 ? t.text : "#555555");
  const muted = isDark
    ? (lum(t.muted) > 0.4 ? t.muted : "#8f8880")
    : (lum(t.muted) < 0.72 ? t.muted : "#9a938b");

  return {
    bg: t.bg,
    card,
    accent: t.accent,
    onAccent: accentDark ? "#ffffff" : "#1a1a1a",
    title: contrast,
    text,
    muted,
    border: rgba(contrast, 0.1),
    tint: rgba(t.accent, 0.06),
    tintBorder: rgba(t.accent, isDark ? 0.55 : 0.45),
    isDark,
  };
}
