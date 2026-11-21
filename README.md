# Quest Lab

Un lieu spatial dans le Meta Quest 3 (WebXR, sans store ni APK) pour suivre ses sessions [Claude Code](https://claude.com/claude-code) et explorer leur mémoire.

- **Sessions** : chaque session Claude Code apparaît comme une carte (état, tâche en cours, machine) et comme une planète d'un orrery.
- **Mémoire** : les fichiers `~/.claude/projects/*/memory/*.md` deviennent des constellations (un amas par projet, une étoile par souvenir, des fils pour les liens `[[…]]`).
- **Assistant** : question au LLM de ton choix (API compatible OpenAI) et dictée vocale optionnelle.
- **Multi-machines** : un bridge central (VPS), un hook par machine.

```
machines (hook) ──événements + mémoire──▶ bridge Node ◀──/poll── casque Quest (page WebXR)
                                              │
                                              └─▶ LLM (chat) · service de transcription (voix)
```

Aucune dépendance npm : Node 20+ suffit.

## Essayer en local

```bash
cp .env.example .env        # renseigne au moins LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
node server.js              # affiche le jeton d'accès
node client/install.mjs --url http://localhost:8080   # branche les sessions Claude Code de cette machine
```

Ouvre `http://localhost:8080` (souris : glisser pour tourner, clic pour choisir ; espace : dictée).
Pour le casque, WebXR exige HTTPS : utilise un tunnel (par exemple `cloudflared tunnel --url http://localhost:8080`) puis ouvre `<url>/?k=<jeton>`.

## Piloter les sessions depuis le casque (optionnel, désactivé par défaut)

```bash
node client/install.mjs --control        # sur chaque machine qu'on accepte de piloter ; --no-control pour retirer
```

- **Permissions** : quand une session demande une autorisation, la carte devient rose et affiche la commande. Les boutons **Autoriser / Refuser / Terminal** décident à ta place (« Terminal » rend la main au dialogue habituel). S'il n'y a aucune page ouverte, le hook ne retarde rien. Sinon il attend 40 s au plus, puis le terminal reprend la main.
- **Consignes** : sélectionne une carte, maintiens le grip et parle. La consigne est livrée à la session au prochain outil ou à la fin du tour en cours (hooks `PostToolUse` / `Stop`). Une session inactive la reçoit à son prochain événement.
- **Conversation** : sélectionne une carte pour lire l'historique de la session (toi, Claude, outils utilisés), à faire défiler avec le stick. C'est optionnel et par machine : `node client/install.mjs --history`. Les derniers échanges (jusqu'à 60 messages) sont envoyés au bridge, qui les garde **en mémoire seulement**, jamais sur disque, et les efface à la fin de la session. Ils peuvent contenir du code ou des secrets : ne l'active que sur un bridge de confiance.
- Une carte « pilotable » l'est parce que sa machine a été installée avec `--control` ; les autres restent en lecture seule.

**Sécurité.** Qui détient le jeton peut autoriser des commandes et envoyer des consignes à tes sessions : c'est un accès à tes machines. Garde le jeton secret, sers le bridge en HTTPS uniquement, et n'active `--control` que là où tu l'acceptes. Chaque demande, décision et consigne est consignée dans `data/audit.log`.

## Lancer une session depuis le casque (optionnel)

Un petit **lanceur** à démarrer à la main sur chaque machine permet de créer une session Claude Code depuis le casque : bouton **+ Session**, puis machine, dossier, consigne de départ dictée, **Lancer**. La session apparaît comme une carte, et tes consignes suivantes arrivent directement dans son entrée, sans attendre.

```bash
claude                                              # une fois : /login, car le lanceur utilise le CLI « claude » de la machine
node client/install.mjs --runner-dir ~/projets/x    # autorise ce dossier (répétable) ; sans dossier autorisé, le lanceur refuse de démarrer
node client/runner.js                               # à laisser tourner (terminal, tmux, service…)
```

Option : `"runner": { "allowedTools": ["WebSearch", "WebFetch"] }` dans `~/.quest-lab/config.json` autorise ces outils sans demande (lecture seule) ; tout le reste passe toujours par Autoriser / Refuser. Le **modèle** se choisit avant de lancer : Défaut (celui de la machine), Sonnet, Opus ou Haiku (alias acceptés par `claude --model`).

Le lanceur n'ouvre que les dossiers que tu as listés, jamais ailleurs. Les permissions de la session passent par les boutons Autoriser / Refuser du casque ; sans réponse, une session sans terminal les refuse. Lancements, consignes et fin de session sont consignés dans `data/audit.log`. Comme les autres fonctions de pilotage, cela donne à quiconque détient le jeton un moyen d'exécuter des commandes sur la machine : garde-le secret et n'utilise que le HTTPS.

## Voix (synthèse vocale)

Le bouton `🔊 Voix` lit à voix haute les réponses de l'assistant et les nouvelles réponses de la session sélectionnée (le code, les adresses et la mise en forme sont retirés). Le navigateur du Quest n'a pas toujours de synthèse vocale : le texte passe donc par le bridge, qui le fait lire par un synthétiseur local, 100 % hors ligne ([Piper](https://github.com/OHF-Voice/piper1-gpl)).

```bash
python3 -m venv tts && tts/bin/pip install piper-tts
tts/bin/python -m piper.download_voices fr_FR-siwis-medium          # vérifie la licence de la voix que tu choisis
tts/bin/python client/tts_worker.py fr_FR-siwis-medium.onnx         # à laisser tourner sur une machine
```

Le synthétiseur se connecte au bridge (comme le lanceur, rien n'écoute chez lui) et renvoie du WAV ; il lui faut seulement `url` et `token` de `~/.quest-lab/config.json`. Sans synthétiseur, la page retombe sur la voix du navigateur si elle existe. Environ 0,3 s pour une phrase sur CPU.

## Décors et fenêtres

- **Décor** : le bouton `🌌 Décor` fait défiler les environnements (cosmos, aurore, salle blanche). Un environnement est un module `public/env-*.js` à ajouter à `ENVIRONMENTS` dans `public/env.js`.
- **Panneaux** : sessions, mémoire, console, conversations sont des panneaux qu'on déplace et redimensionne (poignée et coin). La disposition est gardée dans le navigateur du casque (`localStorage`, clé `questlab.layout`).
- **Conversations multiples** : `Épingler` détache la conversation de la session choisie dans sa propre fenêtre ; `✕` la ferme. On peut en épingler plusieurs, la dictée va à la session touchée en dernier.
- **Capture** : `📷 Capture` envoie une image de la vue au bridge (`data/shot.png`, une seule, écrasée), pour que Claude voie ce que tu vois.

## Mémoire

Dans le mode mémoire, chaque projet est un amas d'étoiles.

- **Naviguer** : touche une étiquette d'amas pour s'en rapprocher ; le bouton de remise à zéro rend la vue d'ensemble.
- **Voler** : stick gauche = avancer dans la direction du regard et se décaler ; stick droit = tourner et monter/descendre ; clic d'un stick = vitesse ×3. Sur PC : W A S D, Q / E, flèches gauche et droite, Maj pour accélérer. On reste à 9 m du centre au plus.
- **Lire** : touche une étoile pour afficher le texte complet du souvenir en Markdown, défilable.
- **Chercher** : la recherche vocale ou texte filtre les étoiles (tous les mots, sans tenir compte des accents) et estompe les autres.

## Atelier de développement

Le bouton `🛠 Atelier` ouvre des panneaux alimentés par la session sélectionnée (nécessite `--history`) :

| Panneau | Contenu |
|---|---|
| Changements | fichiers modifiés par la session (Edit / Write), avec un extrait du diff |
| Sortie | dernières commandes et leur résultat (secrets masqués) |
| Tâches | liste `TodoWrite` en kanban (à faire / en cours / fait) |
| Tableau | schémas envoyés par Claude, et dessin à main levée |

- **Schémas** : Claude affiche une architecture avec `node client/diagram.js <session> '{"title":"…","nodes":[{"id":"api","label":"API"},{"id":"db","label":"Base"}],"links":[{"from":"api","to":"db","label":"SQL"}]}'`. La mise en page est automatique, par couches.
- **Dessin** : dessine au contrôleur sur le tableau ; l'image est envoyée à la session sous la forme `[[board:<id>]]`, que le hook et l'écouteur remplacent par un PNG téléchargé dans `~/.quest-lab/boards/` (les 10 derniers sont gardés).

## Navigateur de développement (lecture seule)

Pour voir dans le casque l'application web qu'une session est en train de développer : un Chromium sans écran, sur la machine de dev, ouvre l'adresse locale et envoie ses images au bridge. Elles s'affichent dans la fenêtre `Web` de l'Atelier (sélectionne la session). WebXR ne sait pas afficher une page web dans la scène 3D : on en montre donc l'image.

```bash
node client/web.js <session> http://localhost:5173      # à laisser tourner en tâche de fond
```

- La session peut lire `~/.quest-lab/web/<session>/console.log` (console et erreurs de la page) et `latest.jpg` (dernière image) : elle voit ce que tu vois.
- Seules les adresses `localhost`, `127.0.0.1` et `[::1]` sont servies ; `--allow-host=nom` en ajoute une, `--size=1280x800` change la taille. Une navigation vers une autre adresse est refusée.
- Chromium : `CHROME_PATH`, sinon `chromium`, `google-chrome` ou le cache Playwright. Node 22+ (WebSocket intégré).
- Sur Ubuntu 24.04 le bac à sable de Chromium est parfois refusé : `QUEST_WEB_NO_SANDBOX=1` le désactive. À réserver à tes propres pages locales.
- Le bridge ne garde que la dernière image par session, en mémoire. Les images peuvent montrer des données de ton application : comme le reste, elles sont protégées par le jeton.

## Salle blanche

Chaque session a sa **salle** : une scène 3D devant toi, que Claude remplit pour expliquer ou maquetter une architecture.

```bash
node client/room.js <session> add '{"name":"api","shape":"api","pos":[0,1.4,-1.2],"label":"API","state":"ok"}'
node client/room.js <session> add '{"shape":"link","from":"api","toName":"db","label":"SQL","state":"ok"}'
node client/room.js <session> list      # renvoie aussi les positions déplacées par l'utilisateur
node client/room.js <session> remove api
node client/room.js <session> clear
```

- **Formes** : `box`, `sphere`, `cylinder`, `plane`, `text`, `arrow`, et pour le développement `db`, `api`, `server`, `queue`, `cache`, `browser`, `user`, `file`, `cloud`.
- **Liens** : `{"shape":"link","from":"a","toName":"b"}`, animés ; `state` vaut `ok`, `warn`, `error` ou `idle`.
- Positions en mètres, l'utilisateur est en `0,0,0` et regarde vers `-z`. 60 objets au plus par salle. Sans `pos`, `room.js` range les nœuds en ligne.
- L'utilisateur peut saisir et déplacer un objet au contrôleur ; sa flèche suit.
- **Persistance** : les salles sont écrites dans `data/rooms/<session>.json`, survivent aux redémarrages du bridge, et sont supprimées à la fin de la session ou après 30 jours. Les conversations, historiques et tableaux restent en mémoire seulement.
- **Isolation** : chaque salle est rangée par session, mais tous les détenteurs du jeton voient toutes les salles : ce n'est pas une frontière de sécurité.

## Déployer

Voir [DEPLOY.md](DEPLOY.md) et `./deploy.sh`.

## Sécurité

- Le jeton (`ACCESS_TOKEN`) protège tout ce qui n'est pas un appel local direct : page, événements, LLM, dictée. Traite-le comme un mot de passe.
- Le hook ne bloque jamais Claude Code et n'envoie que : nom du dossier, statut, nom de l'outil, début de la demande en cours, et les fichiers de mémoire.
- Ne publie jamais `.env` ni `data/`.

## Licence

[MIT](LICENSE)
