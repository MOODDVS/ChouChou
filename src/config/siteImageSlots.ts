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
export const SITE_PAGES: string[] = ["Accueil", "Carte", "Épicerie", "Agenda", "Contact"];

export const SITE_IMAGE_SLOTS: SiteImageSlot[] = [
  // ---------- ACCUEIL ----------
  { page: "Accueil", group: "Hero (diaporama)", key: "site_hero_1", label: "Image 1", fallback: "/chouchou-restaurant.webp" },
  { page: "Accueil", group: "Hero (diaporama)", key: "site_hero_2", label: "Image 2", fallback: "" },
  { page: "Accueil", group: "Hero (diaporama)", key: "site_hero_3", label: "Image 3", fallback: "" },
  { page: "Accueil", group: "Section Découvrir", key: "site_disc_1", label: "Carte, photo 1", fallback: "" },
  { page: "Accueil", group: "Section Découvrir", key: "site_disc_2", label: "Carte, photo 2", fallback: "" },
  { page: "Accueil", group: "Section Découvrir", key: "site_disc_3", label: "Carte, photo 3", fallback: "" },
  { page: "Accueil", group: "Photo restaurant", key: "site_resto_photo", label: "Photo plein largeur", fallback: "/chouchou-restaurant.webp" },
  { page: "Accueil", group: "Section Agenda", key: "site_event_1", label: "Événement, photo 1", fallback: "" },
  { page: "Accueil", group: "Section Agenda", key: "site_event_2", label: "Événement, photo 2", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_1", label: "Photo 1", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_2", label: "Photo 2", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_3", label: "Photo 3", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_4", label: "Photo 4", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_5", label: "Photo 5", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_6", label: "Photo 6", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_7", label: "Photo 7", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_8", label: "Photo 8", fallback: "" },
  { page: "Accueil", group: "Galerie", key: "site_gallery_9", label: "Photo 9", fallback: "" },
  // ---------- ÉPICERIE ----------
  { page: "Épicerie", group: "Hero", key: "site_epicerie_hero", label: "Image hero", fallback: "" },
  { page: "Épicerie", group: "Présentation", key: "site_disc_epicerie", label: "Photo présentation", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_1", label: "Produit 1", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_2", label: "Produit 2", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_3", label: "Produit 3", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_4", label: "Produit 4", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_5", label: "Produit 5", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_6", label: "Produit 6", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_7", label: "Produit 7", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_8", label: "Produit 8", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_9", label: "Produit 9", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_10", label: "Produit 10", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_11", label: "Produit 11", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_12", label: "Produit 12", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_13", label: "Produit 13", fallback: "" },
  { page: "Épicerie", group: "Galerie produits", key: "site_epicerie_14", label: "Produit 14", fallback: "" },
  // ---------- CARTE ----------
  { page: "Carte", group: "Hero", key: "site_menu_hero", label: "Image hero", fallback: "/chouchou-restaurant.webp" },
  { page: "Carte", group: "Un soir, un chef", key: "site_soir_chef", label: "Image plein largeur", fallback: "/chouchou-restaurant.webp" },
  { page: "Carte", group: "Brunch", key: "site_brunch", label: "Image plein largeur", fallback: "/chouchou-restaurant.webp" },
  // ---------- AGENDA ----------
  { page: "Agenda", group: "Hero", key: "site_agenda_hero", label: "Image hero", fallback: "/chouchou-restaurant.webp" },
  { page: "Agenda", group: "Bloc contact", key: "site_agenda_cta", label: "Image de fond", fallback: "/chouchou-restaurant.webp" },
  // ---------- CONTACT ----------
  { page: "Contact", group: "Hero", key: "site_contact_hero", label: "Image hero", fallback: "/chouchou-restaurant.webp" },
];

export const SITE_IMAGE_KEYS: string[] = SITE_IMAGE_SLOTS.map((s) => s.key);
