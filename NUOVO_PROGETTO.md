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
      (idempotenti). Include la #51 `lunch_hide_by_course.sql`.
- [ ] Storage → crea i bucket **pubblici**: `popups`, `menu`, `documents`, `brand`.
- [ ] Authentication → crea l'utente del cliente; verifica accesso super admin
      `admin@moodd.online`.

## 4. Variabili d'ambiente (pannello **Hostinger**, non Vercel)
- [ ] Supabase: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`.
- [ ] `PUBLIC_SITE_URL` (dominio, SENZA slash finale).
- [ ] Email: `RESEND_API_KEY`, `RESEND_FROM` ("Nome <no-reply@dominio>"), `KITCHEN_EMAIL`.
- [ ] **`CRON_SECRET`** NUOVO per questo cliente (`openssl rand -hex 24`) — mai riusarne uno.
- [ ] Push PWA: `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUBLIC_VAPID_KEY`.
- [ ] Solo se attivi gli ordini: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (+ `MOODD_STRIPE_SECRET_KEY` per crediti/gift card).
- [ ] Opzionali Google: `GOOGLE_SA_KEY_B64`, `GOOGLE_PLACES_API_KEY`.
- ⚠️ Le `PUBLIC_*` vengono "cotte" nel bundle: devono esserci PRIMA della build.

## 5. Deploy (Hostinger)
- [ ] App Node ≥ 22, dominio collegato, env dal pannello.
- [ ] Build: `npm run build` · Output: `build` · Entry: `build/server/entry.mjs`.
- (WAF override e `checkOrigin:false` già gestiti dal motore.)

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
