# Quest Lab

Lieu spatial WebXR pour le Meta Quest 3 : suivre ses sessions Claude Code et explorer leur mémoire. Architecture, essai
en local et options : `README.md` ; déploiement : `DEPLOY.md` et `deploy.sh`.

## Règles

- **Dépôt public** : ni secret, ni nom d'hôte, ni donnée personnelle dans le code, les commentaires ou les messages de commit.
- **Zéro dépendance npm** (Node 20+ seul). WebXR exige HTTPS en dehors de `localhost`.
- Le bridge garde l'historique des sessions **en mémoire seulement** : après un redéploiement, rejouer le hook `Stop`.
- La vue Mémoire lit `~/.claude/projects/*/memory/*.md` : garder le frontmatter et les liens `[[…]]` intacts, sinon la constellation casse.
