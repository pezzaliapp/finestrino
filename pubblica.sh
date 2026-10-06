#!/bin/bash
# Pubblica Finestrino su GitHub e fa aggiornare da sola l'app di chi la sta usando.
# Uso:  ./pubblica.sh "cosa hai cambiato"
set -e
cd "$(dirname "$0")"
V=$(date +%Y%m%d-%H%M%S)
printf '{ "version": "%s" }\n' "$V" > version.json
git add -A
git commit -m "${1:-Aggiornamento} (versione $V)"
git push
echo ""
echo "Pubblicata la versione $V."
echo "Tra 1-2 minuti è online; chi ha l'app aperta la riceve entro 5 minuti."
