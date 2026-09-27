# Prestazioni — la ricetta per i siti dei clienti

Il motore e' l'admin e le API: **non ha un sito**. Il sito ce l'ha il cliente,
e quindi PageSpeed misura le **sue** pagine. Questo file dice cosa il motore
gli da' gia' fatto, e cosa va applicato a mano in ogni installazione.

Scritto il 21/09/2026, dopo una misura vera sui cinque clienti.

---

## 1. I font — FATTO nel motore, da riportare nei clienti

Le famiglie si dichiarano in `astro.config.mjs` e Astro le scarica in build,
le serve dal dominio del cliente e genera i ripieghi metrici (che e' cio' che
toglie il salto del testo quando il font arriva).

⚠️ **`astro.config.mjs` e' `merge=ours`: il merge NON lo porta.** In ogni
cliente va aggiunto a mano il blocco `fonts: [...]`, con **le famiglie di quel
cliente**, e l'import `fontProviders`:

```js
import { defineConfig, fontProviders } from "astro/config";
// ...
fonts: [
  { provider: fontProviders.google(), name: "Nome Famiglia",
    cssVariable: "--font-body", weights: [400, 700],
    styles: ["normal"], subsets: ["latin", "latin-ext"], display: "swap" },
],
```

Poi, nel `<head>` del layout del cliente, al posto dei `<link>` a
fonts.googleapis.com:

```astro
import Fonts from "../components/Fonts.astro";
<Fonts />
```

**Come si verifica:** `npm run build`, poi DevTools → Network, filtro `font`.
Non deve comparire nulla da `fonts.gstatic.com`.

⚠️ `preload` solo sui font del primo schermo. Un precaricamento di troppo ruba
banda al vero LCP, e il browser lo scrive in console.

### ⚠️ Il nome della famiglia non si scrive piu' a mano

Astro NON registra la famiglia col suo nome: la registra con un nome **con
hash** — `Quicksand-062645fc554f8359` — e l'unico modo per arrivarci e' la
variabile dichiarata in `cssVariable`.

```css
font-family: "Quicksand", system-ui, sans-serif;  /* ❌ nessun @font-face: font di sistema */
font-family: var(--font-title);                   /* ✅ */
```

Vale anche per le RIDICHIARAZIONI: `:root { --font-title: "Quicksand", … }`
dentro lo `<style>` di una pagina vince su quella iniettata da Astro e spegne
il font su tutta la pagina.

**E' successo davvero**, il 21/09/2026: dopo il passaggio ai font locali,
diciannove pagine del pannello ridichiaravano `--font-title` e `--font-body`
col nome letterale. Tutti i titoli hanno smesso di essere in grassetto.
`npm test`, `astro check` e `npm run build` erano **tutti verdi**: se n'e'
accorto il cliente, a occhio. Adesso lo tengono tre prove in
`tests/prestazioni.test.mjs`.

Le prove guardano solo i file **agganciati** al sistema (quelli con `<Fonts>`,
`AdminHead` o un `var(--font-…)`): una pagina pubblica del cliente ancora coi
`<link>` di Google e i nomi a mano e' coerente con se stessa e resta verde. Il
guasto e' mescolare le due cose nello stesso file.

⚠️ Fuori dal controllo: `src/pages/demo01/_page.html` e' HTML grezzo servito
da `index.ts`, non passa da Astro e quindi chiede ancora i font a Google. E'
la pagina della demo, che i clienti cancellano.

### ⚠️ I pesi: copiare quelli che il cliente chiedeva, non «quelli giusti»

Quando il peso chiesto dal CSS non esiste, il browser **non rinuncia**: prende
la faccia piu' vicina. Quindi l'elenco dei `weights` decide la resa piu' del
CSS.

Le pagine del pannello chiedevano `Quicksand:wght@700` — **una faccia sola**.
Ogni `font-weight: 500` e `600` scritto nel CSS ricadeva sul 700, e i titoli
erano in grassetto per questo. Dichiarando 500/600/700 «per completezza»,
ognuna di quelle regole ha trovato la sua faccia e **tutti i titoli del
pannello si sono smagriti**, senza che il CSS cambiasse di una virgola.

Stessa cosa con Nunito Sans: le 39 regole `font-weight: 800` finivano sul 900,
perche' l'800 non era mai stato scaricato.

**Regola per ogni cliente:** leggere i `<link>` che si stanno togliendo e
copiare *esattamente* quei pesi in `weights`. Se un elenco sembra incompleto,
lo e' di proposito — allargarlo e' un cambio di resa su tutto il sito, e va
guardato a occhio prima.

---

## 2. SEO tecnico — FATTO nel motore, due righe da riportare

**Il guasto:** `sitemap()` era senza filtro, e una sitemap comprende ogni
pagina che il progetto sa costruire. Risultato: **15 URL `/admin/` su 29**.
Ogni cliente diceva a Google «indicizza il mio pannello», e quegli URL
rispondono 302 al login — in Search Console diventano errori «Pagina con
reindirizzamento». Su 5 clienti, 4 non avevano nemmeno `Disallow: /admin`.

Le regole ora stanno in `src/lib/seo/sitemapRegole.ts`, che **il merge porta**.
Quello che il merge NON porta sono le due righe che le agganciano:

**a) `astro.config.mjs`** (`merge=ours`):

```js
import { inSitemap } from "./src/lib/seo/sitemapRegole";
// ...
integrations: [react(), sitemap({ filter: inSitemap })],
```

**b) `public/robots.txt`** (`public/**` e' `merge=ours`):

```
Disallow: /admin
Disallow: /reservation-embed
Disallow: /reservation-test
```

(Piu' `Disallow: /demo01` se il cliente tiene il template dimostrativo. Il
filtro in `sitemapRegole.ts` NON lo nomina di proposito: il motore non decide
in base al nome di un demo, e c'e' una prova che lo impedisce.)

⚠️ **Le lingue.** Il filtro della sitemap guarda l'ULTIMO pezzo del percorso,
quindi `order-confirm` e `order-cancel` restano fuori in qualunque lingua —
`/it/`, `/nl/`, `/es/` compresi — senza che il motore sappia quali lingue hai.
In `robots.txt` no: li' i prefissi vanno scritti a mano, uno per lingua del
sito. Se il cliente ha `/it/` e `/nl/`, servono anche quelle righe.

⚠️ **Non allargare i prefissi.** `/order/cancel` e `/reservation/cancel` stanno
fuori dalla sitemap, ma `Disallow: /order` spegnerebbe la pagina d'ordine e
`Disallow: /reservation` quella delle prenotazioni: in robots.txt un prefisso
non ha confini di parola. C'e' una prova che lo controlla.

Controlla anche che `site:` in `astro.config.mjs` e la riga `Sitemap:` di
`robots.txt` puntino allo **stesso** dominio del cliente.

**Come si verifica:** `npm run build`, poi
`grep -c admin build/client/sitemap-0.xml` deve dare `0`.

---

## 3. Le immagini — il mattone c'e', le immagini stanno nei clienti

Misurato il 21/09/2026: **125 immagini nei cinque siti, 28 con le dimensioni.**
Le altre 97 fanno saltare la pagina quando atterrano. E' il CLS, uno dei tre
Core Web Vitals, e non si vede sul Mac dello sviluppatore — dove l'immagine e'
in cache e arriva subito — ma si vede al cliente in 4G.

Usa `src/components/Immagine.astro`. **Senza dimensioni non compila**, ed e'
il punto: la cura e' banale, e per questo si dimentica.

```astro
<Immagine src="/img/sala.webp" alt="La sala" width={1200} height={800} />
<Immagine src="/img/hero.webp" alt="" width={1600} height={900} primaria />
<Immagine src={urlDaSupabase} alt="" rapporto="16/9" />
```

- `width`/`height` sono le dimensioni **vere del file**, non quelle a schermo:
  servono a calcolare la forma, il CSS poi ridimensiona.
- `primaria` va su **UNA** immagine per pagina, quella che si vede per prima.
  Non la rimanda e le da' la precedenza. Su due si annulla: se tutto e'
  prioritario, niente lo e'.
- `rapporto` e' per le immagini che arrivano da internet, di cui non si
  conoscono le dimensioni.

### ⚠️ `width`/`height` sul tag spengono l'`aspect-ratio` del CSS

Trovato su La Molisana il 26/09/2026, col sito aperto davanti — e solo dopo
aver sbagliato tre volte ragionandoci sopra.

`width` e `height` scritti come attributi sono *presentational hints*: valgono
come CSS a specificità zero, ma sono **dimensioni definite**. Dove la regola dice
`width: 100%` e si affida all'`aspect-ratio` per l'altezza, l'attributo `height`
resta in piedi — due dimensioni definite — e allora il browser **ignora
l'aspect-ratio**. L'immagine esce con la forma sbagliata, e il CSS che la governa
non è cambiato di una riga: è cambiato quello che il browser aveva in mano.

La cura è una parola:

```css
.feat-thumbs img { width: 100%; aspect-ratio: 3 / 2; height: auto; }
```

`height: auto` rimette **una sola** dimensione definita, e l'aspect-ratio torna a
comandare. ⚠️ Vale anche al rovescio: se stai aggiungendo le dimensioni a un
`<img>` la cui regola ha un `aspect-ratio`, quella regola va guardata **prima**,
o il lavoro peggiora la pagina invece di migliorarla.

### ⚠️ Quando il posto lo riserva già il CSS: `data-posto`

Su ChouChou la rete segnalava 33 immagini e **24 erano corrette**: i sei hero
hanno `min-height: clamp(400px, 56vh, 600px)`, `.ag-card__media` ha
`aspect-ratio: 4 / 3`, `.cover-badges img` ha `height: 11mm`. Lo spazio era già
riservato — dal contenitore, non dal tag — e la rete legge il testo del tag,
quindi non poteva vederlo. In tre casi obbedire avrebbe **rotto** la pagina, per
il motivo del paragrafo qui sopra.

Quindi il motivo si scrive sul tag, e la rete lo accetta. Tre valori, non uno di
piu':

```
data-posto="css"        altezza o aspect-ratio nel foglio di stile
data-posto="overlay"    lightbox, modale: l'immagine non e' nel flusso
data-posto="naturale"   galleria che non ritaglia: l'altezza la decide la foto
```

⚠️ **`css` si scrive dopo aver guardato la regola**, non per far passare la
prova — e in quel caso una dimensione vera è sempre meglio del segno. Un valore
scritto male non zittisce niente: c'è una seconda prova che verifica che i valori
dichiarati esistano. E il segno sta sul tag, non in un elenco dentro il file di
prova: quel file è del motore, e il merge lo riscrive nei repo dei clienti.

**Come si trovano le immagini da sistemare, in un cliente:**

```bash
grep -rn '<img' src --include='*.astro' | grep -v width=
```

---

## 4. La cache degli asset statici — NON si puo' fare nel motore

Va detto chiaro perche' e' la voce che PageSpeed segnala piu' spesso
(«Serve static assets with an efficient cache policy»).

- I file sotto `_astro/` (JS, CSS, **font**) hanno gia' `max-age=31536000,
  immutable`: lo mette l'adattatore Node, e hanno l'hash nel nome.
- I file in `public/` (`/img/…`, `/sounds/…`, le favicon) **non hanno nessuna
  intestazione di cache**. E non si puo' rimediare dal middleware Astro:
  l'adattatore Node li serve **prima** che il middleware veda la richiesta.

⚠️ Quindi e' configurazione dell'**hosting**, non del motore. Su Hostinger si
mette nel reverse proxy / `.htaccess` davanti a Node:

```
<FilesMatch "\.(webp|avif|jpg|jpeg|png|svg|woff2|mp3)$">
  Header set Cache-Control "public, max-age=2592000"
</FilesMatch>
```

30 giorni, non un anno: questi file **non** hanno l'hash nel nome, quindi
sostituirne uno con lo stesso nome deve poter arrivare al visitatore.

---

## 5. Quello che NON abbiamo fatto, e perche'

- **Togliere React.** `ContactForm.tsx` non lo usa nessuna pagina, quindi
  react e react-dom entrano nella build e non vengono mai serviti a un
  visitatore. E' peso di build, non peso a runtime: non cambia il punteggio
  PageSpeed di nessun cliente. Vale la pena toglierlo, ma per altre ragioni.
- **`astro:assets` / `<Image>` di Astro.** Converte in WebP/AVIF e genera le
  varianti, ma con `output: "server"` lo fa **a ogni richiesta**, a carico
  della CPU del server. Su un VPS Hostinger condiviso peggiora il TTFB, che e'
  l'altra meta' del punteggio. Se le immagini dei clienti sono gia' WebP — e
  lo sono — il guadagno non vale lo scambio.
- **`Cache-Control` sulle pagine pubbliche.** Senza una CDN davanti,
  `s-maxage` non lo legge nessuno; e far cacheare al browser una pagina che
  mostra «cucina chiusa» e gli orari e' il modo di far vedere a un cliente uno
  stato vecchio. Se un giorno ci sara' una CDN, si riapre il discorso.

---

## 6. L'ordine in cui conviene farlo, su un sito cliente

1. I font (punto 1) — e' il pezzo piu' grosso dell'LCP.
2. Il filtro sitemap e robots.txt (punto 2) — due righe, e finche' mancano il
   cliente sta consegnando il pannello a Google.
3. L'immagine principale in cima alla home: `<Immagine … primaria />`.
4. Le altre immagini, con le dimensioni (punto 3).
5. La cache degli asset sull'hosting (punto 4).

Poi si misura, non prima: PageSpeed su mobile, e si guarda LCP e CLS. Per il
SEO, Search Console: le pagine escluse come «Pagina con reindirizzamento»
devono scendere a zero nelle settimane dopo.
