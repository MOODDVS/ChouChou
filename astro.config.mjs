// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { inSitemap } from "./src/lib/seo/sitemapRegole";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // Dietro il proxy Hostinger, la protezione CSRF integrata di Astro
  // (security.checkOrigin, attiva di default) confronta l'Origin del browser
  // con l'host che ricostruisce dalla richiesta proxata: i due non coincidono,
  // quindi TUTTE le POST/PUT/PATCH/DELETE prive di Content-Type JSON venivano
  // rifiutate con 403 «Cross-site … form submissions are forbidden» (es. le
  // cancellazioni admin via POST + X-Method-Override). In locale l'Origin
  // coincide con l'host, perciò lì funzionava. La disattiviamo: l'admin è
  // autenticato via Bearer token (non via cookie), quindi non è esposto a CSRF,
  // e gli endpoint pubblici sono non autenticati e già inviano JSON.
  security: { checkOrigin: false },
  // Astro 7 ha cambiato il default di `compressHTML` da `true` a `"jsx"`:
  // con le regole JSX gli spazi FRA elementi inline spariscono, e
  // `<span>ciao</span> <em>mondo</em>` diventa «ciaomondo». Qui si dichiara
  // il comportamento di sempre: un aggiornamento del motore non deve
  // cambiare la spaziatura di pagine che nessuno ha toccato.
  // ⚠️ Questo file e' `merge=ours`: il merge del motore NON lo porta.
  compressHTML: true,
  // ⚠️ `sitemap()` NUDO mette in sitemap ogni pagina che il progetto sa
  // rendere — comprese le ~15 pagine `/admin/`, che rispondono 302 al login.
  // Le regole stanno in `src/lib/seo/sitemapRegole.ts`, e `public/robots.txt`
  // dice la stessa cosa dall'altro lato.
  integrations: [react(), sitemap({ filter: inSitemap })],
  outDir: "./build", // <-- a livello root: build finale in ./build/server/entry.mjs
  build: {
    // Inietta il CSS dei componenti direttamente nell'HTML invece di servirlo
    // come file separati che bloccano il rendering. Elimina le richieste di
    // rete per Layout.css / CtaFinal.css (erano render-blocking).
    inlineStylesheets: "always",
  },
  i18n: {
    locales: ["fr", "en"],
    defaultLocale: "fr",
    routing: {
      // fr (default) senza prefisso, /en/... per l'inglese
      prefixDefaultLocale: false,
    },
  },
  // ⚠️ LE FAMIGLIE DEL PANNELLO. Questo file e' `merge=ours`: il merge del
  // motore NON lo porta, e senza questo blocco `AdminHead` -> `<Fonts />`
  // lancia FontFamilyNotFound e l'admin non si apre nemmeno. Sono le cinque
  // famiglie del motore, coi pesi del motore.
  //
  // ⚠️ Quicksand sta qui con UN peso solo (700), che e' quello del pannello.
  // Il sito di ChouChou usa Quicksand a 400/500/600/700 e continua a
  // chiederla a Google dal suo Layout: le due cose non si incontrano, perche'
  // <Fonts /> lo rende solo l'admin. Il giorno che si fara' PRESTAZIONI.md §1
  // su questo sito le due liste di pesi si scontrano davvero, e li' la
  // risposta sara' dare al pannello una variabile sua.
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Nunito Sans",
      cssVariable: "--font-body",
      // ⚠️ NIENTE 800, e non e' una svista. Prima le pagine chiedevano a Google
      // `Nunito+Sans:wght@400;600;700;900`: l'800 non esisteva, e le 39 regole
      // `font-weight: 800` del pannello finivano sul 900 (per la regola di
      // accostamento CSS: sopra il 500 si cerca prima verso l'alto). Dichiarare
      // l'800 sul serio le fa dimagrire tutte. Se serve davvero, si cambiano
      // prima le 39 regole.
      weights: [400, 600, 700, 900],
      styles: ["normal"],
      subsets: ["latin", "latin-ext"],
      display: "swap",
    },
    {
      provider: fontProviders.google(),
      name: "Quicksand",
      cssVariable: "--font-title",
      // ⚠️ UN PESO SOLO, ed e' voluto. Le pagine del pannello chiedevano a
      // Google `Quicksand:wght@700` e basta: c'era una faccia sola, quindi
      // QUALSIASI peso — anche i `font-weight: 500` e `600` scritti nel CSS —
      // ricadeva sul 700. Tutti i titoli erano in grassetto per questo.
      //
      // Dichiarando 500/600/700 sul serio, il 21/09/2026, ognuna di quelle
      // regole ha finalmente trovato la faccia che chiedeva: i titoli sono
      // diventati piu' magri in tutto il pannello. Il CSS non era cambiato di
      // una virgola — era cambiato cosa il browser aveva in mano.
      weights: [700],
      styles: ["normal"],
      subsets: ["latin", "latin-ext"],
      display: "swap",
    },
    {
      // Titoli del widget di prenotazione e delle pagine pubbliche del motore.
      provider: fontProviders.google(),
      name: "Marcellus",
      cssVariable: "--font-serif",
      weights: [400],
      styles: ["normal"],
      subsets: ["latin", "latin-ext"],
      display: "swap",
    },
    {
      // Titoloni maiuscoli (widget prenotazione, demo).
      provider: fontProviders.google(),
      name: "Bebas Neue",
      cssVariable: "--font-display",
      weights: [400],
      styles: ["normal"],
      subsets: ["latin", "latin-ext"],
      display: "swap",
    },
    {
      // Firma a mano del saluto in home. Un peso solo, e non e' critica:
      // non si precarica (vedi Fonts.astro).
      provider: fontProviders.google(),
      name: "Homemade Apple",
      cssVariable: "--font-mano",
      weights: [400],
      styles: ["normal"],
      subsets: ["latin"],
      display: "swap",
    },
  ],
  site: "https://www.comptoirchouchou.be",
});
