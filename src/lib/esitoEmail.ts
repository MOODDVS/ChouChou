/**
 * L'ESITO DI UN INVIO EMAIL — una regola, e sta da sola.
 *
 * ⚠️ Stava fra le regole della newsletter, ma non e' una regola della
 * newsletter: e' una regola di Resend, e la seguono anche le ventuno email
 * transazionali (conferme, ordini, buoni, annullamenti). Un pezzo condiviso
 * che vive in casa di uno dei due usi finisce per essere importato «da
 * dove capita», e il prossimo che lo cerca non lo trova.
 *
 * Nessun import, nessuna configurazione: entra l'oggetto che rende il client
 * di Resend, esce una riga o niente.
 */

/**
 * IL MOTIVO, IN CHIARO, DI UN INVIO RIFIUTATO.
 *
 * ⚠️ Regola pura, e sta qui perche' e' il pezzo che si puo' provare: il
 * client di Resend NON LANCIA ECCEZIONI quando l'API rifiuta un'email.
 * Rende `{ data, error }`, e un `try/catch` intorno non vede niente. Chi
 * scrive `await resend.emails.send(...)` e tira avanti sta dicendo «mandata»
 * a prescindere — anche quando Resend ha risposto «dominio non verificato».
 *
 * Rende null se e' andata bene, altrimenti una riga da mostrare a chi ha
 * premuto il bottone: di solito e' una cosa che puo' sistemare da se'
 * (mittente fuori dal dominio verificato, chiave scaduta, limite di invii).
 */
export function motivoInvio(esito: { error?: unknown } | null | undefined): string | null {
  const e = esito?.error as { message?: unknown; name?: unknown; statusCode?: unknown } | null | undefined;
  if (!e) return null;
  const testo = String(e.message ?? "").trim();
  const nome = String(e.name ?? "").trim();
  const codice = e.statusCode ? ` (${String(e.statusCode)})` : "";
  if (testo) return nome && !testo.toLowerCase().includes(nome.toLowerCase()) ? `${testo} [${nome}]${codice}` : `${testo}${codice}`;
  return nome ? `${nome}${codice}` : `Refusé par Resend${codice}`;
}
