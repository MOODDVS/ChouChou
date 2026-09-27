# Portare un cliente da `main` al multi-sede

Scritto il 26/09/2026, subito dopo averlo fatto su **La Molisana** — il primo
cliente partito da `main`. Ogni passo qui sotto è successo davvero, e i tre
contrassegnati ⚠️ **NON SI INDOVINANO**: nessuno dei tre dà un errore che
spieghi cosa fare, e insieme costano circa un'ora a cliente se li scopri sul
momento.

Chi era già passato: **450 Gradi** (ma partiva da un sito riscritto, quindi non
ha incontrato i passi 4 e 6) e **La Molisana**.

---

## Prima di tutto: il merge NON accende il multi-sede

`locations` vuota = **sede unica** = il comportamento di sempre. La regola lo
dice a chiare lettere in `sedeRegole.ts`: *«VUOTO = nessun filtro, cioè il
comportamento di sempre»*. La colonna `location_id` nasce nullable e senza
default, quindi le righe che esistono restano a NULL, e per un cliente con un
punto solo NULL è la verità.

Quindi sono **due lavori separati**, e il secondo puoi non farlo mai:

- la **Fase A** qui sotto porta il cliente al motore e non cambia niente per il
  ristoratore;
- la **Fase B**, in fondo, crea la prima sede — e serve solo a chi ha più punti.

Il lato database di tutto il multi-sede è **una migrazione sola**, la #73
`locations.sql`, dichiarata «solo schema, nessun effetto visibile».

---

# FASE A — portare il cliente al motore

## 1. Il punto di ritorno

```
cd ~/Developer/NomeCliente
git status                       # deve essere pulito
git tag pre-multisede
git push origin pre-multisede
```

Il tag serve davvero, e non come rete di sicurezza generica: al **passo 4** si
ripescano i file da qui.

## 2. Il merge

```
git fetch engine
git merge engine/multi-sede      # o engine/main, quando il branch sarà stato fuso
```

Conflitti attesi, in due famiglie:

- **delete/modify su `demo01`** — nei clienti che l'hanno cancellato al clone
  (ChouChou, Educazione Napoletana). Si risolve con `git rm -r src/pages/demo01`.
- **modify/delete sui file del sito** — il motore ha cancellato **da sé** le sue
  pagine vetrina il 16/09/2026 («un motore che ha un sito non è un motore»), e
  quella cancellazione arriva al cliente. Su La Molisana erano
  `src/layouts/Layout.astro` e `src/pages/links.astro`. **Si tengono**: sono del
  cliente, il motore non ti sta dicendo di cancellarle.

```
git add src/layouts/Layout.astro src/pages/links.astro
git commit --no-edit
```

## 3. Se il cliente ha tenuto `demo01`, si toglie adesso

La Molisana e L'Huile lo tengono ancora. Tre reti del motore usano `demo01`
come marcatore per sapere se sono nel motore o in un cliente (vedi
`tests/ambiente.mjs`): finché c'è, girano anche qui e sono rosse. Il motore lo
dice in faccia, con il dominio del cliente nel messaggio.

```
git rm -r src/pages/demo01 src/components/demo01
git rm src/layouts/Demo01Layout.astro
```

Prima controlla che niente fuori da lì li importi:
`grep -rn "Demo01Layout\|components/demo01" src/ | grep -v "^src/pages/demo01/"`.

## 4. ⚠️ Il merge cancella i file del sito che il cliente non ha mai toccato

**Questo è il passo che non si indovina.** Su La Molisana si è portato via
**31 file**: tutte le pagine pubbliche fr ed en (`menu`, `contact`, `order`,
`reservation`, `privacy`, `jobs`, `ambiance`, `cookies`, `feedback`) e dieci
componenti (`Header`, `Footer`, `Hero`, `Story`, `Features`, `Molise`,
`PhotoStrip`, `CtaFinal`, `MobileNav`, `ReservationModal`).

Perché: **`merge=ours` protegge i file che il cliente ha MODIFICATO, non quelli
che non ha mai toccato.** Un file cancellato dal motore e intatto dal lato
cliente non è un conflitto: è un delete pulito, e git lo applica. `Layout.astro`
e `links.astro` hanno dato conflitto solo perché La Molisana li aveva modificati;
gli altri 31 sono spariti in silenzio. `.gitattributes` non può evitarlo.

Si vede solo con `npx astro check`, o — peggio — dal deploy.

```
git diff --diff-filter=D --name-only pre-multisede HEAD -- src public \
  | grep -v "^src/pages/admin/\|^src/pages/api/\|^src/components/admin/\|demo01\|Demo01" \
  | xargs git checkout pre-multisede --
```

Guarda l'elenco prima di eseguirlo. Il `grep -v` toglie l'admin (che deve venire
dal motore) e il demo (che hai appena cancellato apposta).

## 5. ⚠️ Senza il blocco `fonts:` il pannello NON SI APRE

`AdminHead` rende `<Fonts />`, che chiede ad Astro le famiglie dichiarate in
`astro.config.mjs`. Quel file è `merge=ours`: **il merge non lo porta**. Senza
il blocco, l'admin lancia `FontFamilyNotFound` e non si apre — né in locale né
in produzione. Non è un difetto estetico, è il pannello giù.

Copia in `astro.config.mjs` del cliente, **verbatim dal motore**, l'import e il
blocco:

```js
import { defineConfig, fontProviders } from "astro/config";
// ...
  fonts: [ /* le cinque famiglie del motore, coi pesi del motore */ ],
```

⚠️ **I pesi si copiano, non si migliorano.** `Quicksand: [700]` e
`Nunito Sans: [400, 600, 700, 900]` sembrano incompleti e non lo sono: il
perché sta nei commenti del motore e in `PRESTAZIONI.md` §1. C'è una prova che
li verifica.

Questo **non tocca il sito pubblico**: il layout del cliente ridichiara le sue
variabili nel proprio `:root` e tiene i suoi `<link>` a Google. Rimetterlo in
riga è `PRESTAZIONI.md` §1, ed è un lavoro a parte (vedi «Cosa resta fuori»).

## 6. ⚠️ Le pagine pubbliche devono dire di quale punto parlano

Col multi-sede quattro funzioni hanno preso un parametro `Ambito`, e le pagine
del cliente non lo passano. `astro check` le trova tutte («Expected 2 arguments,
but got 1»), quindi qui non si indovina niente — ma va fatto.

| era | adesso |
|---|---|
| `datiRistorante()` | `datiRistorante(ambito)` |
| `configGiornoEffettiva(ora)` | `configGiornoEffettiva(ora, ambito)` |
| `getMenu()` | `getMenu(ambito)` |
| `getMenuOrderable()` | `getMenuOrderable(ambito)` |

L'ambito si prende dalla richiesta:

```astro
import { ambitoPubblicoChiesto } from "../lib/admin/sede";
const ambito = await ambitoPubblicoChiesto(Astro.request);
```

⚠️ **Passalo, invece di scrivere `SEDE_UNICA` a mano.** Con una sede sola
rendono lo stesso identico valore, ma `SEDE_UNICA` scritto a mano è vero finché
il ristorante è uno — e il giorno che non lo fosse più non darebbe errore:
darebbe gli orari del posto sbagliato.

Poi ci sono tre cose che `astro check` **non** vede, e che trovano solo le prove:

- **`orders_closed` e `restaurant_name` letti nudi su `app_config`**: sono chiavi
  *di sede*. Si leggono con `appConfigEq(chiave, ambito)`, oppure — per il nome —
  con `datiRistorante(ambito).nome`, che ripiega da solo su `client.ts`.
  (`tests/config.test.mjs`)
- **`order-confirm` che legge `orders` nuda**: va letta con
  `leggi("orders", tutteLeSedi(), …)`. Chi torna dal pagamento non dice da quale
  punto ha ordinato, e l'id di sessione Stripe *è* l'autorizzazione: è unico e lo
  conosce solo chi ha pagato. Filtrare per sede darebbe una conferma bianca a chi
  ha appena pagato. Le due pagine `src/pages/order-confirm.astro` e
  `src/pages/en/order-confirm.astro` sono **già dichiarate** fra le eccezioni del
  motore. (`tests/sede.test.mjs`)
- **Non e' solo `src/pages`: guarda anche `src/lib/` del cliente.** Su ChouChou
  `src/lib/jsonLd.ts` chiamava `datiRistorante()` a mani vuote. Quello `astro
  check` lo trova; la cosa che non trova nessuno e' che **la sede va anche dentro
  la chiave della sua cache**, altrimenti la prima pagina di un punto riempie la
  cache e per un minuto tutte le altre servono i dati suoi.
  ```ts
  cacheOr(`seo:jsonld:${lang}:${ambito.modo === "sede" ? ambito.id : ambito.modo}`, …)
  ```
- ⚠️ **Le reti leggono anche i commenti.** Sono grep sul sorgente, non
  compilatori: `datiRistorante()` scritto dentro un commento e' rosso esattamente
  come se fosse codice, e lo stesso vale per un `<img>` messo li' come esempio.
  E' gia' successo tre volte. Quando una rete indica una riga che «non e'
  codice», riscrivi il commento — non allargare la regola.
- ⚠️ **Le eccezioni stanno nei file di prova, che sono del motore.** Il merge le
  riscrive: non aggiungerne nei repo cliente. Se una rete è rossa per una scelta
  legittima del sito, o si cambia il sito o si cambia la regola **sul motore**.

## 7. ⚠️ Il punto deve viaggiare con le chiamate del browser

`astro check` qui non vede niente: sono stringhe dentro un `fetch`. La rete e'
`tests/pubblico.test.mjs`.

I componenti pubblici sono `merge=ours`, quindi quelli del cliente sono fermi a
prima del multi-sede: chiamano `/api/…` senza dire di quale punto parlano. Il
motore non lo indovina piu' — ripiega sulla **prima** sede. Per un menu e'
un'informazione falsa; per `/api/checkout` e' un ordine che nasce nella cucina
sbagliata e si paga sulla cassa di un'altra societa'.

La regola (quale parametro, come si attacca) sta in un posto solo,
`src/lib/sedeUrl.ts`. Nel componente si lega soltanto alla propria sede:

```tsx
import { urlConSede } from "../lib/sedeUrl";
// prop: sede = ""  → punto unico, e l'URL resta identico a prima
const conSede = (u: string) => urlConSede(u, sede);
const res = await fetch(conSede("/api/contact"), { … });
```

In un componente `.astro` lo script e' un modulo a parte e non vede le props: la
sede passa dal DOM.

```astro
<div class="rw" id="rw" data-sede={sede}>
```

```ts
const SEDE = (document.getElementById("rw") as HTMLElement | null)?.dataset.sede || "";
const conSede = (u: string): string => urlConSede(u, SEDE);
```

Su ChouChou erano `ContactForm.tsx` (una chiamata) e `ReservationWidget.astro`
(sei su sette).

⚠️ **La settima resta nuda, e non e' una dimenticanza.** La *modifica* di una
prenotazione che esiste gia' (`PUT` col token) non porta il punto: la sua sede
sta nella riga, e il token e' l'autorizzazione. Mandare un punto li' vorrebbe
dire poter spostare una prenotazione cambiando un URL. La riga e' dichiarata fra
le eccezioni della rete, e la forma **deve restare questa**, altrimenti la rete
dice che l'eccezione e' morta:

```js
fetch(modifyToken ? "/api/reservation" : conSede("/api/reservation"), { … })
```

⚠️ **Poi le pagine che montano quei componenti devono passargli la sede**, o
la prop resta vuota e tutto il lavoro sopra non serve a niente. La pagina la
prende dall'URL con cui e' stata chiesta — mai da un cookie:

```astro
const sedeChiesta = Astro.url.searchParams.get("sede") ?? "";
<ContactForm t={formLabels} lang={lang} sede={sedeChiesta} client:load />
<ReservationWidget telWidget={telWidget} sede={sedeChiesta} inPage />
```

Un cliente multi-sede incorpora `/reservation-embed` una volta per punto, con
`?sede=<id>` nell'URL dell'iframe. **Nessuna prova verifica questo passaggio**:
e' la parte che si dimentica.

## 8. Le due righe del SEO

`PRESTAZIONI.md` §2. Non arrivano col merge perché stanno in due file
`merge=ours`.

`astro.config.mjs`:

```js
import { inSitemap } from "./src/lib/seo/sitemapRegole";
integrations: [react(), sitemap({ filter: inSitemap })],
```

`public/robots.txt`:

```
Disallow: /admin
Disallow: /reservation-embed
Disallow: /reservation-test
```

Senza la prima, la sitemap del cliente annuncia a Google una quindicina di URL
del pannello, che rispondono 302 al login. ⚠️ E senza l'integrazione **non c'e'
nessuna sitemap**: ChouChou non ne generava una, e `robots.txt` ne annunciava
comunque l'indirizzo.

⚠️ **E guarda cosa il cliente ha scritto li' prima di te**, perche' quei due
file sono suoi e possono essere sbagliati da anni. Su ChouChou:

- `Disallow: /order` e `Disallow: /en/order`, **secche**. Un prefisso in robots
  non ha confini di parola: quelle due righe tenevano fuori da Google la pagina
  d'ordine del ristorante. Le pagine di ritorno si elencano una per una
  (`/order-confirm`, `/order-cancel`, `/order/cancel`). Vale identico per
  `/reservation`, `/menu`, `/contact`, e c'e' una prova che lo verifica: e'
  l'errore gemello, e sarebbe peggio di quello che si sta chiudendo.
- `Sitemap: …/sitemap.xml`. `@astrojs/sitemap` genera **`sitemap-index.xml`**:
  l'indirizzo vecchio rispondeva 404.

## 9. Verifica, commit, migrazioni, deploy

```
npx astro check && npm test
```

`astro check` deve dare **0 errori**. Il totale delle prove cambia da cliente a
cliente (504 su La Molisana, 508 su ChouChou), quindi non e' quello il segnale:
quello che conta e' che le rosse siano **solo** quelle di `prestazioni.test.mjs`
su font del sito e immagini — vedi «Cosa resta fuori». Se e' rossa una rete di
`sede`, `pubblico`, `config` o `seo`, il merge non e' finito.

⚠️ **Le migrazioni: lancia `supabase/TUTTO.sql` INTERO, non i singoli file.**
Contare i `.sql` presenti nel repo dice quali file il cliente ha *ricevuto*, non
quali ha *eseguito*: sono due cose diverse, e dal repo non si distinguono.
`TUTTO.sql` esiste per questo ed è idempotente — *«si può rilanciare su un
cliente che ne ha già una parte, ed è proprio il modo di recuperare quella che
ci si è dimenticati»*.

Se l'SQL Editor rifiuta gli `insert into storage.buckets`, crea a mano i bucket
mancanti (Storage → New bucket, Public ON): `popups`, `menu`, `documents`,
`brand`. Non lo dice ad alta voce.

Poi:

```
npm run build
grep -c admin build/client/sitemap-0.xml     # deve dare 0
```

Deploy. Sul sito vero guarda **home** (i font devono essere identici a prima),
**/order** (il menu si carica, il carrello funziona) e il **pannello**.

---

## Cosa resta fuori, e va bene così

Due lavori di `PRESTAZIONI.md` che il merge non può portare, perché vivono in
file del cliente. Restano segnati da cinque o sei prove rosse in
`prestazioni.test.mjs`, ed è giusto che restino segnati.

- **§1, i font del sito pubblico.** Il layout del cliente ridichiara
  `--font-title`, `--font-body`, `--font-display` nel suo `:root` coi nomi
  letterali e tiene i `<link>` a Google. Funziona — è coerente con se stesso — ma
  mescola i due sistemi in un file solo, ed è quella la trappola.
  ⚠️ Attenzione al caso La Molisana: usa **gli stessi nomi di variabile del
  motore per famiglie diverse** (`--font-title` è Bebas Neue sul sito e Quicksand
  nel motore). Rimetterlo in riga vuol dire rinominare ~130 occorrenze nel CSS
  della vetrina, e **non tutte**: `ReservationWidget.astro` usa già la
  convenzione del motore e va lasciata stare. Va fatto col sito aperto davanti,
  prima e dopo.
- **§3, le immagini.** `<img>` senza posto riservato (22 su La Molisana). Si
  passa a `<Immagine>`, che le dimensioni le pretende.

---

# FASE B — creare la prima sede

Serve solo a chi ha più di un punto. Per un ristorante solo, la Fase A basta e
avanza.

⚠️ **Il minuto dopo che crei la prima sede, lo storico sparirebbe dall'admin.**
`orders`, `reservations`, `restaurant_tables`, `admin_notes`, `google_reviews`,
`push_subscriptions`, `admin_docs_meta`, le chiusure, i ritiri delle gift card
sono tabelle «di sede», filtrate con `location_id = <id>`, e le righe di prima
sono a NULL, che non lo soddisfa. Nessun errore, nessuna riga nei log.

Il motore lo sa già fare. La migrazione #73 porta tre funzioni SQL
(`tabelle_di_sede`, `storico_senza_sede`, `assegna_storico_sede`) e l'admin le
usa: quando c'è storico orfano, in **Établissements** compare un riquadro col
conteggio e il bottone **«Assegna lo storico»**. Sposta le righe *e* i file dei
documenti nel bucket — quelli non si separano con una colonna ma con il percorso
(`sedi/<id>/…`), quindi l'SQL da solo non basterebbe. È idempotente.

Quindi: crea la sede → clicca assegna → verifica che ordini e prenotazioni
vecchi si rivedano.
