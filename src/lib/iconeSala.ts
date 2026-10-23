/**
 * LE ICONE DELLA SALA, una copia sola (23/10/2026).
 *
 * Erano scritte dentro `/admin/reservations` (l'origine della prenotazione,
 * la riga del modale dettagli). Il palmare usa le STESSE: un walk-in o i
 * coperti hanno un disegno solo in tutto il motore, non uno per pagina.
 *
 * ⚠️ Nessun import: si usano nel render (`set:html`) e negli script.
 */

/** Walk-in (le impronte): chi entra senza prenotare. */
export const ICONA_WALKIN =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m20 15h-6a1 1 0 0 1 -1-.9l-.6-6a4.62 4.62 0 1 1 9.2 0l-.6 6a1 1 0 0 1 -1 .9zm-5.1-2h4.2l.51-5.12a2.59 2.59 0 0 0 -.67-2 2.68 2.68 0 0 0 -3.88 0 2.59 2.59 0 0 0 -.67 2zm2.1 10a4 4 0 0 1 -4-4v-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2a4 4 0 0 1 -4 4zm-2-5v1a2 2 0 0 0 4 0v-1zm-5-5h-6a1 1 0 0 1 -1-.9l-.6-6a4.62 4.62 0 1 1 9.2 0l-.6 6a1 1 0 0 1 -1 .9zm-5.1-2h4.2l.51-5.12a2.59 2.59 0 0 0 -.67-2 2.68 2.68 0 0 0 -3.88 0 2.59 2.59 0 0 0 -.67 2zm2.1 10a4 4 0 0 1 -4-4v-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2a4 4 0 0 1 -4 4zm-2-5v1a2 2 0 0 0 4 0v-1z"/></svg>';

/** Le persone / i coperti. */
export const ICONA_PERSONE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 20.5v-1.4a4 4 0 0 0-4-4h-5a4 4 0 0 0-4 4v1.4"/><circle cx="9" cy="7.5" r="3.2"/><path d="M21.5 20.5v-1.4a4 4 0 0 0-3-3.87"/><path d="M16.2 4.3a4 4 0 0 1 0 7.5"/></svg>';

/** Il tavolo. */
export const ICONA_TAVOLO =
  '<svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><ellipse cx="50" cy="25" rx="40" ry="15"/><path d="m50 45c-16.01 0-32.115-3.538-40-10.361v5.361c0 8.737 16.139 15.889 36.666 16.595v26.738h-3.333l-2.271-9.082c-6.539 1.367-11.062 4.16-11.062 7.415 0 4.6 8.955 8.333 19.999 8.333 11.042 0 20-3.733 20-8.333 0-4.124-7.215-7.545-16.666-8.209v-16.862c20.526-.706 36.667-7.858 36.667-16.595v-5.361c-7.885 6.823-23.992 10.361-40 10.361z"/></svg>';
