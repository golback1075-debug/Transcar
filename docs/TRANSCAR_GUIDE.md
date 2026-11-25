# TRANSCAR — Guide Technique, Déploiement & Sauvegarde (Blida, Algérie)

## 1. Architecture Générale
TRANSCAR repose sur une architecture centralisée partagée en temps réel entre tous les postes Windows de l'agence et le site de réservation client :
- **Base de données centrale PostgreSQL** (Cloud SQL / PostgreSQL 15+) gérée via Drizzle ORM (`src/db/schema.ts`).
- **Serveur API & Synchronisation Express** (`server.ts`, port `3000`) exposant :
  - L'API d'administration sécurisée par jetons signés HMAC (`Authorization: Bearer`).
  - Les routes publiques du site de réservation client (`/book` · `/api/public/*`).
  - Le flux temps réel **Server-Sent Events** (`/api/events`) assurant la synchronisation instantanée entre plusieurs ordinateurs.
  - Le stockage protégé hors répertoire public (`./storage/uploads/{vehicles,documents,licences}` et `./storage/backups`).
- **Application Bureautique Windows (Electron)** (`electron/main.cjs`, `electron/preload.cjs`) empaquetée via `electron-builder.yml` sous forme d'installeur Windows `TRANSCAR-Setup.exe`.

---

## 2. Sécurité & Contrôle d'Accès (RBAC)
- Connexion sans nom d'utilisateur : sélection implicite du rôle par code secret haché (`scrypt` + sel aléatoire en base `agency_roles`).
  - **Gérant** (code initial configuré lors de l'initialisation) : accès complet à tous les modules, finances, caisse, rapports PDF/Excel, gestion des mots de passe, historique d'audit, publication des conditions et sauvegardes/restaurations.
  - **Employé** : accès opérationnel (Parc, Réservations, Contrats, Clients, Retours, Maintenance, Notifications opérationnelles). Les routes financières, paramètres, mots de passe et sauvegardes sont bloquées côté serveur (`HTTP 403`).
- Tous les documents sensibles (permis recto/verso, assurance, contrôle technique, sauvegardes ZIP) sont servis uniquement via des routes authentifiées.

---

## 3. Règles Métier Implémentées
1. **Zéro donnée initiale fictive** : au premier démarrage, le parc, les clients, les réservations, les contrats, la caisse, la maintenance et les notifications sont strictement à `0`.
2. **Conditions officielles (10 Articles)** : les 10 articles officiels en arabe (+ traductions FR/EN) sont initialisés en version `1.0` et synchronisés avec le site de réservation client.
3. **Retours véhicules** :
   - **Art. 01 (Retard)** : 3h de tolérance ; `> 3h à 6h` = `+0,5 jour` ; `> 6h` = `+1 jour`.
   - **Art. 02 (Kilométrage)** : `350 km / 24h` ; chaque km supplémentaire = `50 DZD/km`.
4. **Maintenance préventive** : seuils automatiques à `10 000 km` (Graissage), `25 000 km` (Bougies) et `50 000 km` (Kit chaîne) + verrouillage automatique du véhicule en statut *En maintenance*.
5. **Surveillance documentaire** : alertes automatiques sans doublon à `30 j`, `15 j`, `7 j`, `0 j` et documents expirés (toutes les 15 minutes + au démarrage).

---

## 4. Packaging Windows (`TRANSCAR-Setup.exe`)
Sur une machine Windows 10/11 (ou Linux avec Wine + NSIS) disposant des dépendances `electron` et `electron-builder` :
```bash
npm install
npm install -D electron electron-builder
npm run electron:build
```
L'installeur généré se trouve dans `dist-electron/TRANSCAR-Setup.exe` avec :
- Raccourci Bureau & Menu Démarrer (`TRANSCAR`)
- Icône personnalisée (`electron/icon.png`)
- Conservation des données lors de la mise à jour ou désinstallation (`deleteAppDataOnUninstall: false`)

Pour connecter plusieurs ordinateurs Windows de l'agence au même serveur central, définir la variable d'environnement `TRANSCAR_SERVER_URL=http://<IP-SERVEUR>:3000` et `TRANSCAR_REMOTE_ONLY=true`.

---

## 5. Sauvegarde & Restauration
- **Automatique** : tâche planifiée quotidienne à `02h00` (heure d'Alger) créant une archive `.zip` dans `./storage/backups/` contenant `database.json` + tous les fichiers téléversés (`uploads/`).
- **Manuelle** : dans *Sauvegardes & Paramètres* (Mode Gérant), cliquer sur *Créer une sauvegarde*, *Télécharger*, ou *Restaurer (.zip)* pour rétablir intégralement la base PostgreSQL et les fichiers associés.
