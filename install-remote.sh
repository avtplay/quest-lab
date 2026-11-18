#!/usr/bin/env bash
# Installe le client Quest Lab sur une machine distante, celle où tournent tes sessions Claude Code (via SSH).
#   ./install-remote.sh user@machine --url https://quest.exemple.fr --machine nom [--control] [--history] [--no-listen]
#   ./install-remote.sh user@machine --uninstall
# Le jeton est lu dans QUEST_LAB_TOKEN, ou demandé en saisie masquée. Il voyage par stdin (jamais en argument).
# Prérequis sur la machine distante : Node 20+ et un accès SSH par clé.
set -euo pipefail
cd "$(dirname "$0")"
[ $# -ge 1 ] || { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
TARGET="$1"; shift
PASS=(); UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) UNINSTALL=1; PASS+=("$1") ;;
    --url|--machine) PASS+=("$1" "${2:?$1 demande une valeur}"); shift ;;
    *) PASS+=("$1") ;;
  esac; shift
done
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$TARGET")

echo "→ Connexion à $TARGET"
"${SSH[@]}" 'node -e "process.exit(+process.versions.node.split(\".\")[0] >= 20 ? 0 : 1)"' \
  || { echo "Échec : SSH par clé impossible, ou Node 20+ absent sur $TARGET."; exit 1; }

echo "→ Copie du client"
tar czf - client | "${SSH[@]}" 'rm -rf ~/.quest-lab/client-new && mkdir -p ~/.quest-lab/client-new && tar xzf - -C ~/.quest-lab/client-new --strip-components=1 && rm -rf ~/.quest-lab/client && mv ~/.quest-lab/client-new ~/.quest-lab/client'

if [ "$UNINSTALL" = 1 ]; then
  "${SSH[@]}" 'node ~/.quest-lab/client/install.mjs --uninstall'
else
  TOKEN="${QUEST_LAB_TOKEN:-}"
  if [ -z "$TOKEN" ]; then read -rsp "Jeton d'accès du bridge : " TOKEN; echo; fi
  [ -n "$TOKEN" ] || { echo "Jeton vide."; exit 1; }
  echo "→ Installation des hooks"
  printf '%s' "$TOKEN" | "${SSH[@]}" "node ~/.quest-lab/client/install.mjs --token-stdin ${PASS[*]@Q}"
fi
echo "→ Terminé. Relance les sessions Claude Code ouvertes sur $TARGET pour qu'elles prennent les hooks en compte."
