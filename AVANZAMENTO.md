# Chouchou — Avanzamento

Sito pubblico. Astro SSR. Brand: navy #353c4e / magenta #ed2289 / avorio #f7f4ee.
Font: Quicksand (titoli/link), Lato (testi), Birthstone (corsivo d'enfasi).

## Fatto
- Tipografia: sistema a 3 font + purge dei font legacy (Bebas/Marcellus/Nunito/Kaushan). scrollbar-gutter stable.
- Header: rimosso lo sfondo allo scroll.
- Footer: rifatto in stile "Ballena" — fondo navy, wordmark "Chouchou" gigante animato (full-width, mai tagliato), foto Yasmina, voce di nav attiva, contenitore 1440 allineato all'header, foto sopra il testo in mobile.
- Newsletter: form del footer collegato a /api/newsletter-subscribe (aggiunge il cliente in opt-in + toglie dagli optout), checkbox consenso, email di benvenuto brandata (logo + social + disiscrizione) e notifica semplice al ristoratore (Resend).
- Nav mobile: barra a pillola bianca con "Réserver" + burger in cerchio magenta; pannello ridisegnato bianco/navy, logo ridotto, font Chouchou, telefono preso dall'admin.
- Asset: public/logo-email.png, public/yasmina-koeune-chouchou.webp.
- **Hero home (index.astro): rifatta.** Carousel immagini collegato all'admin (Assets > Site, slot site_hero_1/2/3) con dissolvenza incrociata + zoom leggero (Ken Burns) e puntini di navigazione; base a gradiente navy + halo magenta quando non ci sono ancora foto (degrada in modo pulito, mai "rotto"). Testo: kicker "Restaurant & épicerie à Mont-Saint-Guibert", titolo "Comptoir" (Birthstone magenta) + "Chouchou" (grande), sottotitolo in grassetto su cucina creativa/fait maison/produttori locali, e 3 chip: L'épicerie, Un soir un Chef, Le brunch du dimanche. CTA Réserver (magenta) + Découvrir la carte. NB: regola di copy — mai il trattino lungo «—», sempre virgole.
- **Pagine Carte (/menu) e Contact rifatte in stile Chouchou** (fr): tolto il tricolore italiano, hero navy + halo magenta + script "Comptoir", colori oro→magenta e fondo navy via wrapper `.chou` (override di --c-bg/--c-accent), testi senza "italien/Saint-Gilles/—". La Carte prende i piatti dal DB (già ok). Contact ora legge telefono/email/indirizzo/mappa dall'admin via `datiRistorante()` (come il footer), non più gli hardcoded La Molisana.
- **Sezione foto ristorante a tutto schermo** (`src/components/PhotoResto.astro`) sotto Découvrir: `public/chouchou-restaurant.webp` in cover 100vh, con gradiente avorio→trasparente sulla metà alta per fondere il bordo superiore nella sezione avorio (nessuna linea visibile).
- **Sezione Agenda home** (`src/components/AgendaHome.astro`, fondo bianco): grande scritta "L'agenda / les rendez-vous" (Quicksand + Birthstone magenta) che scorre da sx a dx (marquee, 180s) e SBORDA in alto sulla foto sopra (margin-top negativo). Sotto, 2 blocchi eventi chiari senza riquadro (Un soir un Chef, Brunch du dimanche) → /agenda. Foto eventi dall'admin (slot `site_event_1/2`, gruppo "Section Agenda"), ripiego chiaro.
- **Sezione claim** (`src/components/Tagline.astro`, fondo bianco): grande testo centrato "Pour tous ceux / qui ont faim / de bons moments" (Quicksand navy + Birthstone magenta), reveal all'entrata.
- **Galleria 3 colonne parallax** (`src/components/GalerieScroll.astro`, fondo bianco): al scroll col.1 sale, col.2 scende, col.3 sale (JS + requestAnimationFrame, disattivato con reduced-motion). Foto dagli slot "Galerie" esistenti (site_gallery_1..10), ripiego chiaro.
- **Ordine home** (`src/pages/index.astro`): Hero → Intro → Decouvrir → PhotoResto → AgendaHome → Tagline → GalerieScroll → (Footer).
- **Sezione "Découvrir" sotto l'Intro** (`src/components/Decouvrir.astro`, Piste A): griglia editoriale di 4 CTA (La Carte bloc navy con striscia foto → /menu; L'Agenda e Contact carte bordate → /agenda, /contact; colonna destra foto + L'Épicerie → /epicerie). Foto dall'admin (nuovi slot `site_disc_1/2/3`, `site_disc_epicerie` in siteImageSlots.ts, gruppo "Section Découvrir"); ripiego navy se assenti. Contenitore 1440, reveal all'entrata.
- **Sezione "Introduction" sotto l'hero** (`src/components/Intro.astro`, Piste A "Définition"): fondo avorio, "Chouchou = Chéri" (Quicksand, "=" magenta) + corsivo Birthstone, disegno a tratto di un "chou", colonna destra con testo + bottone magenta → Carte (/menu). Contenitore 1440px, senza "Préambule". Da rifinire insieme (testo/disegno/impaginazione).
- **Datepicker nel modale**: il modale ora espande l'iframe quando il calendario si apre (osservatore DOM), e il widget al resize RIPOSIZIONA il datepicker invece di chiuderlo (prima `window.resize → dpChiudi`, ora `dpPosiziona`). ⚠️ Modifica generica del widget = da riportare nel motore MOODD-Admin.
- **Popup "Réserver" (ReservationModal + ReservationWidget) rebrandizzato Chouchou**: colori oro→magenta e fondo marrone→navy (tutti valori hardcoded rimappati nel widget), logo del modale da La Molisana → `chouchou-blanc.svg` (senza filtro), fondo embed navy. Il claim del widget mostra ora "COMPTOIR CHOUCHOU".
- **`CLIENT.nome` = "Comptoir Chouchou"** in `src/config/client.ts` (prima "Nouveau Restaurant"): sistema anche email, title admin, prodotti Stripe, e il claim del widget.
- **Link "Commander" nascosti per ora** in Header, MobileNav, Footer e hero della Carte (la pagina /order resta, solo gli ingressi sono tolti; nell'hero della Carte c'è ora un bottone "Réserver une table"). Footer allineato alle 5 voci del menu.
- **Menu di navigazione: 5 voci** (Header.astro + MobileNav.astro): Accueil (/), Carte (→ resta /menu), Épicerie (/epicerie), Agenda (/agenda), Contact (/contact). Tolte "Notre carte"/"L'Ambiance". Create pagine segnaposto brandate (navy + script) per /epicerie e /agenda in fr + en, per evitare 404.

### Sessione Carte + Contact (agosto 2026)
- **Header auto-hide** (Header.astro): scrollando in basso l'header scivola su e sparisce, scrollando in su ricompare (translateY, transizione 0.35s, requestAnimationFrame + soglia). Sempre visibile nei primi 80px. Rispetta reduced-motion. Vale sia sull'header opaco sia su quello trasparente.
- **Carte (/menu) — impaginazione editoriale**: corpo bianco, categorie in griglia a 3 colonne (`.carte__cols`, columns:3, break-inside:avoid) allineata sul gabarit 1440px + 28px come header/le lunch/à la carte. Titolo categoria semplice (Quicksand maiuscolo + riga magenta). A 1024px → 2 col, a 620px → 1 col.
- **Titoli giganti** "le lunch" (magenta, sx) e "à la carte" (navy, dx) in Birthstone, stessa dimensione, sovrapposti alle sezioni sopra (margin negativo, flow-root). Mobile: 25vw. Sezione Lunch a 3 colonne (Entrée/Plat/Dessert) con pillole prezzo combo della stessa larghezza a cavallo della linea (linea nascosta su mobile).
- **Verdure "à la carte"** (public/SVG/veg-4..7.svg): tinte in navy #565f7a via -webkit-mask (come Intro), animazione "sway" leggera, poste a sx del titolo; su mobile centrate sopra il titolo.
- **Sezione Brunch full-width** (fondo foto + sfumatura bianca in alto come PhotoResto + velo scuro): titolo script "le brunch", testo "Un dimanche Chouchou : …" (chapeau bianco bold), bottone Réserver magenta ad angoli dritti (data-reserver). Immagine dallo slot admin `site_brunch`.
- **Sezione "les boissons"**: titolone Birthstone magenta (come le lunch) + griglia bibite identica al cibo.
- **Cibo vs bibite**: à la carte mostra SOLO il cibo; le bibite vanno sotto "les boissons". Riconoscimento delle categorie bevanda per NOME (isBevandaCat: apéritifs, boissons, vins, cocktails, softs, bières, eaux, cafés, sans alcool…), non più per category_order.
- **Convenzione admin per i sotto-titoli**: una voce col Nom che inizia con "-" (es. `-Bulles`, Description EN `Sparkling`) diventa un sotto-titolo di sezione (magenta, senza linea), non un piatto. Prezzo nascosto quando è 0. ♥ "coup de cœur" al posto della ★ (toggle best-seller).
- **Allergeni**: su desktop tutti su una riga (nowrap); a capo sotto i 1024px. Tolta la riga badge (★/vegan/épicé/Suggestion) dalla legenda.
- **Contact**: hero alto come la Carte + tolto script "Comptoir"; sezione info+form ora bianca con testi navy (wrapper `.ct-body`, input e bottone adattati); indirizzo su due righe (via / CP+ville); chiusure su una sola riga ("fermé le lundi, samedi et dimanche"); nota form con link "réserver en ligne" (data-reserver); bottone ENVOYER magenta e sempre cliccabile (validazione nativa; era disabilitato senza consenso).
- **Mappa immagini admin** (siteImageSlots.ts): riscritti gli slot di Accueil e Menu per rispecchiare le sezioni reali (tolti i residui La Molisana: Story, Molise, Cartes finales, Atouts, gallery 10-15). PhotoResto ora collegata allo slot `site_resto_photo`; aggiunto `site_brunch`. Ambiance/Contact/Commander invariati.

## Da fare
- Hero: caricare le foto reali dall'admin (Réglages/Assets > Site > gruppo "Hero (diaporama)"). Finché non ci sono, resta lo sfondo navy.
- Sezioni sotto l'hero: histoire (2021→apertura 15/10/2023), cucina creativa/fait maison, épicerie, "Un soir, un Chef", brunch dominical, nos producteurs (lista fornitori), presse & reconnaissances (Gault&Millau, Collège Culinaire, Eurotoques, Edenred Best Lunch…), carte finali.
- Contenuto vero pagine Épicerie e Agenda (ora sono segnaposto "arrive bientôt", fr + en).
- Riattivare i link "Commander" quando il flusso ordini sarà pronto (Header, MobileNav, Footer, hero Carte: cercare "Commander masqué pour le moment").
- Pagina "conditions/CGV" per il link del consenso newsletter (ora punta a /privacy).
- Versioni EN di Carte e Contact (`src/pages/en/menu.astro`, `src/pages/en/contact.astro`): sono copie separate, ANCORA brandizzate La Molisana → applicare lo stesso rebrand fatto in fr.
- Pagine standalone (annullamento ordine/prenotazione, embed): font ok, ma colori ancora vecchio tema scuro/oro → rebrand.
- Layout.astro: i default globali (:root --c-bg #231f20 / --c-accent #dfab4e) sono ancora il tema scuro/oro legacy → allineare al brand Chouchou (renderebbe superfluo il wrapper .chou per-pagina).
- Riportare le modifiche generiche anche nel motore MOODD-Admin.

## Workflow
Due Mac (MacBook + Mac Mini). Sempre `git pull origin main` prima, `git push origin main` dopo. Il .env non è su git: copiarlo a mano.
Nota: su questo Mac il remote `engine` (MOODD-Admin) non è configurato (solo `origin`). Il `node_modules` è installato per macOS.
