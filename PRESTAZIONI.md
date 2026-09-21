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

---

## 2. Le immagini — il mattone c'e', le immagini stanno nei clienti

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

**Come si trovano le immagini da sistemare, in un cliente:**

```bash
grep -rn '<img' src --include='*.astro' | grep -v width=
```

---

## 3. La cache degli asset statici — NON si puo' fare nel motore

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

## 4. Quello che NON abbiamo fatto, e perche'

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

## 5. L'ordine in cui conviene farlo, su un sito cliente

1. I font (punto 1) — e' il pezzo piu' grosso dell'LCP.
2. L'immagine principale in cima alla home: `<Immagine … primaria />`.
3. Le altre immagini, con le dimensioni (punto 2).
4. La cache degli asset sull'hosting (punto 3).

Poi si misura, non prima: PageSpeed su mobile, e si guarda LCP e CLS.
