#!/usr/bin/env bash
# ============================================================
# job-cron.sh — i job pg_cron di un cliente (6 dal 27/11/2026), pronti da incollare (20/11/2026).
#
# La casella Supabase (Super → Intégrations) li crea da sola solo dal sito
# ONLINE e solo se il server ha SUPABASE_ACCESS_TOKEN — che sui server non
# c'e', apposta. In locale dice «ici l'adresse est locale». Questo script
# prepara lo stesso SQL della casella (`sqlJob` in lib/admin/supabaseRegole.ts)
# e lo mette negli APPUNTI: non lo scrive su disco e non lo stampa (dentro c'e'
# CRON_SECRET).
#
# Uso (sul Mac, dalla cartella RestoHub):
#   ./scripts/job-cron.sh educazione
#       app del VPS: indirizzo e cartella dall'elenco di deploy-vps.sh,
#       CRON_SECRET letto dal .env DEL SERVER (e' quello che il sito usa).
#   ./scripts/job-cron.sh ~/Developer/450Gradi https://www.450gradi.be
#       cliente su Hostinger: CRON_SECRET dal .env del Mac — deve essere
#       uguale a quello in hPanel, se no i job tornano 401.
#
# Poi: Supabase del cliente → SQL Editor → incolla → Run. Svuota gli appunti.
# ⚠️ L'indirizzo deve essere quello che risponde 200 DIRETTO (www o no):
#    su un 301 net.http_get si ferma e il job «gira» senza fare niente.
# ⚠️ I job qui sotto devono restare uguali a JOB_ATTESI (lo controlla
#    tests/jobCron.test.mjs).
# ============================================================
set -uo pipefail

CHIAVE_SSH="$HOME/.ssh/moodd_vps"
SERVER="enzo@153.92.222.33"
QUI="$(cd "$(dirname "$0")" && pwd)"

JOBS=(
  "auto-complete-orders|0 * * * *|/api/cron/auto-complete-orders"
  "daily-brief|5 * * * *|/api/cron/daily-brief"
  "newsletter|10 * * * *|/api/cron/newsletter"
  "reservation-reminders|15 * * * *|/api/cron/reservation-reminders"
  "google-reviews-hourly|20 * * * *|/api/cron/google-reviews"
  "annuncia-ordini|*/5 * * * *|/api/cron/annuncia-ordini"
)

lett() { printf "'%s'" "${1//\'/\'\'}"; }

if [[ $# -eq 1 ]]; then
  riga="$(grep -E "^[[:space:]]*\"$1\|" "$QUI/deploy-vps.sh" | head -1 | sed -E 's/^[[:space:]]*"//; s/"[[:space:]]*$//')"
  [[ -n "$riga" ]] || { echo "✗ «$1» non e' nell'elenco di deploy-vps.sh. Per Hostinger: $0 <cartella> <indirizzo>"; exit 1; }
  IFS="|" read -r nome locale remoto _ _ sito _ <<<"$riga"
  segreto="$(ssh -i "$CHIAVE_SSH" "$SERVER" "grep '^CRON_SECRET=' '$remoto/.env' | tail -1 | cut -d= -f2-")"
  da="il .env del server ($remoto)"
elif [[ $# -eq 2 ]]; then
  locale="${1/#\~/$HOME}"
  sito="$2"
  segreto="$(grep '^CRON_SECRET=' "$locale/.env" 2>/dev/null | tail -1 | cut -d= -f2-)"
  da="il .env del Mac ($locale) — deve essere uguale a hPanel"
else
  sed -n '9,18p' "$0"; exit 1
fi

segreto="${segreto%\"}"; segreto="${segreto#\"}"
[[ -n "$segreto" ]] || { echo "✗ CRON_SECRET non trovato in $da"; exit 1; }
[[ "$sito" =~ ^https://[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "✗ indirizzo strano: $sito (serve https://dominio, senza / in fondo)"; exit 1; }

codice=$(curl -s -o /dev/null -m 15 -w "%{http_code}" "$sito/" 2>/dev/null || true)
if [[ "$codice" != "200" ]]; then
  echo "⚠️ $sito/ risponde $codice, non 200: se e' un redirect, usa l'indirizzo d'arrivo."
fi

sql="-- I ${#JOBS[@]} job di RestoHub per $sito (job-cron.sh, $(date +%d/%m/%Y))
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
"
for j in "${JOBS[@]}"; do
  IFS="|" read -r jn orario percorso <<<"$j"
  sql+="select cron.schedule($(lett "$jn"), $(lett "$orario"), \$job\$
  select net.http_get(url := $(lett "$sito$percorso"),
    headers := jsonb_build_object('x-cron-key', $(lett "$segreto"))); \$job\$);
"
done
sql+="select jobname, schedule, active from cron.job order by jobname;"

printf '%s' "$sql" | pbcopy
echo "✓ SQL dei ${#JOBS[@]} job per $sito negli appunti (CRON_SECRET da $da)."
echo "  Supabase del cliente → SQL Editor → incolla → Run: in fondo devono uscire ${#JOBS[@]} righe attive."
echo "  Poi copia qualcos'altro, per svuotare gli appunti."
