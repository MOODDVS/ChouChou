/**
 * LE ICONE DELLA SALA, una copia sola (23/10/2026).
 *
 * Erano scritte dentro `/admin/reservations` (e la matita in `/admin/orders`) (l'origine della prenotazione,
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

/** La matita: modificare (le card di Commandes, gli ordini del palmare). */
export const ICONA_MATITA =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

/** La stampante: stampare (il ticket in Commandes, l'addizione del palmare). */
export const ICONA_STAMPA =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/></svg>';

/** Le monete: incassare in contanti (Commandes), «Encaisser» del palmare. */
export const ICONA_MONETE =
  '<svg viewBox="0 0 314.965 314.965" fill="currentColor" aria-hidden="true"><path d="M104.982,104.987c60.086,0,104.983-23.753,104.983-44.992c0-21.237-44.898-44.991-104.983-44.991S0,38.758,0,59.995C0,81.234,44.896,104.987,104.982,104.987z"/><path d="M104.982,284.961c8.77,0,17.211-0.51,25.24-1.439c-6.768-8.698-12.365-18.35-16.558-28.716c-2.881,0.097-5.772,0.164-8.683,0.164c-34.333,0-66.847-6.803-91.55-19.155C8.567,233.383,4.091,230.77,0,228.004v11.966C0,261.207,44.896,284.961,104.982,284.961z"/><path d="M104.982,224.97c0.308,0,0.611-0.005,0.918-0.006c-0.615-4.916-0.936-9.923-0.936-15.003c0-5.078,0.32-10.082,0.936-14.994c-0.307,0-0.611,0.011-0.918,0.011c-34.333,0-66.846-6.803-91.55-19.155c-4.865-2.432-9.342-5.045-13.433-7.81v11.965C0,201.216,44.896,224.97,104.982,224.97z"/><path d="M104.982,164.977c2.976,0,5.912-0.06,8.811-0.174c4.656-11.423,11.019-21.974,18.777-31.331c-8.982,0.99-18.213,1.515-27.588,1.515c-34.333,0-66.846-6.803-91.55-19.155c-4.865-2.433-9.342-5.045-13.433-7.811v11.966C0,141.225,44.896,164.977,104.982,164.977z"/><path d="M149.982,160.244c-6.49,9.757-11.127,20.846-13.408,32.762c-1.053,5.493-1.609,11.16-1.609,16.955c0,4.357,0.318,8.641,0.919,12.834c1.477,10.301,4.704,20.041,9.37,28.914c4.896,9.311,11.373,17.666,19.076,24.701c16.008,14.621,37.298,23.551,60.635,23.551c49.626,0,90-40.374,90-90c0-49.627-40.374-90-90-90c-5.129,0-10.158,0.438-15.056,1.266C184.961,125.446,163.473,139.965,149.982,160.244z"/></svg>';
