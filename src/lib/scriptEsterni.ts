/**
 * GLI SCRIPT DELLE PAGINE NON SI INCOLLANO MAI NELL'HTML (31/10/2026).
 *
 * Astro, in BUILD, incolla dentro la pagina (`<script type="module">…`) ogni
 * script senza import piu' piccolo di 4 kB, invece di servirlo come file.
 * In `npm run dev` non lo fa mai. Sull'admin pero' c'e' una CSP con
 * `script-src 'self' 'nonce-…'` (`middleware.ts`): uno script incollato
 * SENZA nonce il browser non lo esegue, e non lo dice a nessuno.
 *
 * E' cosi' che le pillole delle sale del palmare funzionavano in locale e
 * non in produzione (Educazione Napoletana, app.restohub.cloud): lo script di
 * `salle.astro` era sceso sotto i 4 kB e veniva incollato. Stessa sorte per i
 * filtri di `salle/orders` e il timer di `IsolaTavolo`.
 *
 * Questa funzione va in `vite.build.assetsInlineLimit` di OGNI
 * `astro.config.mjs` (motore e clienti): gli script restano file serviti
 * dal dominio (`'self'`, permessi dalla CSP); per tutto il resto (immagini,
 * caratteri) `undefined` = la regola normale di Vite.
 */
export function scriptMaiInline(file: string): boolean | undefined {
  return /\.m?js$/.test(file) ? false : undefined;
}
