// Comptes : connexion Google / GitHub avec Firebase, progression enregistrée dans Firestore.
// Trois modes :
//   "local" : pas de Firebase (fichier ouvert depuis le dossier, ou pas configuré) → progression dans le navigateur
//   "guest" : Firebase actif mais pas connecté → rien n'est enregistré
//   "user"  : connecté → progression dans le compte, copie dans le navigateur pour le hors ligne
//   "offline" : déjà connecté avant mais pas d'internet → progression gardée dans le navigateur,
//               envoyée au compte dès que la connexion revient
window.Account = (() => {
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
  const cfg = window.FIREBASE_CONFIG;
  const enabled = !!cfg && location.protocol.startsWith("http");
  const LAST = "flc_last_user"; // dernier compte connecté sur cet appareil, pour le mode hors ligne
  const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST)); } catch { return null; } };
  // Déjà connecté sur cet appareil : on affiche tout de suite le compte pendant que Firebase se charge
  let user = enabled ? readLast() : null;
  let mode = !enabled ? "local" : user ? "offline" : "guest";
  let restoring = mode === "offline";
  let db = null, saveTimer = null, pending = null, writes = 0, started = false;
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn(mode, user));

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = () => resolve(); s.onerror = () => { s.remove(); reject(new Error(src)); };
      document.head.appendChild(s);
    });
  }

  async function loadSdk() {
    if (!window.firebase) await loadScript(`${SDK}/firebase-app-compat.js`);
    const need = [];
    if (!firebase.auth) need.push(loadScript(`${SDK}/firebase-auth-compat.js`));
    if (!firebase.firestore) need.push(loadScript(`${SDK}/firebase-firestore-compat.js`));
    await Promise.all(need);
  }

  async function init() {
    if (!enabled || started) return;
    try {
      await loadSdk();
    } catch {
      // Pas d'internet et code de Firebase pas encore gardé : si quelqu'un s'est déjà connecté
      // sur cet appareil, on continue avec sa progression locale, sinon on reste en invité.
      const last = readLast();
      restoring = false;
      if (last) { user = last; mode = "offline"; emit(); }
      window.addEventListener("online", init, { once: true });
      return;
    }
    started = true;
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    try { firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {}); } catch {}
    firebase.auth().getRedirectResult().catch(() => {});
    firebase.auth().onAuthStateChanged(async (u) => {
      user = u;
      mode = u ? "user" : "guest";
      restoring = false;
      if (u) {
        try { localStorage.setItem(LAST, JSON.stringify({ uid: u.uid, displayName: u.displayName, email: u.email, photoURL: u.photoURL })); } catch {}
      }
      emit();
    });
  }

  async function signIn(providerName) {
    if (!enabled || !window.firebase) return;
    const provider = providerName === "github" ? new firebase.auth.GithubAuthProvider() : new firebase.auth.GoogleAuthProvider();
    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (e) {
      if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
        return firebase.auth().signInWithRedirect(provider);
      }
      if (e.code === "auth/account-exists-with-different-credential") {
        throw new Error("Cet e-mail est déjà utilisé avec l'autre méthode de connexion. Essaie l'autre bouton.");
      }
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") throw e;
    }
  }

  function signOut() {
    try { localStorage.removeItem(LAST); } catch {}
    if (window.firebase) return firebase.auth().signOut();
  }

  // Lit la progression enregistrée dans le compte (null si rien encore)
  async function load() {
    if (!user || !db) return null;
    const snap = await db.collection("users").doc(user.uid).get();
    return snap.exists ? snap.data() : null;
  }

  // Enregistre avec un petit délai pour grouper les réponses rapides
  function save(data) {
    if (!user || !db) return;
    pending = data;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const uid = user && user.uid;
      if (!uid || !pending) return;
      writes++;
      db.collection("users").doc(uid)
        .set({ ...pending, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
        .then(() => { if (--writes === 0 && !pending) localStorage.removeItem("flc_unsynced"); })
        .catch((e) => { writes--; console.error("Sauvegarde du compte impossible", e); });
      pending = null;
    }, 1500);
  }

  return {
    init, signIn, signOut, load, save,
    get mode() { return mode; },
    get user() { return user; },
    get restoring() { return restoring; },
    onChange(fn) { listeners.push(fn); },
  };
})();
