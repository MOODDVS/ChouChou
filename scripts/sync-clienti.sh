#!/usr/bin/env bash
# ============================================================
# sync-clienti.sh — propaga il MOTORE RestoHub a tutti i repo cliente
# tramite git merge, proteggendo il brand di ciascuno (.gitattributes).
#
# Uso:
#   ./scripts/sync-clienti.sh          fetch + merge + push su tutti i clienti
#   ./scripts/sync-clienti.sh --dry    mostra solo cosa entrerebbe, NIENTE push
#
# Prerequisito: i repo cliente devono essere clonati in locale (vedi CLIENTI).
# Sicuro da rilanciare: se un cliente è già aggiornato, lo salta.
# ============================================================
set -uo pipefail

# ---- Percorsi locali dei repo cliente sul Mac (aggiungi qui i nuovi) ----
CLIENTI=(
  "$HOME/Developer/ChouChou"
  "$HOME/Developer/LaMolisana"
  "$HOME/Developer/EducazioneNapoletana"
)
ENGINE_URL="https://github.com/MOODDVS/MOODD-Admin.git"
BRANCH="main"

DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
ok=(); ko=(); skip=()

for repo in "${CLIENTI[@]}"; do
  nome="$(basename "$repo")"
  echo "══════════════════════════════════════════════════════"
  echo "▶  $nome"

  if [ ! -d "$repo/.git" ]; then echo "   ✗ non è un repo git — salto"; skip+=("$nome"); continue; fi
  cd "$repo" || { ko+=("$nome"); continue; }

  # Lavoro pulito? (non mergiare sopra modifiche non salvate)
  if [ -n "$(git status --porcelain)" ]; then
    echo "   ✗ ci sono modifiche non committate — salvale o annullale prima. Salto."
    skip+=("$nome"); continue
  fi

  # Remote 'engine' + driver merge=ours (idempotenti)
  git remote get-url engine >/dev/null 2>&1 || git remote add engine "$ENGINE_URL"
  git config merge.ours.driver true

  echo "   • fetch engine…"
  if ! git fetch engine "$BRANCH" -q; then echo "   ✗ fetch fallito (rete/credenziali?)"; ko+=("$nome"); continue; fi

  # Bootstrap .gitattributes al primo giro (serve PRIMA del merge)
  if [ ! -f .gitattributes ]; then
    if git show "engine/$BRANCH:.gitattributes" > .gitattributes 2>/dev/null; then
      git add .gitattributes
      git commit -q -m "chore: .gitattributes per merge motore (protezione file per-cliente)"
      echo "   • .gitattributes creato dal motore (primo allineamento)"
    fi
  fi

  # Già aggiornato?
  if git merge-base --is-ancestor "engine/$BRANCH" HEAD; then
    echo "   ✓ già aggiornato"; ok+=("$nome"); continue
  fi

  # Migrazioni Supabase nuove (promemoria da lanciare a mano)
  nuove=$(git diff --name-only --diff-filter=A "HEAD...engine/$BRANCH" -- 'supabase/*.sql' 2>/dev/null)

  if [ "$DRY" -eq 1 ]; then
    echo "   (dry-run) commit del motore che entrerebbero:"
    git log --oneline "HEAD..engine/$BRANCH" | sed 's/^/       /' | head -40
    [ -n "$nuove" ] && { echo "   migrazioni nuove:"; echo "$nuove" | sed 's/^/       /'; }
    ok+=("$nome"); continue
  fi

  echo "   • merge engine/$BRANCH…"
  if git merge --no-edit -m "merge: aggiornamento motore RestoHub" "engine/$BRANCH"; then
    echo "   ✓ merge ok"
    # package.json cambiato? -> serve npm install
    if ! git diff --quiet 'HEAD@{1}' HEAD -- package.json 2>/dev/null; then
      echo "   ⚠ package.json cambiato → lancia 'npm install' in $repo"
    fi
    if git push -q; then echo "   ✓ push ok"; ok+=("$nome"); else echo "   ✗ push fallito"; ko+=("$nome"); fi
    if [ -n "$nuove" ]; then
      echo "   ⚠ MIGRAZIONI Supabase da lanciare per $nome:"; echo "$nuove" | sed 's/^/       /'
    fi
  else
    echo "   ✗ CONFLITTO nel merge (raro: qualcuno ha toccato file del motore)."
    echo "     Annullo per non lasciare il repo a metà: risolvi a mano poi rilancia."
    git merge --abort
    ko+=("$nome")
  fi
done

echo "══════════════════════════════════════════════════════"
echo "FATTO."
echo "  ✓ ok:       ${ok[*]:-–}"
echo "  ✗ problemi: ${ko[*]:-–}"
echo "  ⤼ saltati:  ${skip[*]:-–}"
[ -n "${ko[*]:-}" ] && echo "  → controlla i 'problemi' qui sopra." || true
