#!/usr/bin/env bash
# Déploie Quest Lab sur un VPS Debian/Ubuntu (systemd + Caddy).
#   Première fois : ./deploy.sh user@vps --init --domain quest.exemple.fr [--env-file .env]
#   Mises à jour  : ./deploy.sh user@vps
# Prérequis : accès SSH par clé, sudo sans mot de passe (ou utilisateur root), Node 20+ sur le VPS.
# Ne touche jamais au .env ni à data/ du serveur, sauf --env-file à l'initialisation.
set -euo pipefail
cd "$(dirname "$0")"

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[ $# -ge 1 ] || usage
TARGET="$1"; shift
INIT=0; DOMAIN=""; ENVFILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --init) INIT=1 ;;
    --domain) DOMAIN="${2:?--domain demande une valeur}"; shift ;;
    --env-file) ENVFILE="${2:?--env-file demande un chemin}"; shift ;;
    *) echo "Option inconnue : $1"; usage ;;
  esac
  shift
done
[ -z "$DOMAIN" ] || [ "$INIT" = 1 ] || { echo "--domain s'utilise avec --init"; exit 1; }
[ -z "$ENVFILE" ] || [ "$INIT" = 1 ] || { echo "--env-file s'utilise avec --init"; exit 1; }
[ -z "$ENVFILE" ] || [ -f "$ENVFILE" ] || { echo "Fichier introuvable : $ENVFILE"; exit 1; }

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$TARGET")
STAGE=/tmp/quest-lab-stage

echo "→ Vérification locale"
node --check server.js
for f in client/*.js client/*.mjs public/*.js; do node --check "$f"; done

echo "→ Connexion à $TARGET"
"${SSH[@]}" 'echo ok >/dev/null && node -e "process.exit(+process.versions.node.split(\".\")[0] >= 20 ? 0 : 1)"' \
  || { echo "Échec : SSH par clé impossible, ou Node 20+ absent sur le VPS."; exit 1; }

echo "→ Envoi des fichiers"
"${SSH[@]}" "rm -rf $STAGE && mkdir -p $STAGE"
tar czf - --exclude=.git --exclude=.env --exclude=data --exclude='*.log' --exclude='*.bak*' --exclude=node_modules . | "${SSH[@]}" "tar xzf - -C $STAGE"
[ -z "$ENVFILE" ] || { "${SSH[@]}" "umask 077; cat > $STAGE/.env.upload" < "$ENVFILE"; }

echo "→ Installation"
"${SSH[@]}" "sudo INIT=$INIT DOMAIN='$DOMAIN' STAGE=$STAGE bash -s" <<'REMOTE'
set -euo pipefail
APP=/opt/quest-lab
id questlab >/dev/null 2>&1 || useradd -r -m -d "$APP" -s /usr/sbin/nologin questlab
mkdir -p "$APP"
# remplace le code, conserve .env et data/
find "$APP" -mindepth 1 -maxdepth 1 ! -name .env ! -name data -exec rm -rf {} +
cp -a "$STAGE"/. "$APP"/
rm -f "$APP/.env.upload"
if [ ! -f "$APP/.env" ]; then
  if [ -f "$STAGE/.env.upload" ]; then install -m 600 "$STAGE/.env.upload" "$APP/.env"
  else printf 'ACCESS_TOKEN=%s\n' "$(openssl rand -hex 16)" > "$APP/.env"; chmod 600 "$APP/.env"; echo "!! $APP/.env créé sans LLM : renseigne LLM_BASE_URL, LLM_API_KEY, LLM_MODEL (et STT_*)."; fi
fi
grep -q '^ACCESS_TOKEN=.' "$APP/.env" || printf '\nACCESS_TOKEN=%s\n' "$(openssl rand -hex 16)" >> "$APP/.env"
rm -rf "$STAGE"
mkdir -p "$APP/data"; chown -R questlab: "$APP"; chmod 600 "$APP/.env"
cp "$APP/deploy/quest-lab.service" /etc/systemd/system/quest-lab.service
systemctl daemon-reload
systemctl enable quest-lab >/dev/null 2>&1
systemctl restart quest-lab

if [ "$INIT" = 1 ] && [ -n "$DOMAIN" ]; then
  if command -v caddy >/dev/null 2>&1; then
    CF=/etc/caddy/Caddyfile; touch "$CF"
    if grep -q "^$DOMAIN" "$CF"; then echo "Caddy : $DOMAIN déjà configuré, laissé tel quel."
    else printf '\n%s {\n\treverse_proxy 127.0.0.1:8080 {\n\t\tflush_interval -1\n\t}\n}\n' "$DOMAIN" >> "$CF"; systemctl reload caddy; echo "Caddy : $DOMAIN ajouté."; fi
  else echo "!! Caddy absent : installe-le (https://caddyserver.com/docs/install), puis ajoute le bloc de deploy/Caddyfile."; fi
fi

for i in 1 2 3 4 5; do curl -fsS http://127.0.0.1:8080/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:8080/health >/dev/null 2>&1 && echo "Bridge : en ligne." || { echo "!! Bridge injoignable :"; journalctl -u quest-lab -n 15 --no-pager; exit 1; }
echo "TOKEN=$(grep '^ACCESS_TOKEN=' "$APP/.env" | cut -d= -f2)"
REMOTE
echo "→ Terminé."
[ -z "$DOMAIN" ] || echo "Casque : https://$DOMAIN/?k=<TOKEN affiché ci-dessus>"
