# RestoHub — Setup nuovo cliente

Questo repo è il **TEMPLATE del motore** (fonte della verità). Ogni cliente è un
repo separato, creato da questo **conservando la storia git** — è ciò che rende
possibili gli aggiornamenti col merge. Mai usare «Use this template» di GitHub
(crea una storia sganciata).

---

## 1. Nuovo repo cliente (storia condivisa)

Su GitHub: crea `MOODDVS/NomeCliente` **privato e VUOTO** (no README/gitignore).
Poi dal Mac:

```
git clone https://github.com/MOODDVS/MOODD-Admin.git /Users/moodd/Developer/NomeCliente
git -C /Users/moodd/Developer/NomeCliente remote set-url origin https://github.com/MOODDVS/NomeCliente.git
git -C /Users/moodd/Developer/NomeCliente remote add engine https://github.com/MOODDVS/MOODD-Admin.git
git -C /Users/moodd/Developer/NomeCliente push -u origin main
```

Il remote `engine` servirà per gli aggiornamenti (punto 7).

## 2. Brand del cliente (le UNICHE cose da toccare nel codice)

- `src/config/client.ts` — nome, claim, telefono, email, indirizzo, paese,
  firma email, social di fallback, path dei loghi.
- `public/` — favicon.svg, favicon.ico, icon-192/512, apple-touch-icon,
  manifest.json (name/short_name), loghi in `public/SVG/` se servono.
- `astro.config.mjs` — `site: "https://www.dominiocliente.be"`.
- `public/robots.txt` — riga `Sitemap:` col dominio del cliente (stesso di `site`).
- Testi legali (`src/pages/privacy.astro`, `cookies.astro` + versioni `en/`)
  quando si attiverà il sito pubblico.
- **Sito pubblico (solo quando si attiva)**: le pagine vetrina e i testi
  contengono ancora i CONTENUTI La Molisana — sono la struttura di esempio,
  da riscrivere col contenuto del cliente. Finché il sito non è linkato,
  nessuno le vede.

### Lo strato "vetrina" (esempio La Molisana) — regole

- **NEL TEMPLATE è CONGELATO**: questi file non si modificano MAI più qui
  (La Molisana condivide la storia git: una cancellazione nel template le
  cancellerebbe il sito live al merge).
- **NEL REPO DI UN CLIENTE nuovo si possono CANCELLARE subito** (o tenere
  come riferimento): le cancellazioni nel repo cliente sono definitive e i
  merge dal template non le faranno tornare.
- File vetrina (cancellabili nel cliente): `src/pages/{menu,ambiance,jobs,
  contact}.astro` + versioni `en/`, `src/components/{Hero,Story,Molise,
  Features,PhotoStrip,CtaFinal}.astro`, gran parte di `src/i18n/*.json`.
- Da TENERE sempre (motore pubblico): `order*`, `reservation*`, `links`,
  `unsubscribe`, `privacy/cookies` (struttura), `Layout`, `Header/Footer/
  MobileNav/CookieBanner/ReservationModal/SitePopup` (si ribrandizzano).

Tutto il resto (ragione sociale, IVA, orari, loghi caricati, link social,
fuso orario…) si configura DALL'ADMIN in Admin → Général, senza codice.

## 3. Supabase (nuovo progetto per cliente)

1. Crea il progetto → prendi URL + service key + anon key.
2. Disattiva «Automatically expose new tables» (le migrazioni fanno i GRANT).
3. SQL Editor → lancia **TUTTE le migrazioni di `supabase/MIGRATIONS.md`
   NELL'ORDINE dei numeri**. Sono idempotenti: rilanciarne una non fa danni.
4. Storage → crea i bucket **pubblici**: `popups`, `menu`, `documents`, `brand`.
5. Authentication → crea l'utente del cliente (email+password) e verifica che
   `admin@moodd.online` possa accedere (super admin, hardcoded nel motore).

## 4. Variabili d'ambiente (.env locale + pannello host)

```
PUBLIC_SUPABASE_URL=…
PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_KEY=…
RESEND_API_KEY=…            # dominio del cliente verificato su Resend
RESEND_FROM="Nome <no-reply@dominiocliente.be>"
KITCHEN_EMAIL=…             # fallback email cucina
CRON_SECRET=…               # NUOVO per ogni cliente: openssl rand -hex 24
PUBLIC_SITE_URL=https://www.dominiocliente.be
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET   # solo quando si attivano gli ordini
```

Mai riusare il CRON_SECRET di un altro cliente. Mai incollare secret in chat.

## 5. Deploy (Hostinger)

- App Node (≥ 22), dominio collegato, env dal pannello, build & deploy.
- Nota WAF Hostinger: i DELETE arrivano come POST + `X-Method-Override`
  (già gestito dal middleware, niente da fare).
- `security.checkOrigin` è già disattivato in astro.config (necessario dietro
  il proxy; sicuro perché l'admin usa Bearer token).

## 6. Scheduler pg_cron (dopo il deploy)

Nel SQL Editor del Supabase del cliente (sostituisci dominio e secret):

```sql
select cron.schedule('daily-brief-hourly', '0 * * * *', $$
  select net.http_get(
    url := 'https://www.dominiocliente.be/api/cron/daily-brief',
    headers := jsonb_build_object('x-cron-key', 'IL_CRON_SECRET')
  );
$$);

select cron.schedule('newsletter-hourly', '10 * * * *', $$
  select net.http_get(
    url := 'https://www.dominiocliente.be/api/cron/newsletter',
    headers := jsonb_build_object('x-cron-key', 'IL_CRON_SECRET')
  );
$$);

-- Rappel client ~3 h avant la réservation (toutes les 30 min pour un
-- timing serré ; la lib n'envoie que ce qui est dû, l'appeler souvent est sûr).
select cron.schedule('resa-reminders-30min', '20,50 * * * *', $$
  select net.http_get(
    url := 'https://www.dominiocliente.be/api/cron/reservation-reminders',
    headers := jsonb_build_object('x-cron-key', 'IL_CRON_SECRET')
  );
$$);
```

## 7. Primo avvio

1. Login come admin@moodd.online → pagina **Réglages** (ingranaggio):
   scegli pagine e tab visibili al cliente.
2. Come cliente → **Admin → Général**: ragione sociale, IVA, indirizzo,
   telefono/email pubblici, fuso orario, loghi (bucket brand), tab Liens.
3. Menu, servizi prenotazione, orari… tutto dall'admin.

Senza sito pubblico: la homepage è una «coming soon» neutra; le pagine
pubbliche (menu, ordini, prenotazioni) esistono ma non sono linkate —
si attivano più avanti personalizzando la home e i testi legali.

---

## Aggiornare un cliente a una versione più recente del motore

Le migliorie si fanno SEMPRE qui nel template (o si riportano subito).
Nei repo cliente si toccano solo i file del punto 2 → i merge restano puliti.

Dal Mac, nel repo del cliente:

```
git -C /Users/moodd/Developer/NomeCliente fetch engine
git -C /Users/moodd/Developer/NomeCliente merge engine/main
```

- Conflitti (rari): quasi sempre su `client.ts` → si tiene la versione cliente.
- Poi: `npx astro check` → test locale → push → deploy.
- **Migrazioni**: apri `supabase/MIGRATIONS.md` e lancia sul Supabase del
  cliente i numeri che gli mancano, in ordine.

Consiglio: taggare le versioni del template (`git tag v2.2 && git push origin v2.2`)
e fare i merge di un tag preciso (`git merge v2.2`), tenendo nota in un
`CLIENTS.md` di chi è fermo a quale versione.
