/**
 * LE LINGUE DELL'ADMIN — codici, locale, controllo. Separate dal dizionario
 * (audit 12/11/2026): il browser le usa senza scaricare i 2900 testi in 5
 * lingue (`adminClient.ts`). Il server le legge da `admin.ts`, che le
 * riesporta: nessun import cambia.
 */

export const LINGUE_ADMIN = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "it", label: "Italiano" },
  { code: "nl", label: "Nederlands" },
  { code: "es", label: "Español" },
] as const;

export type AdminLang = (typeof LINGUE_ADMIN)[number]["code"];

export const ADMIN_LANG_CODES: AdminLang[] = LINGUE_ADMIN.map((l) => l.code);
export const ADMIN_LANG_DEFAULT: AdminLang = "fr";

/** true se `v` è un codice lingua admin valido. */
export function isAdminLang(v: unknown): v is AdminLang {
  return typeof v === "string" && (ADMIN_LANG_CODES as string[]).includes(v);
}

/** Locale BCP-47 per formattare date e orari (per lingua admin). */
export const ADMIN_LOCALE: Record<AdminLang, string> = {
  fr: "fr-BE",
  en: "en-GB",
  it: "it-IT",
  nl: "nl-BE",
  es: "es-ES",
};
