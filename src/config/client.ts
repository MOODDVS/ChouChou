/**
 * CONFIG CLIENTE — MOODD Admin engine.
 * Questo è l’UNICO file da modificare per rebrandizzare l’admin su un
 * nuovo cliente (insieme agli asset in /public: loghi, icone, manifest.json).
 *
 * I dati "vivi" (telefono, email, indirizzo) possono essere sovrascritti
 * dal cliente in Réglages → Général (app_config): i valori qui sotto sono
 * i FALLBACK usati quando app_config è vuoto o irraggiungibile.
 */
export const CLIENT = {
  /** Nome commerciale: title delle pagine admin, email, prodotti Stripe. */
  nome: "La Molisana",
  /** Claim mostrato sotto il logo nelle email ("NOME — CLAIM"). */
  claim: "Pizza & Pasta",
  /** Logo quadrato (header admin). */
  logoAdmin: "/SVG/favLa-Molisana-.svg",
  /** Logo esteso (pagina login admin). */
  logoLogin: "/SVG/logoLa-Molisana-.svg",
  /** Fallback di Réglages → Général. */
  telefono: "+32 455 13 14 65",
  email: "pizzeria@lamolisana.be",
  indirizzo: "Av. Adolphe Demeur 37, 1060 Saint-Gilles — Bruxelles",
  /** Firma dell’email di conferma ordine (per lingua). */
  firma: {
    fr: "À très bientôt,<br>La famille de La Molisana",
    en: "See you soon,<br>The La Molisana family",
  },
  /** Social usati SOLO se il DB non risponde (i veri URL sono link_* in app_config). */
  socialFallback: {
    facebook: "https://www.facebook.com/pizzerialamolisana",
    instagram: "https://www.instagram.com/pizzeria.lamolisana/",
  } as Record<string, string>,
};

/** Identità del prodotto (footer admin). NON cambia da cliente a cliente. */
export const PRODOTTO = {
  nome: "MOODD Admin",
  versione: "v2.1",
  copyright: "©2026 - All rights reserved MOODD",
};
