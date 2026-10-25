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

/** La carta: pagato con la carta (Commandes); sulla mappa del palmare, il
 *  tavolo che ordina col QR e paga subito, ognuno il suo. */
export const ICONA_CARTA =
  '<svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true"><path d="m42.24 9.6c0-1.58813-1.29188-2.88-2.88-2.88h-36.48c-1.58812 0-2.88 1.29188-2.88 2.88v2.88h42.24z"/><path d="m42.24 32.64v-11.52h-42.24v11.52c0 1.58813 1.29188 2.88 2.88 2.88h36.48c1.58812 0 2.88-1.29188 2.88-2.88zm-31.81266-4.32h-4.66734c-.53016 0-.96-.42984-.96-.96s.42984-.96.96-.96h4.66734c.53016 0 .96.42984.96.96s-.42984.96-.96.96zm8.64 0h-4.66734c-.53016 0-.96-.42984-.96-.96s.42984-.96.96-.96h4.66734c.53016 0 .96.42984.96.96s-.42984.96-.96.96z"/><path d="m0 14.4h42.24v4.8h-42.24z"/><path d="m45.12 12.48h-.96v20.16c0 2.64656-2.15344 4.8-4.8 4.8h-33.6v.96c0 1.58813 1.29187 2.88 2.88 2.88h36.48c1.58813 0 2.88-1.29188 2.88-2.88v-23.04c0-1.58813-1.29187-2.88-2.88-2.88z"/></svg>';

/** Il QR: il tavolo ordina col QR (conto aperto o pagamento diretto). Sulla
 *  mappa del palmare (25/10/2026). */
export const ICONA_QR =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M3 3h7v7H3zm2 2v3h3V5zM14 3h7v7h-7zm2 2v3h3V5zM3 14h7v7H3zm2 2v3h3v-3z"/><path d="M14 14h3v3h-3zM18 14h3v2h-3zM18 18h3v3h-3zM14 19h3v2h-3z"/></svg>';

/** Cibo (forchetta) e bevanda (bicchiere): il tipo della categoria
 *  (`menu_categories.kind`) in Menu; nel palmare, i due bottoni che filtrano
 *  le categorie dell'ordine (25/10/2026). */
export const ICONA_CIBO =
  '<svg fill="currentColor" viewBox="0 0 489.773 489.773" aria-hidden="true"><path d="M155.183,305.646c-2.081,0.175-4.157,0.265-6.238,0.265c-5.693,0-11.23-0.826-16.652-2.081L6.834,429.293c-6.158,6.149-6.158,16.137,0,22.287l32.47,32.478c6.158,6.15,16.135,6.15,22.276,0l150.785-150.757l-27.944-30.15L155.183,305.646z"/><path d="M485.345,104.649c-5.888-5.885-15.417-5.885-21.304,0l-81.303,81.301c-7.693,7.685-20.154,7.685-27.847,0c-7.659-7.679-7.659-20.13,0-27.807l80.901-80.884c6.112-6.118,6.112-16.036,0-22.168c-6.141-6.11-16.055-6.11-22.167,0l-80.868,80.876c-7.693,7.693-20.14,7.693-27.833,0c-7.677-7.676-7.677-20.136,0-27.806l81.286-81.293c5.904-5.894,5.904-15.441,0-21.343c-5.888-5.895-15.434-5.895-21.338,0l-91.458,91.463c-21.989,22.003-28.935,52.888-21.816,80.991l61.31,61.314c28.101,7.093,59.001,0.144,80.965-21.841l91.471-91.458C491.249,120.1,491.249,110.543,485.345,104.649z"/><path d="M41.093,13.791c-3.134-3.135-7.372-4.854-11.724-4.854c-0.926,0-1.857,0.079-2.766,0.231c-5.295,0.896-9.838,4.295-12.172,9.133c-26.79,55.373-15.594,121.631,27.894,165.121l77.801,77.791c7.676,7.685,18.055,11.939,28.819,11.939c1.151,0,2.305-0.048,3.456-0.143l45.171-3.855l196.971,212.489c3.058,3.303,7.342,5.221,11.855,5.31c0.093,0,0.19,0,0.288,0c4.412,0,8.636-1.743,11.771-4.855l33.734-33.741c3.117-3.11,4.859-7.331,4.859-11.73c0-4.398-1.742-8.622-4.846-11.732L41.093,13.791z"/></svg>';
export const ICONA_BEVANDA =
  '<svg fill="currentColor" viewBox="0 0 512 512" aria-hidden="true"><path d="M438.925,169.204c-3.253-48.149-21.943-109.273-49.729-160.47C386.273,3.354,380.642,0,374.523,0H137.371c-6.12,0-11.75,3.354-14.674,8.734C96.79,56.469,78.792,112.855,73.819,159.304C61.745,272.036,142.207,357.641,239.25,366.527v112.081h-66.783c-9.217,0-16.696,7.473-16.696,16.696c0,9.223,7.479,16.696,16.696,16.696h166.956c9.217,0,16.696-7.473,16.696-16.696c0-9.223-7.479-16.696-16.696-16.696H272.53V366.553C367.133,358.044,446.157,276.148,438.925,169.204z M294.903,289.391c-9.22,0-16.696-7.475-16.696-16.696c0-9.22,7.475-16.696,16.696-16.696s16.696,7.475,16.696,16.696C311.599,281.916,304.124,289.391,294.903,289.391z M216.99,256c-9.22,0-16.696-7.475-16.696-16.696c0-9.22,7.475-16.696,16.696-16.696s16.696,7.475,16.696,16.696C233.686,248.525,226.211,256,216.99,256z M269.64,158.759c-20.171-7.144-42.739-7.154-64.184,1.371c-11.132,4.445-31.724,16.625-58.911,3.022c-12.041-6.021-25.183-9.1-38.385-9.454c5.412-37.404,19.692-81.765,39.299-120.307h216.978c20.585,40.464,35.26,87.307,39.991,125.802c-23.48-8.624-49.899-7.326-72.469,3.959C303.217,177.532,280.771,162.66,269.64,158.759z"/></svg>';

/** La nota (il fumetto): le note in Accueil; nel palmare, il commento del
 *  cameriere sotto il piatto (25/10/2026). */
export const ICONA_NOTA =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>';

/** Il cestino: annullare un ordine (Commandes; la card dell'ordine nel
 *  palmare, 25/10/2026). */
export const ICONA_CESTINO =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

/** L'orologio: l'ora di ritiro (Commandes); nel palmare, la prenotazione che
 *  arriva sul tavolo (25/10/2026). */
export const ICONA_OROLOGIO =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 6.5 12 12 15.5 14"/></svg>';
