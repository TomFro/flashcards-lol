// Service worker : garde le site et les données téléchargées pour jouer hors ligne.
const SHELL = "flc-shell-v20";
const DATA = "flc-data";
const SHELL_FILES = ["./", "index.html", "style.css", "app.js", "descriptions.js", "runes-desc.js", "items-desc.js", "matchups.js", "master.js", "master-rarity.js", "favicon.svg", "favicon-32.png", "apple-touch-icon.png", "account.js", "firebase-config.js", "sons/commune.mp3", "sons/rare.mp3", "sons/epique.mp3", "sons/legendaire.mp3", "sons/mythique.mp3"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Réseau d'abord, copie de secours dans le cache
// cache: "no-cache" = on redemande toujours au serveur s'il y a une nouvelle version (sinon le navigateur
// peut garder un vieux fichier jusqu'à 10 min sur GitHub Pages)
function networkFirst(req, cacheName, fresh) {
  const r = !fresh ? req : req.mode === "navigate" ? new Request(req.url, { cache: "no-cache" }) : new Request(req, { cache: "no-cache" });
  return fetch(r)
    .then((res) => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(cacheName).then((c) => c.put(req, copy)); }
      return res;
    })
    .catch(() => caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || Response.error()));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Fichiers du site : toujours la dernière version si internet est là
  if (url.origin === location.origin) return e.respondWith(networkFirst(req, SHELL, true));
  // Connexion et base de données des comptes : jamais en cache
  if (/(^|\.)(firestore|identitytoolkit|securetoken)\.googleapis\.com$|firebaseapp\.com$/.test(url.hostname)) return;
  // Code de Firebase : gardé pour pouvoir s'ouvrir hors ligne
  if (url.hostname === "www.gstatic.com") return e.respondWith(networkFirst(req, DATA));
  // Numéro du dernier patch : réseau d'abord pour voir les mises à jour
  if (url.pathname.endsWith("/api/versions.json")) return e.respondWith(networkFirst(req, DATA));
  // Polices Google : on les garde au passage
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return e.respondWith(networkFirst(req, DATA));
  // Données de Riot / Meraki / vidéos : le cache d'abord (téléchargé avec les boutons du site)
  e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req)));
});
