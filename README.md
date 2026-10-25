# RTA — site public et espaces du personnel

Code source non déployé. Python 3.10+ et Firebase Firestore. Aucun secret fourni.

## Installation

1. Créer un projet Firebase et une base Firestore en mode natif.
2. Déployer `firestore.rules` : le navigateur ne doit jamais écrire directement. Le serveur utilise Firebase Admin, qui contourne ces règles ; ses permissions IAM sont à limiter au projet RTA.
3. Installer : `python -m pip install -r requirements.txt`.
4. Dans Firebase > Paramètres du projet > Comptes de service, générer une clé privée. Conserver ce JSON hors du dossier du site et hors Git.
5. Définir les variables d’environnement :
   - `GOOGLE_APPLICATION_CREDENTIALS` : chemin absolu du JSON du compte de service.
   - `DISCORD_CLIENT_SECRET` : secret OAuth2 de l’application Discord 1563822065965076541.
   - `BASE_URL` : `http://localhost:8000` en local, puis l’origine HTTPS publique en production.
   - `DISCORD_WEBHOOK_URL` : facultatif ; un webhook vers un salon privé de direction. Son secret reste côté serveur.
6. Dans Discord Developer Portal > OAuth2 > Redirects, ajouter exactement `http://localhost:8000/auth/callback` pour les essais, puis `https://VOTRE-DOMAINE/auth/callback` en production.
7. Démarrer : `python server.py`. Ouvrir http://localhost:8000.

Les rôles et le serveur Discord fournis sont déjà intégrés dans server.py. OAuth demande identify et guilds.members.read ; aucun token de bot n’est nécessaire. Les contrôles sont effectués côté serveur, pas uniquement dans l’interface. La connexion expire après une heure ; un changement de rôle est pris en compte à la reconnexion.

## Fonctionnalités incluses

Site public : identité RTA, ligne 1 et ses neuf arrêts, état calculé selon les services actifs, tarifs 3/6 €, achat en station, informations trafic, liens Discord recrutement/contact/objets perdus. Le Master ne rend pas la ligne 1 active.

Personnel : service avec sélection d’un véhicule disponible, fin et historique des services, flotte, immobilisation/remise en circulation par mécanique/direction, rapports d’incidents et d’intervention, planning et consignes en publications textuelles, messagerie commune. Le Master est réservé aux mécaniciens et à la direction ; les véhicules commerciaux aux chauffeurs et à la direction.

Amendes : création par contrôleurs/direction avec identité et téléphone RP, montant, motif et date de remise ; paiement par direction uniquement. Grille publique publiée par direction. Notifications génériques de service, rapports et amendes vers un seul webhook, sans identité de voyageur.

## Limites à connaître

Les délais et pourcentages de majoration ne sont pas renseignés : aucun calcul automatique inventé. À définir avant activation. Le planning et la grille sont actuellement des publications textuelles ; pas d’éditeur de créneaux ni de barème structuré. La messagerie est commune au personnel et se rafraîchit à l’ouverture de l’onglet. Les pannes sont consignées dans les rapports et le suivi d’immobilisation ; pas encore de tickets de réparation avec statuts. La modification des lignes/horaires/tarifs de transport est dans le code, pas encore dans un éditeur direction. Pas de gestion des comptes Discord depuis le site : utiliser les rôles du serveur.

Le serveur HTTP standard fourni est destiné aux essais. Avant production, utiliser un serveur adapté derrière HTTPS, limiter les requêtes, ajouter une journalisation d’audit, revérifier les rôles régulièrement et sécuriser les affectations concurrentes par transaction Firestore (les vérifications actuelles ne sont pas atomiques). Les sessions sont en mémoire : un redémarrage déconnecte le personnel. Les erreurs webhook ne bloquent pas les enregistrements et ne sont pas encore présentées dans une file de reprise.

Ne pas héberger ce projet sur GitHub Pages seul : la connexion Discord et Firebase Admin nécessitent un serveur Python. Ne jamais placer le compte de service, le Client Secret ou le webhook dans public/.
