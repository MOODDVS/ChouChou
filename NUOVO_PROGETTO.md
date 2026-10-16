# ✅ Nuovo progetto cliente — checklist passo-passo

Lista rapida per avviare un nuovo ristorante sul motore. Ogni riquadro è un
passo: falli in ordine. Per i dettagli di ogni punto vedi `SETUP.md`; per le
migrazioni `supabase/MIGRATIONS.md`. Regola d'oro: **mai secret in chat**, e
**ogni cliente ha il suo Supabase, le sue env, i suoi cron** (niente si eredita
dal motore).

---

## 1. Repo cliente (storia git condivisa col motore)
- [ ] Su GitHub crea `MOODDVS/NomeCliente` **privato e vuoto**.
- [ ] `git clone` del motore, poi `remote set-url origin` = repo cliente e
      `remote add engine` = motore, infine `git push -u origin main`.
  (comandi esatti in `SETUP.md` §1)

## 2. Brand (le UNICHE cose da toccare nel codice)
- [ ] `src/config/client.ts` (nome, contatti, firma email, path loghi).
- [ ] `public/` (favicon, icone, manifest, loghi) + `astro.config.mjs` (`site`)
      + `public/robots.txt` (Sitemap).
- Tutto il resto si configura DALL'ADMIN (Général), senza codice.

## 3. Supabase (nuovo progetto)
- [ ] Crea il progetto → salva URL + anon key + **service key**.
- [ ] Database → Extensions: attiva **`pg_cron`** e **`pg_net`**.
- [ ] Disattiva «Automatically expose new tables» (i GRANT li fanno le migrazioni).
- [ ] SQL Editor → lancia **TUTTE le migrazioni di `MIGRATIONS.md` in ordine**
      (idempotenti). Include la #51 `051_lunch_hide_by_course.sql`.
- [ ] **Dopo le migrazioni**: `notify pgrst, 'reload schema';` nel SQL Editor.
      PostgREST tiene in cache la struttura del database: finché non la
      rilegge, una tabella appena creata risponde `PGRST205 Could not find
      the table … in the schema cache`, come se non esistesse.
- [ ] Storage → crea i bucket **pubblici**: `popups`, `menu`, `documents`, `brand`.
- [ ] Authentication → crea l'utente del cliente; verifica accesso super admin
      `admin@moodd.online`.

## 3bis. Piu' di una sede? (450 Gradi e' il primo, 16/09/2026)

**Salta tutto questo se il cliente ha UN punto solo** — ed e' il caso normale.
Tabella `locations` vuota vuol dire nessun filtro, cioe' il comportamento di
sempre. La sede si crea il giorno che ne arriva una seconda, non «per sicurezza».

Con piu' punti (piu' societa', un sito solo):
- [ ] `supabase/073_locations.sql` e' fra le migrazioni: assicurati che sia passata.
- [ ] `/admin/super` → **Sedi**: creane una per punto (nome, slug, indirizzo,
      societa', IVA, fuso). L'ordine qui e' quello del selettore nell'header.
- [ ] **Stripe per sede**: ogni societa' incassa sul SUO conto. La chiave si
      mette da `/admin/super` → Sedi, non nell'`.env`, e viene cifrata con
      `SECRETS_KEY` (32 byte base64, nell'`.env`: senza, l'admin rifiuta di
      salvarla invece di scriverla in chiaro).
- [ ] **Webhook Stripe**: un indirizzo solo per tutti i conti
      (`https://<dominio>/api/stripe-webhook`). Si prova ogni chiave di firma e
      quella che verifica dice da dove arriva l'evento. Niente slug nell'URL.
- [ ] **Sul sito**: ogni chiamata al motore porta il punto — header `x-sede`
      oppure `?sede=<id>`. Senza, il motore ripiega sulla PRIMA sede, che con
      tre punti sbaglia due volte su tre. Il widget di prenotazione lo fa gia'
      se gli passi `sede` (vedi `reservation-embed.astro`).
- [ ] `.env`: `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` restano come
      RIPIEGO per chi non ha ancora la sua chiave. Una riga presente e
      illeggibile NON ripiega: assente e' una configurazione, illeggibile e'
      un guasto.

⚠️ Quello che NON e' per sede: il cliente, il menu, i coupon, i buoni regalo,
la newsletter e il tema sono del MARCHIO. Un buono comprato in un punto si
spende negli altri; un coupon puo' essere ristretto a due punti su tre.

## 4. Variabili d'ambiente

Due strade a seconda di dove gira il cliente. **Dal 14/10/2026 i clienti nuovi
vanno sul VPS** (`claude/vps-restohub.md` nel progetto): Hostinger ha un tetto di
dieci Web App che non si alza pagando, ed e' il motivo per cui il VPS esiste.

- [ ] Supabase: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`,
      `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`.
      ⚠️ URL e anon key vanno scritti DUE VOLTE, uguali: la coppia senza
      `PUBLIC_` la usa il server, quella con `PUBLIC_` il browser. Una delle due
      sbagliata fa funzionare meta' applicazione.
- [ ] `PUBLIC_SITE_URL` (dominio, SENZA slash finale).
- [ ] Email: `RESEND_API_KEY`, `RESEND_FROM`, `KITCHEN_EMAIL`.
      ⚠️ Il mittente deve stare su un dominio VERIFICATO in Resend. Il dominio
      del cliente appena comprato non lo e': finche' non lo verifichi, usa
      `moodd.online` o le email vengono rifiutate. (Da ieri il rifiuto finisce
      nel log col suo motivo — vedi `claude/trappole-del-motore.md` — ma meglio
      non arrivarci.)
- [ ] `SECRETS_KEY` (`openssl rand -base64 32`) e **`CRON_SECRET` NUOVO per
      questo cliente** (`openssl rand -hex 32`) — mai riusarne uno.
- [ ] Push PWA: `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUBLIC_VAPID_KEY`.
- [ ] Solo se attivi gli ordini: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
      (+ `MOODD_STRIPE_SECRET_KEY` per crediti/gift card).
- [ ] Opzionali Google: `GOOGLE_SA_KEY_B64`, `GOOGLE_PLACES_API_KEY`.
- ⚠️ Le `PUBLIC_*` vengono "cotte" nel bundle: devono esserci PRIMA della build.

## 5. Deploy

### 5a. Sul VPS (strada normale dal 14/10/2026)

Prima il DNS: record **A** del dominio nudo → `153.92.222.33`, TTL 300, e `www`
come **CNAME** verso il dominio nudo. ⚠️ Un ALIAS o CNAME preesistente sullo
stesso nome va **cancellato**, non affiancato.

1. Dal **Mac**, copia il sorgente (niente `.env`: il repo cliente non ne ha):

        rsync -avz --delete --exclude node_modules --exclude build --exclude .git --exclude .astro -e "ssh -i ~/.ssh/moodd_vps" ~/Developer/<Cliente>/ enzo@153.92.222.33:/home/enzo/app-<cliente>/

2. Sul **server**, il file delle variabili. Le due chiavi casuali le genera lui:

        cd ~/app-<cliente> && cp .env.example .env && chmod 600 .env
        # poi `nano .env` per i valori di Supabase e Resend

   ⚠️ Dopo aver riempito i valori, **togli i commenti in coda alle righe**:
   il template li ha, e Node puo' portarseli dentro il valore.
3. `npm ci && npm run build`
4. Un `ecosystem.config.cjs` con una **porta libera** (vedi l'elenco sotto) e
   `HOST=127.0.0.1`, poi `pm2 start ecosystem.config.cjs && pm2 save`.
5. Un blocco in `/etc/caddy/Caddyfile`:

        <dominio> {
            encode zstd gzip
            reverse_proxy 127.0.0.1:<porta>
        }

        www.<dominio> {
            redir https://<dominio>{uri} permanent
        }

   poi `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.
6. Prova: `curl -I http://127.0.0.1:<porta>` (il motore risponde) e poi
   `curl -I https://<dominio>` (deve avere `via: 1.1 Caddy`).

⚠️ **LE PORTE SONO UNA PER CLIENTE** e stanno scritte qui, o il secondo che
usa la stessa non parte e il messaggio parla di `EADDRINUSE`, non di porte:

| porta | chi |
|---|---|
| 4321 | `app.restohub.cloud` (motore, dimostrazione) |
| 4322 | `villa77.be` |

### 5b. Su Hostinger (i clienti gia' li)

- [ ] App Node ≥ 22, dominio collegato, env dal pannello.
- [ ] Build: `npm run build` · Output: `build` · Entry: `build/server/entry.mjs`.
- (WAF override e `checkOrigin:false` gia' gestiti dal motore.)
- ⚠️ `NODE_OPTIONS=--v8-pool-size=2` e `UV_THREADPOOL_SIZE=2` servono **li'**,
  dove il tetto dei processi e' condiviso. Sul VPS restano utili lo stesso,
  perche' di motori ne gireranno molti sugli stessi processori.

## 6. Scheduler pg_cron — **TUTTI e 5 i job** (dopo il deploy)
Nel SQL Editor del Supabase del cliente (sostituisci dominio + il suo CRON_SECRET):

```sql
select cron.schedule('auto-complete-orders', '0 * * * *', $$
  select net.http_get(url := 'https://IL-DOMINIO/api/cron/auto-complete-orders',
    headers := jsonb_build_object('x-cron-key', 'IL_CRON_SECRET')); $$);

select cron.schedule('daily-brief', '5 * * * *', $$
  select net.http_get(url := 'https://IL-DOMINIO/api/cron/daily-brief',
    headers := jsonb_build_object('x-cron-key', 'IL_CRON_SECRET')); $$);

select cron.schedule('newsletter', '10 * * * *', $$
  select net.http_get(url := 'https://IL-DOMINIO/api/cron/newsletter',
    headers := jsonb_build_object('x-cron-key', 'IL_CRON_SECRET')); $$);

select cron.schedule('reservation-reminders', '15 * * * *', $$
  select net.http_get(url := 'https://IL-DOMINIO/api/cron/reservation-reminders',
    headers := jsonb_build_object('x-cron-key', 'IL_CRON_SECRET')); $$);

select cron.schedule('google-reviews-hourly', '20 * * * *', $$
  select net.http_get(url := 'https://IL-DOMINIO/api/cron/google-reviews',
    headers := jsonb_build_object('x-cron-key', 'IL_CRON_SECRET')); $$);
```

- [ ] Verifica: `select jobname, schedule, active from cron.job order by jobid;` → 5 righe `active=true`.
- [ ] Dopo lo scoccare dell'ora: `select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;` → `succeeded`.
  (se `401`: il secret nel job non combacia con quello su Hostinger.)

## 7. Primo avvio
- [ ] Login `admin@moodd.online` → **Réglages**: pagine e tab visibili al cliente.
- [ ] Come cliente → **Général**: ragione sociale, IVA, indirizzo, contatti, fuso, loghi.
- [ ] Configura menu, prenotazioni, orari dall'admin.

## 8. Aggiornare in futuro (merge dal motore)
- [ ] `git -C <repo-cliente> fetch engine && git -C <repo-cliente> merge engine/main`
- [ ] Conflitti rari (di solito solo `client.ts` → si tiene la versione cliente).
- [ ] `npx astro check` → test → push → deploy.
- [ ] **Migrazioni**: lancia sul Supabase del cliente i numeri che gli mancano (in ordine).

---
Promemoria trasversali: hosting = **Hostinger** (non Vercel); admin in FRANCESE;
se il cliente attiva un sito pubblico che mostra gli eventi, la descrizione lunga
è ora **HTML** → renderizzarla con `set:html`.
