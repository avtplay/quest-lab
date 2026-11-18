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

## Déployer

Voir [DEPLOY.md](DEPLOY.md) et `./deploy.sh`.

## Sécurité

- Le jeton (`ACCESS_TOKEN`) protège tout ce qui n'est pas un appel local direct : page, événements, LLM, dictée. Traite-le comme un mot de passe.
- Le hook ne bloque jamais Claude Code et n'envoie que : nom du dossier, statut, nom de l'outil, début de la demande en cours, et les fichiers de mémoire.
- Ne publie jamais `.env` ni `data/`.

## Licence

[MIT](LICENSE)
