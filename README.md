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

Le lanceur n'ouvre que les dossiers que tu as listés, jamais ailleurs. Les permissions de la session passent par les boutons Autoriser / Refuser du casque ; sans réponse, une session sans terminal les refuse. Lancements, consignes et fin de session sont consignés dans `data/audit.log`. Comme les autres fonctions de pilotage, cela donne à quiconque détient le jeton un moyen d'exécuter des commandes sur la machine : garde-le secret et n'utilise que le HTTPS.

## Déployer

Voir [DEPLOY.md](DEPLOY.md) et `./deploy.sh`.

## Sécurité

- Le jeton (`ACCESS_TOKEN`) protège tout ce qui n'est pas un appel local direct : page, événements, LLM, dictée. Traite-le comme un mot de passe.
- Le hook ne bloque jamais Claude Code et n'envoie que : nom du dossier, statut, nom de l'outil, début de la demande en cours, et les fichiers de mémoire.
- Ne publie jamais `.env` ni `data/`.

## Licence

[MIT](LICENSE)
