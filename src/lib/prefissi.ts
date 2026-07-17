/**
 * Prefissi telefonici internazionali (bandiera + indicativo).
 * Usati dai campi telefono dell'admin (e in futuro dal widget di
 * prenotazione). Il default viene dal paese del cliente in
 * src/config/client.ts (CLIENT.paese, codice ISO).
 */
export interface Prefisso {
  code: string; // ISO 3166-1 alpha-2
  flag: string;
  dial: string;
  nome: string;
}

export const PREFISSI: Prefisso[] = [
  { code: "BE", flag: "🇧🇪", dial: "+32", nome: "Belgique" },
  { code: "FR", flag: "🇫🇷", dial: "+33", nome: "France" },
  { code: "NL", flag: "🇳🇱", dial: "+31", nome: "Pays-Bas" },
  { code: "LU", flag: "🇱🇺", dial: "+352", nome: "Luxembourg" },
  { code: "DE", flag: "🇩🇪", dial: "+49", nome: "Allemagne" },
  { code: "IT", flag: "🇮🇹", dial: "+39", nome: "Italie" },
  { code: "ES", flag: "🇪🇸", dial: "+34", nome: "Espagne" },
  { code: "PT", flag: "🇵🇹", dial: "+351", nome: "Portugal" },
  { code: "GB", flag: "🇬🇧", dial: "+44", nome: "Royaume-Uni" },
  { code: "IE", flag: "🇮🇪", dial: "+353", nome: "Irlande" },
  { code: "CH", flag: "🇨🇭", dial: "+41", nome: "Suisse" },
  { code: "AT", flag: "🇦🇹", dial: "+43", nome: "Autriche" },
  { code: "PL", flag: "🇵🇱", dial: "+48", nome: "Pologne" },
  { code: "RO", flag: "🇷🇴", dial: "+40", nome: "Roumanie" },
  { code: "GR", flag: "🇬🇷", dial: "+30", nome: "Grèce" },
  { code: "SE", flag: "🇸🇪", dial: "+46", nome: "Suède" },
  { code: "DK", flag: "🇩🇰", dial: "+45", nome: "Danemark" },
  { code: "NO", flag: "🇳🇴", dial: "+47", nome: "Norvège" },
  { code: "MA", flag: "🇲🇦", dial: "+212", nome: "Maroc" },
  { code: "DZ", flag: "🇩🇿", dial: "+213", nome: "Algérie" },
  { code: "TN", flag: "🇹🇳", dial: "+216", nome: "Tunisie" },
  { code: "TR", flag: "🇹🇷", dial: "+90", nome: "Turquie" },
  { code: "US", flag: "🇺🇸", dial: "+1", nome: "États-Unis / Canada" },
  { code: "BR", flag: "🇧🇷", dial: "+55", nome: "Brésil" },
  { code: "CN", flag: "🇨🇳", dial: "+86", nome: "Chine" },
  { code: "JP", flag: "🇯🇵", dial: "+81", nome: "Japon" },
  { code: "IN", flag: "🇮🇳", dial: "+91", nome: "Inde" },
  { code: "RU", flag: "🇷🇺", dial: "+7", nome: "Russie" },
  { code: "UA", flag: "🇺🇦", dial: "+380", nome: "Ukraine" },
  { code: "CD", flag: "🇨🇩", dial: "+243", nome: "RD Congo" },
];

/**
 * Se il numero digitato/incollato inizia con un prefisso internazionale
 * noto ("+32…", "0032…"), lo separa: ritorna { dial, resto } con il
 * resto già pulito (niente spazi/trattini, niente 0 iniziale).
 * Ritorna null se non c'è un prefisso riconoscibile.
 * Vince il prefisso PIÙ LUNGO che combacia (+352 prima di +35…).
 */
export function separaPrefisso(grezzo: string): { dial: string; resto: string } | null {
  let s = grezzo.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) return null;
  let trovato: Prefisso | null = null;
  for (const p of PREFISSI) {
    if (s.startsWith(p.dial) && (!trovato || p.dial.length > trovato.dial.length)) trovato = p;
  }
  if (!trovato) return null;
  return { dial: trovato.dial, resto: s.slice(trovato.dial.length).replace(/^0/, "") };
}
