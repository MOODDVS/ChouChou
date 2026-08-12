/**
 * CONFIG CLIENTE — RestoHub engine.
 * Questo è l’UNICO file da modificare per rebrandizzare l’admin su un
 * nuovo cliente (insieme agli asset in /public: loghi, icone, manifest.json).
 * Vedi SETUP.md per la checklist completa del nuovo cliente.
 *
 * I dati "vivi" (telefono, email, indirizzo) possono essere sovrascritti
 * dal cliente in Admin → Général (app_config): i valori qui sotto sono
 * i FALLBACK usati quando app_config è vuoto o irraggiungibile.
 */
export const CLIENT = {
  /** Nome commerciale: title delle pagine admin, email, prodotti Stripe. */
  nome: "Nouveau Restaurant",
  /** Claim mostrato sotto il logo nelle email ("NOME — CLAIM"). */
  claim: "Restaurant",
  /** Logo quadrato (header admin). */
  logoAdmin: "/icon-192.png",
  /** Logo esteso (pagina login admin). */
  logoLogin: "/icon-192.png",
  /** Pagina condizioni/privacy linkata dal widget di prenotazione
   *  (per lingua; le lingue non elencate usano "en", poi "fr"). */
  privacyUrl: { fr: "/privacy", en: "/en/privacy" } as Record<string, string>,
  /** Paese del ristorante (ISO): default dei prefissi telefonici. */
  paese: "BE",
  /** Fallback de Admin → Général. */
  telefono: "+32 000 00 00 00",
  email: "contact@example.com",
  indirizzo: "Rue à compléter 1, 0000 Ville",
  /** Firma dell’email di conferma ordine (per lingua). */
  firma: {
    fr: "À très bientôt,<br>Toute l’équipe",
    en: "See you soon,<br>The whole team",
  },
  /** Social usati SOLO se il DB non risponde (i veri URL sono link_* in app_config). */
  socialFallback: {} as Record<string, string>,
};

/** Identità del prodotto (footer admin). NON cambia da cliente a cliente. */
export const PRODOTTO = {
  nome: "RestoHub",
  versione: "v3.0",
  copyright: "©2026 - All rights reserved MOODD",
};
