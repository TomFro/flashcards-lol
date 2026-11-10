# Installer le serveur de LoL Master (gratuit, environ 10 minutes)

Avant, c'était le navigateur qui tirait les cartes et enregistrait la collection : n'importe qui pouvait
se donner toutes les cartes depuis la console. Maintenant c'est un petit serveur (Cloudflare Worker) qui
décide : les packs, l'or, le recyclage, le marché et l'équipe. Ouvrir des packs avec un bot reste possible,
mais au même rythme que tout le monde (2 packs toutes les 5 minutes).

Tant que l'étape 5 n'est pas faite, le site marche comme avant.

## 1. La clé de service Firebase (à ne montrer à personne)
1. Console Firebase, projet **flashcards-lol**, roue dentée > **Paramètres du projet** > onglet **Comptes de service**.
2. Bouton **Générer une nouvelle clé privée**. Un fichier `.json` se télécharge.
3. Ce fichier donne tous les droits sur la base : ne l'envoie à personne (même pas à Claude), ne le mets pas dans le dépôt.

## 2. Créer le Worker sur Cloudflare
1. Crée un compte gratuit sur https://dash.cloudflare.com (pas besoin de carte bancaire).
2. Menu **Workers & Pages** (ou **Compute > Workers**) > **Create** > **Start with Hello World** > nom : `lol-master` > **Deploy**.
3. Bouton **Edit code**. Efface tout le code, colle à la place tout le contenu de
   https://raw.githubusercontent.com/TomFro/flashcards-lol/main/serveur/worker.bundle.js
   puis **Deploy**.

## 3. Les deux réglages secrets
Dans le Worker : **Settings** > **Variables and Secrets** > **Add**, type **Secret** :
- `SERVICE_ACCOUNT` : colle tout le contenu du fichier `.json` de l'étape 1 (de `{` jusqu'à `}`).
- `ADMIN_EMAIL` : l'adresse e-mail de ton compte sur le site, si tu te connectes avec Google.
  Si tu te connectes avec GitHub ou par e-mail, mets plutôt `ADMIN_UID` : ton identifiant, dans la console
  Firebase > **Authentication** > ta ligne > colonne **UID utilisateur**.

Ce compte administrateur est le seul qui peut envoyer au serveur la liste des cartes et leurs raretés.

## 4. Vérifier
Ouvre l'adresse du Worker (du genre `https://lol-master.ton-nom.workers.dev`). Tu dois voir :
`{"ok":true,"service_account":true,"admin":true,"firestore":true,"cartes":0}`
- `service_account:false` : le secret SERVICE_ACCOUNT manque ou n'est pas le fichier entier.
- `firestore:false` : la clé est refusée, regarde le message `erreur`.

## 5. Brancher le site
Envoie l'adresse du Worker à Claude (elle n'est pas secrète), ou mets-la toi-même dans `firebase-config.js` :
`window.MASTER_API = "https://lol-master.ton-nom.workers.dev";`

Ensuite, ouvre LoL Master **connecté avec le compte administrateur** : un message
« Liste des cartes envoyée au serveur » apparaît. L'adresse du Worker affiche alors `"cartes":` avec un nombre.
(Le site renvoie la liste tout seul quand Riot ajoute des champions ou des skins, à ta prochaine visite.)

## 6. Fermer la porte : les nouvelles règles Firebase
Console Firebase > **Firestore Database** > onglet **Règles** : remplace tout par le contenu du fichier
`firestore.rules.serveur` du dépôt, puis **Publier**. Sans ça, l'ancien chemin reste ouvert aux tricheurs.

## Ce qui change pour les joueurs
- Chacun garde sa collection : le serveur la reprend au premier passage (une collection impossible,
  plus de cartes que de packs ouverts, repart de zéro ; l'or repris est plafonné à 20 000).
- L'or des ventes arrive tout de suite chez le vendeur.
- En invité, on joue toujours dans le navigateur. À l'inscription, les packs ouverts en invité
  (20 au plus) sont rendus à rouvrir sur le compte, au lieu de recopier des cartes non vérifiables.
- Il faut internet pour ouvrir un pack quand on est connecté.

## Remettre à zéro un tricheur
Depuis le site, connecté en administrateur, dans la console du navigateur (F12) :
`fetch(MASTER_API, {method:"POST", headers:{authorization:"Bearer " + await Account.token()}, body: JSON.stringify({op:"admin-reset", uid:"SON_UID"})}).then(r => r.json())`
