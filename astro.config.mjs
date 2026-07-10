// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
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
