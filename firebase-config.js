// Configuration Firebase (comptes Google / GitHub).
// Ces clés sont publiques par nature : la sécurité vient des règles Firestore
// (chacun ne lit que sa propre progression, voir firestore.rules).
// Mets null pour désactiver les comptes : la progression reste alors dans le navigateur.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAoQq-x_RJ72bxQ2gZZlMfWohLmHaLldvs",
  authDomain: "flashcards-lol.firebaseapp.com",
  projectId: "flashcards-lol",
  storageBucket: "flashcards-lol.firebasestorage.app",
  messagingSenderId: "510976996536",
  appId: "1:510976996536:web:c6b23aca12ae0267eaf04d",
};

// Adresse du serveur de LoL Master (Cloudflare Worker, dossier serveur/). Tant que c'est null, le jeu tourne
// dans le navigateur comme avant. Une fois réglée, c'est le serveur qui tire les cartes et tient les collections.
window.MASTER_API = null;

