/**
 * Fusi orari offerti nell'admin — UN SOLO elenco.
 *
 * Prima esisteva solo dentro Réglages → Général, scritto a mano come venti
 * `<option>`. Il giorno che serve anche altrove (la scheda di una sede) la
 * tentazione e' incollarlo: due elenchi che partono uguali e divergono alla
 * prima aggiunta. Stessa forma di `prefissi.ts`: l'elenco sta qui, e chi lo
 * mostra chiede il markup.
 *
 * Sono i fusi dove il motore ha davvero clienti (o li avra'): Europa
 * occidentale, piu' qualche piazza fuori. Non e' l'elenco IANA completo —
 * 600 voci in una tendina non aiutano nessuno.
 */
export const FUSI = [
  "Europe/Brussels",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Europe/Luxembourg",
  "Europe/Berlin",
  "Europe/Zurich",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Vienna",
  "Europe/Athens",
  "Europe/Warsaw",
  "Europe/Stockholm",
  "America/New_York",
  "America/Toronto",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Tokyo",
] as const;

export const FUSO_DEFAULT = "Europe/Brussels";

/** Le `<option>` della tendina, con `scelto` gia' selezionato.
 *  Un fuso salvato che non e' nell'elenco NON si perde: resta come voce sua,
 *  o aprire la scheda lo cancellerebbe in silenzio. */
export function opzioniFuso(scelto: string = FUSO_DEFAULT): string {
  const voci = FUSI.map(
    (f) => `<option value="${f}"${f === scelto ? " selected" : ""}>${f}</option>`,
  );
  if (scelto && !FUSI.includes(scelto as (typeof FUSI)[number])) {
    const sicuro = scelto.replace(/[^A-Za-z0-9_/+-]/g, "");
    voci.unshift(`<option value="${sicuro}" selected>${sicuro}</option>`);
  }
  return voci.join("");
}
