#!/usr/bin/env bash
# ============================================================
# deploy-vps.sh — aggiorna le app sul VPS in un colpo solo, dal Mac.
#
# Uso:
#   ./scripts/deploy-vps.sh restohub     solo app.restohub.cloud (il motore)
#   ./scripts/deploy-vps.sh villa77      solo villa77.be
#   ./scripts/deploy-vps.sh              tutte e due
#
# Fa, per ogni app, i passi del documento «vps-restohub» nel progetto:
#   1. la PROVA dell'rsync: se cancellerebbe qualcosa sul server, si FERMA
#      e mostra cosa (non si decide da soli di cancellare);
#   2. l'rsync vero (sempre senza .env, ecosystem.config.cjs, build,
#      node_modules, .git, .astro);
#   3. sul server: controllo di PUBLIC_SITE_URL, npm ci, build, pm2 restart;
#   4. il curl sulla SUA porta, scritta qui a mano: deve rispondere 200.
#
# ⚠️ Gira SUL MAC: la chiave ~/.ssh/moodd_vps non lascia il Mac, e sul
# server non si incolla niente — i comandi li manda ssh, sono sempre questi.
# ⚠️ Non fa merge ne' push: prima il motore (commit + push) e, per i
# clienti, ./scripts/sync-clienti.sh.
# ============================================================
set -uo pipefail

CHIAVE="$HOME/.ssh/moodd_vps"
SERVER="enzo@153.92.222.33"
ESCLUSI=(--exclude node_modules --exclude build --exclude .git --exclude .astro --exclude .env --exclude ecosystem.config.cjs)

# nome | cartella sul Mac | cartella sul server | processo pm2 | porta | indirizzo atteso
APPS=(
  "restohub|$HOME/Developer/RestoHub|/home/enzo/app-restohub|restohub-app|4321|https://app.restohub.cloud"
  "villa77|$HOME/Developer/Villa77|/home/enzo/app-villa77|villa77|4322|https://villa77.be"
)

scelta="${1:-tutti}"
ok=()
ko=()

for riga in "${APPS[@]}"; do
  IFS="|" read -r nome locale remoto pm2nome porta url <<<"$riga"
  [[ "$scelta" != "tutti" && "$scelta" != "$nome" ]] && continue

  echo "══════════════════════════════════════════════════════"
  echo "▶  $nome"

  if [[ ! -d "$locale" ]]; then
    echo "   ✗ cartella non trovata: $locale"; ko+=("$nome"); continue
  fi

  # 1. La prova: cosa verrebbe CANCELLATO sul server?
  echo "   • prova rsync…"
  cancellati=$(rsync -avzn --delete "${ESCLUSI[@]}" -e "ssh -i $CHIAVE" "$locale/" "$SERVER:$remoto/" | grep '^deleting' || true)
  if [[ -n "$cancellati" ]]; then
    echo "   ✗ FERMO: l'rsync cancellerebbe sul server:"
    echo "$cancellati" | sed 's/^/       /'
    echo "     Controlla, e se va bene lancia l'rsync a mano (vedi il documento del VPS)."
    ko+=("$nome"); continue
  fi

  # 2. L'rsync vero.
  echo "   • rsync…"
  if ! rsync -az --delete "${ESCLUSI[@]}" -e "ssh -i $CHIAVE" "$locale/" "$SERVER:$remoto/"; then
    echo "   ✗ rsync fallito"; ko+=("$nome"); continue
  fi

  # 3 e 4. Sul server: indirizzo, build, riavvio, prova sulla porta.
  echo "   • build sul server (un minuto circa)…"
  ssh -i "$CHIAVE" "$SERVER" bash -s -- "$remoto" "$pm2nome" "$porta" "$url" <<'REMOTO'
set -uo pipefail
remoto="$1"; pm2nome="$2"; porta="$3"; url="$4"
attuale=$(grep '^PUBLIC_SITE_URL=' "$remoto/.env" | cut -d= -f2-)
if [[ "$attuale" != "$url" ]]; then
  echo "   ✗ PUBLIC_SITE_URL nel .env del server e' «$attuale», atteso «$url»: niente build."
  exit 1
fi
cd "$remoto" || exit 1
if ! npm ci --silent >/tmp/deploy-npm.log 2>&1; then echo "   ✗ npm ci fallito:"; tail -20 /tmp/deploy-npm.log; exit 1; fi
if ! npm run build >/tmp/deploy-build.log 2>&1; then echo "   ✗ build fallita:"; tail -30 /tmp/deploy-build.log; exit 1; fi
pm2 restart "$pm2nome" >/dev/null || { echo "   ✗ pm2 restart fallito"; exit 1; }
# L'app ci mette qualche secondo a ripartire: si riprova fino a 20 secondi.
risposta=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  risposta=$(curl -sI "http://127.0.0.1:$porta" | head -1)
  [[ "$risposta" == *" 200"* ]] && break
done
echo "   • curl :$porta → $risposta"
[[ "$risposta" == *" 200"* ]] || exit 1
REMOTO
  if [[ $? -eq 0 ]]; then
    echo "   ✓ $nome aggiornato"; ok+=("$nome")
  else
    ko+=("$nome")
  fi
done

echo "══════════════════════════════════════════════════════"
echo "FATTO."
echo "  ✓ ok:       ${ok[*]:-–}"
echo "  ✗ problemi: ${ko[*]:-–}"
[[ ${#ko[@]} -eq 0 ]]
