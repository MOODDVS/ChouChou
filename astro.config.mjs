// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";

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
  integrations: [react(), sitemap()],
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
  site: "https://pizzeria77.be",
});
