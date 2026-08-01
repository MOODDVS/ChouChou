# ChouChou — Avanzamento

Sito pubblico. Astro SSR. Brand: navy #353c4e / magenta #ed2289 / avorio #f7f4ee.
Font: Quicksand (titoli/link), Lato (testi), Birthstone (corsivo d'enfasi).

## Fatto
- Tipografia: sistema a 3 font + purge dei font legacy (Bebas/Marcellus/Nunito/Kaushan). scrollbar-gutter stable.
- Header: rimosso lo sfondo allo scroll.
- Footer: rifatto in stile "Ballena" — fondo navy, wordmark "ChouChou" gigante animato (full-width, mai tagliato), foto Yasmina, voce di nav attiva, contenitore 1440 allineato all'header, foto sopra il testo in mobile.
- Newsletter: form del footer collegato a /api/newsletter-subscribe (aggiunge il cliente in opt-in + toglie dagli optout), checkbox consenso, email di benvenuto brandata (logo + social + disiscrizione) e notifica semplice al ristoratore (Resend).
- Nav mobile: barra a pillola bianca con "Réserver" + burger in cerchio magenta; pannello ridisegnato bianco/navy, logo ridotto, font ChouChou, telefono preso dall'admin.
- Asset: public/logo-email.png, public/yasmina-koeune-chouchou.webp.

## Da fare
- Hero: foto di sfondo reale (ora è un gradiente segnaposto).
- Sezioni sotto l'hero (carte, ambiance, ecc.).
- Impostare CLIENT.nome = "Comptoir ChouChou" in src/config/client.ts (le email usano ancora il nome fallback).
- Pagina "conditions/CGV" per il link del consenso newsletter (ora punta a /privacy).
- Pagine standalone (annullamento ordine/prenotazione, embed): font ok, ma colori ancora vecchio tema scuro/oro → rebrand.
- Riportare le modifiche generiche anche nel motore MOODD-Admin.

## Workflow
Due Mac (MacBook + Mac Mini). Sempre `git pull origin main` prima, `git push origin main` dopo. Il .env non è su git: copiarlo a mano.