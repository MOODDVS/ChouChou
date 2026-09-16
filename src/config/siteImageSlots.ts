// =====================================================================
// FILE PER-CLIENTE — mappa delle immagini del SITO PUBBLICO di questo cliente.
// Va adattato per OGNI cliente (come src/config/client.ts e le pagine vetrina):
// pagine, gruppi, chiavi e fallback cambiano insieme al sito.
// Il MECCANISMO che la usa (lib/siteImages, /api/admin/site-images, tab
// Assets > Site) e' generico nel motore e funziona con QUALSIASI lista qui sotto.
// Al merge di un cliente: TENERE la versione del cliente.
// =====================================================================

export interface SiteImageSlot {
  page: string;
  group: string;
  key: string;
  label: string;
  fallback: string;
}

// Slot immagine del sito pubblico gestiti dall'admin (tab Assets > Site).
// Ordine delle pagine nel filtro.
export const SITE_PAGES: string[] = ["Accueil"];

// ⚠️ Nel motore questa lista e' un DEFAULT NEUTRO: gli slot che quasi ogni
// sito di ristorante ha (diaporama, una foto di presentazione, una galleria,
// un paio di sfondi). Il cliente la riscrive col suo sito.
//
// Fino al 16/09/2026 erano gli slot del sito di un cliente vero, con dei
// `fallback` che puntavano a sue fotografie mai state in questo repo:
// l'admin offriva slot che nessuna pagina leggeva e mostrava anteprime rotte.
// Una mappa sbagliata e' peggio di nessuna mappa.
//
// I fallback ora sono le immagini neutre di `/public/restohub/`, che esistono
// davvero. Vuoto = nessun ripiego: meglio niente che un'anteprima rotta.
export const SITE_IMAGE_SLOTS: SiteImageSlot[] = [
  { page: "Accueil", group: "Hero (diaporama)", key: "site_hero_1", label: "Image 1", fallback: "/restohub/slide01.webp" },
  { page: "Accueil", group: "Hero (diaporama)", key: "site_hero_2", label: "Image 2", fallback: "/restohub/slide02.webp" },
  { page: "Accueil", group: "Hero (diaporama)", key: "site_hero_3", label: "Image 3", fallback: "/restohub/slide03.webp" },
  { page: "Accueil", group: "Section Accueil", key: "site_story", label: "Photo", fallback: "/restohub/slide04.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_1", label: "Photo 1", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_2", label: "Photo 2", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_3", label: "Photo 3", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_4", label: "Photo 4", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_5", label: "Photo 5", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_6", label: "Photo 6", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_7", label: "Photo 7", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_8", label: "Photo 8", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_9", label: "Photo 9", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_10", label: "Photo 10", fallback: "" },
  { page: "Accueil", group: "Banniere", key: "site_ambiance_hero", label: "Image", fallback: "/restohub/slide02.webp" },
  { page: "Accueil", group: "Section Les menus", key: "site_menu_hero", label: "Fond", fallback: "/restohub/slide03.webp" },
];

export const SITE_IMAGE_KEYS: string[] = SITE_IMAGE_SLOTS.map((s) => s.key);
