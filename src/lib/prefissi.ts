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
  // --- Medio Oriente / Golfo ---
  { code: "AE", flag: "🇦🇪", dial: "+971", nome: "Émirats arabes unis" },
  { code: "SA", flag: "🇸🇦", dial: "+966", nome: "Arabie saoudite" },
  { code: "QA", flag: "🇶🇦", dial: "+974", nome: "Qatar" },
  { code: "KW", flag: "🇰🇼", dial: "+965", nome: "Koweït" },
  { code: "BH", flag: "🇧🇭", dial: "+973", nome: "Bahreïn" },
  { code: "OM", flag: "🇴🇲", dial: "+968", nome: "Oman" },
  { code: "IL", flag: "🇮🇱", dial: "+972", nome: "Israël" },
  { code: "LB", flag: "🇱🇧", dial: "+961", nome: "Liban" },
  { code: "JO", flag: "🇯🇴", dial: "+962", nome: "Jordanie" },
  { code: "EG", flag: "🇪🇬", dial: "+20", nome: "Égypte" },
  // --- Resto Europa ---
  { code: "FI", flag: "🇫🇮", dial: "+358", nome: "Finlande" },
  { code: "CZ", flag: "🇨🇿", dial: "+420", nome: "Tchéquie" },
  { code: "SK", flag: "🇸🇰", dial: "+421", nome: "Slovaquie" },
  { code: "HU", flag: "🇭🇺", dial: "+36", nome: "Hongrie" },
  { code: "BG", flag: "🇧🇬", dial: "+359", nome: "Bulgarie" },
  { code: "HR", flag: "🇭🇷", dial: "+385", nome: "Croatie" },
  { code: "SI", flag: "🇸🇮", dial: "+386", nome: "Slovénie" },
  { code: "RS", flag: "🇷🇸", dial: "+381", nome: "Serbie" },
  { code: "LT", flag: "🇱🇹", dial: "+370", nome: "Lituanie" },
  { code: "LV", flag: "🇱🇻", dial: "+371", nome: "Lettonie" },
  { code: "EE", flag: "🇪🇪", dial: "+372", nome: "Estonie" },
  { code: "IS", flag: "🇮🇸", dial: "+354", nome: "Islande" },
  { code: "MT", flag: "🇲🇹", dial: "+356", nome: "Malte" },
  { code: "CY", flag: "🇨🇾", dial: "+357", nome: "Chypre" },
  // --- Resto del mondo ---
  { code: "AU", flag: "🇦🇺", dial: "+61", nome: "Australie" },
  { code: "NZ", flag: "🇳🇿", dial: "+64", nome: "Nouvelle-Zélande" },
  { code: "MX", flag: "🇲🇽", dial: "+52", nome: "Mexique" },
  { code: "AR", flag: "🇦🇷", dial: "+54", nome: "Argentine" },
  { code: "ZA", flag: "🇿🇦", dial: "+27", nome: "Afrique du Sud" },
  { code: "NG", flag: "🇳🇬", dial: "+234", nome: "Nigéria" },
  { code: "SN", flag: "🇸🇳", dial: "+221", nome: "Sénégal" },
  { code: "CI", flag: "🇨🇮", dial: "+225", nome: "Côte d'Ivoire" },
  { code: "CM", flag: "🇨🇲", dial: "+237", nome: "Cameroun" },
  { code: "TH", flag: "🇹🇭", dial: "+66", nome: "Thaïlande" },
  { code: "VN", flag: "🇻🇳", dial: "+84", nome: "Vietnam" },
  { code: "ID", flag: "🇮🇩", dial: "+62", nome: "Indonésie" },
  { code: "MY", flag: "🇲🇾", dial: "+60", nome: "Malaisie" },
  { code: "SG", flag: "🇸🇬", dial: "+65", nome: "Singapour" },
  { code: "PH", flag: "🇵🇭", dial: "+63", nome: "Philippines" },
  { code: "KR", flag: "🇰🇷", dial: "+82", nome: "Corée du Sud" },
  { code: "HK", flag: "🇭🇰", dial: "+852", nome: "Hong Kong" },
  { code: "TW", flag: "🇹🇼", dial: "+886", nome: "Taïwan" },
  { code: "PK", flag: "🇵🇰", dial: "+92", nome: "Pakistan" },
  { code: "BD", flag: "🇧🇩", dial: "+880", nome: "Bangladesh" },
  { code: "LK", flag: "🇱🇰", dial: "+94", nome: "Sri Lanka" },
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

/**
 * Opzioni <option> per un select di prefisso telefonico, con selezionato il
 * paese di default (codice ISO, es. "BE"). Da usare con set:html sul <select>.
 * Centralizzata qui per non duplicarla in ogni pagina (ordini, bons cadeaux, …).
 */
export function opzioniPrefisso(paeseDefault: string): string {
  return PREFISSI.map(
    (pr) => `<option value="${pr.dial}"${pr.code === paeseDefault ? " selected" : ""}>${pr.flag} ${pr.dial}</option>`
  ).join("");
}

/**
 * Numero completo internazionale da (prefisso selezionato + numero grezzo).
 * Se il numero digitato contiene GIÀ un prefisso (es. autofill "+32…"), quello
 * vince. Ritorna undefined se il numero è vuoto.
 */
export function telefonoCompleto(dialSelezionato: string, numeroGrezzo: string): string | undefined {
  const raw = (numeroGrezzo ?? "").trim();
  if (!raw) return undefined;
  const sep = separaPrefisso(raw);
  if (sep) return `${sep.dial} ${sep.resto}`.trim();
  const local = raw.replace(/[\s\-().]/g, "").replace(/^0/, "");
  return `${dialSelezionato} ${local}`.trim();
}

/**
 * Collega un select-prefisso a un input-numero: quando l'utente digita o
 * incolla un numero che inizia con un prefisso riconosciuto (es. "+33…"),
 * il select passa AUTOMATICAMENTE a quel paese e l'input tiene solo la parte
 * locale. Da chiamare una volta al setup. Riutilizzabile ovunque.
 */
export function collegaPrefissoTel(prefixSelect: HTMLSelectElement, input: HTMLInputElement): void {
  input.addEventListener("input", () => {
    const sep = separaPrefisso(input.value);
    if (!sep) return;
    // agisci solo se quel prefisso è tra le opzioni del select
    if (!Array.from(prefixSelect.options).some((o) => o.value === sep.dial)) return;
    prefixSelect.value = sep.dial;
    input.value = sep.resto;
  });
}
