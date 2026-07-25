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
export const SITE_PAGES: string[] = ["Accueil", "Ambiance", "Menu", "Contact", "Commander"];

export const SITE_IMAGE_SLOTS: SiteImageSlot[] = [
  { page: "Accueil", group: "Hero (diaporama)", key: "site_hero_1", label: "Image 1", fallback: "/slideshow/slide-01.webp" },
  { page: "Accueil", group: "Hero (diaporama)", key: "site_hero_2", label: "Image 2", fallback: "/slideshow/slide-02.webp" },
  { page: "Accueil", group: "Hero (diaporama)", key: "site_hero_3", label: "Image 3", fallback: "/slideshow/slide-03.webp" },
  { page: "Accueil", group: "Section Story", key: "site_story", label: "Photo", fallback: "/la-molisana-home-foto-01.webp" },
  { page: "Accueil", group: "Section Molise", key: "site_molise", label: "Carte", fallback: "/la-molisana-regione.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_1", label: "Photo 1", fallback: "/slideshow/slide-01.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_2", label: "Photo 2", fallback: "/slideshow/slide-02.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_3", label: "Photo 3", fallback: "/slideshow/slide-03.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_4", label: "Photo 4", fallback: "/slideshow/slide-04.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_5", label: "Photo 5", fallback: "/slideshow/slide-05.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_6", label: "Photo 6", fallback: "/slideshow/slide-06.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_7", label: "Photo 7", fallback: "/slideshow/slide-07.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_8", label: "Photo 8", fallback: "/slideshow/slide-08.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_9", label: "Photo 9", fallback: "/slideshow/slide-09.webp" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_10", label: "Photo 10", fallback: "/slideshow/slide-10.webp" },
  { page: "Accueil", group: "Cartes finales", key: "site_cta_menu", label: "Menu", fallback: "/la-molisana-cta-menu.webp" },
  { page: "Accueil", group: "Cartes finales", key: "site_cta_ambiance", label: "Ambiance", fallback: "/la-molisana-cta-ambiance.webp" },
  { page: "Accueil", group: "Cartes finales", key: "site_cta_contact", label: "Contact", fallback: "/la-molisana-cta-contact.webp" },
  { page: "Accueil", group: "Atouts (vignettes)", key: "site_thumb_1", label: "Vignette 1", fallback: "/la-molisana-thumb-01.webp" },
  { page: "Accueil", group: "Atouts (vignettes)", key: "site_thumb_2", label: "Vignette 2", fallback: "/la-molisana-thumb-02.webp" },
  { page: "Accueil", group: "Atouts (vignettes)", key: "site_thumb_3", label: "Vignette 3", fallback: "/la-molisana-thumb-03.webp" },
  { page: "Accueil", group: "Atouts (vignettes)", key: "site_thumb_4", label: "Vignette 4", fallback: "/la-molisana-thumb-04.webp" },
  { page: "Ambiance", group: "Hero", key: "site_ambiance_hero", label: "Image hero", fallback: "/la-molisana-ambiance-hero.webp" },
  { page: "Ambiance", group: "Famille", key: "site_ambiance_famille", label: "Photo principale", fallback: "/ambiance/la-molisana-famille.webp" },
  { page: "Ambiance", group: "Famille", key: "site_ambiance_famille_1", label: "Vignette 1", fallback: "/ambiance/la-molisana-famille-01.webp" },
  { page: "Ambiance", group: "Famille", key: "site_ambiance_famille_2", label: "Vignette 2", fallback: "/ambiance/la-molisana-famille-02.webp" },
  { page: "Ambiance", group: "Famille", key: "site_ambiance_famille_3", label: "Vignette 3", fallback: "/ambiance/la-molisana-famille-03.webp" },
  { page: "Ambiance", group: "Famille", key: "site_ambiance_famille_4", label: "Vignette 4", fallback: "/ambiance/la-molisana-famille-04.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_01", label: "Photo 1", fallback: "/ambiance/ambiance-01.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_02", label: "Photo 2", fallback: "/ambiance/ambiance-02.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_03", label: "Photo 3", fallback: "/ambiance/ambiance-03.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_04", label: "Photo 4", fallback: "/ambiance/ambiance-04.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_05", label: "Photo 5", fallback: "/ambiance/ambiance-05.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_06", label: "Photo 6", fallback: "/ambiance/ambiance-06.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_07", label: "Photo 7", fallback: "/ambiance/ambiance-07.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_08", label: "Photo 8", fallback: "/ambiance/ambiance-08.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_09", label: "Photo 9", fallback: "/ambiance/ambiance-09.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_10", label: "Photo 10", fallback: "/ambiance/ambiance-10.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_11", label: "Photo 11", fallback: "/ambiance/ambiance-11.webp" },
  { page: "Ambiance", group: "Galerie", key: "site_ambiance_grid_12", label: "Photo 12", fallback: "/ambiance/ambiance-12.webp" },
  { page: "Menu", group: "Hero", key: "site_menu_hero", label: "Image hero", fallback: "/la-molisana-home-foto-01.webp" },
  { page: "Contact", group: "Hero", key: "site_contact_hero", label: "Image hero", fallback: "/la-molisana-home-foto-01.webp" },
  { page: "Commander", group: "Hero", key: "site_order_hero", label: "Image hero", fallback: "/slideshow/slide-02.webp" },
];

export const SITE_IMAGE_KEYS: string[] = SITE_IMAGE_SLOTS.map((s) => s.key);
