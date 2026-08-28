/**
 * Nome "proprio": prima lettera di OGNI parola in MAIUSCOLO, il resto in
 * minuscolo, preservando gli accenti (Unicode-safe). Separatori di parola:
 * spazi, trattini e apostrofi. Gli spazi multipli vengono compressi.
 *
 *   "Enzo SANTAMARIA"    → "Enzo Santamaria"
 *   "VÉRONIQUE patigny"  → "Véronique Patigny"
 *   "jean-pierre"        → "Jean-Pierre"
 *   "  marco   ROSSI  "  → "Marco Rossi"
 */
export function normalizzaNome(input: unknown): string {
  const s = String(input ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  // Ogni "parola" = sequenza di lettere/segni diacritici; tutto il resto
  // (spazi, trattini, apostrofi) resta invariato e fa da separatore.
  return s.replace(/[\p{L}\p{M}]+/gu, (parola) =>
    parola.charAt(0).toUpperCase() + parola.slice(1).toLowerCase()
  );
}
