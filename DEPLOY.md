# Déployer Quest Lab sur un VPS (option B : bridge central)

Un bridge sur le VPS. Chaque machine de dev n'installe qu'un petit hook qui lui envoie ses sessions et sa mémoire.
Le Quest ouvre l'URL du VPS : il voit les sessions de **toutes** les machines.

## 0. Automatique

`./deploy.sh utilisateur@vps --init --domain quest.exemple.fr --env-file .env` fait tout ce qui suit (première fois), puis `./deploy.sh utilisateur@vps` pour chaque mise à jour.

## 1. À la main (Debian/Ubuntu)

Prérequis : Node 20+, un nom de domaine pointant vers le VPS (WebXR exige HTTPS), Caddy.

```bash
sudo useradd -r -m -d /opt/quest-lab questlab
# depuis ta machine :  rsync -av --exclude .env --exclude data --exclude client.log ~/quest-lab/ vps:/tmp/quest-lab/
sudo rsync -a /tmp/quest-lab/ /opt/quest-lab/ && sudo chown -R questlab: /opt/quest-lab
sudo cp /opt/quest-lab/deploy/quest-lab.service /etc/systemd/system/
sudo cp /opt/quest-lab/deploy/Caddyfile /etc/caddy/Caddyfile     # puis édite le domaine
```

Crée `/opt/quest-lab/.env` (droits 600, propriétaire `questlab`) :

```
ACCESS_TOKEN=<jeton long et aléatoire : openssl rand -hex 16>
LLM_BASE_URL=http://<hôte-du-llm>:<port>/v1
LLM_API_KEY=...
LLM_MODEL=<nom-du-modèle>
STT_URL=https://<hôte-stt>/v1/audio/transcriptions
SCRIBE_DICTEE_TOKEN=...
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now quest-lab && sudo systemctl reload caddy
curl https://quest.exemple.fr/health     # -> ok
```

**LLM et dictée** : s'ils ne sont joignables que sur un réseau privé (Tailscale par exemple), le VPS doit **rejoindre ce réseau** (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`).
Le Quest n'en a pas besoin : seul le bridge parle au LLM.

Pare-feu : n'ouvre que 80/443. Le bridge écoute sur 127.0.0.1 (`HOST=127.0.0.1`), derrière Caddy.

## 2. Sur chaque machine de dev

Copie le dossier `client/` (3 fichiers, aucune dépendance, Node 20+ requis), puis :

```bash
node client/install.mjs --url https://quest.exemple.fr --token <ACCESS_TOKEN> --machine nom-de-la-machine
```

- Fusionne les hooks dans `~/.claude/settings.json` (sauvegarde `.bak-questlab`), sans toucher à tes autres hooks.
- Écrit `~/.quest-lab/config.json` (droits 600).
- Relance les sessions Claude Code déjà ouvertes pour qu'elles prennent les hooks en compte.
- Retrait : `node client/install.mjs --uninstall`.
- Par défaut, le hook `PostToolUse` n'est pas installé pour une machine distante (un aller-retour réseau de plus par outil). `--post-tool` l'ajoute.

La mémoire (`~/.claude/projects/*/memory/*.md`) est envoyée au démarrage et à la fin des sessions, au plus toutes les 5 min.

## 3. Dans le Quest

`https://quest.exemple.fr/?k=<ACCESS_TOKEN>` — une fois ; le jeton est ensuite mémorisé (cookie).

## Sécurité
- Le jeton protège tout : page, événements, LLM, dictée. Traite-le comme un mot de passe ; change-le dans `.env` pour révoquer.
- Sans jeton, toute requête venant d'Internet reçoit 403 ; seuls les appels locaux directs (loopback) sont libres.
- Les événements acceptés sont validés (types, longueurs). Les sessions inactives depuis 30 min disparaissent.
