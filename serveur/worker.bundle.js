// FICHIER FABRIQUÉ par build.mjs à partir de core.js et worker.js : ne pas le modifier à la main.
// C'est ce fichier qu'on colle dans Cloudflare (Workers > Edit code).
const G = (() => {
// Règles de LoL Master côté serveur : c'est ici, et plus dans le navigateur, que se décident
// les packs, l'or, le recyclage, le marché et l'équipe. Aucun accès réseau ici : que de la logique.
// Les mêmes nombres sont affichés par master.js ; si tu en changes un, change-le aux deux endroits.
const CFG = {
  V: 2,                                   // même numéro que V dans master.js (remise à zéro des collections)
  ODDS: [68, 24, 6.5, 1.3, 0.2],          // Commune, Rare, Épique, Légendaire, Mythique
  PACK_SIZE: 5,
  EVERY: 5 * 60e3, PER: 2, CAP: 10, START: 4,
  GOLD_START: 100, GOLD_PACK: 10,
  RECYCLE: [5, 15, 60, 250, 1000],
  PITY_LEG: 50,
  MIX: { c: 33, s: 57, i: 6, r: 4 },      // champion, sort, objet, rune
  SPECIAL_EVERY: 10, SKIN_PRICE: 200,
  SKIN_ODDS: [60, 28, 9, 2.5, 0.5],
  SKIN_IN_PACK: 0.05,
  PRICE_MAX: 1e6,
  GUEST_PACKS_MAX: 20,                    // packs rendus au plus à l'inscription pour ceux ouverts en invité
};

class GameError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
const fail = (code, message) => { throw new GameError(code, message); };

const fresh = (now) => ({ v: CFG.V, gold: CFG.GOLD_START, packs: CFG.START, t: now, inv: {}, at: {}, pity: { e: 0, l: 0 }, opened: 0, team: {}, bonus: 0, guestDone: false });

// Remet un état lu dans la base dans une forme sûre (champs manquants, mauvais types)
function normalize(s, now) {
  if (!s || s.v !== CFG.V) return fresh(now);
  const int = (x, d = 0) => (Number.isFinite(x) ? Math.max(0, Math.floor(x)) : d);
  const inv = {};
  for (const [id, n] of Object.entries(s.inv || {})) if (int(n) > 0) inv[id] = int(n);
  return {
    v: CFG.V, gold: int(s.gold), packs: Math.min(CFG.CAP, int(s.packs)), t: int(s.t, now), inv,
    at: s.at && typeof s.at === "object" ? s.at : {}, pity: { e: 0, l: int(s.pity && s.pity.l) },
    opened: int(s.opened), team: s.team && typeof s.team === "object" ? s.team : {},
    bonus: int(s.bonus), guestDone: !!s.guestDone,
  };
}

// Collection d'avant le serveur (écrite par le navigateur, donc peut-être trafiquée) : reprise seulement si elle
// est possible. Un pack donne au plus 6 cartes ; l'or est plafonné. Sinon le joueur repart de zéro.
function plausible(s) {
  const cards = Object.values(s.inv).reduce((a, n) => a + n, 0);
  return cards <= s.opened * (CFG.PACK_SIZE + 1) + 10 && s.opened <= 100000;
}
const GOLD_IMPORT_MAX = 20000;

// pool : liste [id, rareté] envoyée par le site de l'administrateur. Le type se lit dans l'identifiant :
// c_ champion, s_ sort, i_ objet, r_ rune, k_ skin.
function indexPool(list) {
  const byId = new Map(), byTypeRar = {};
  for (const [id, r] of list) {
    if (typeof id !== "string" || !/^[csirk]_/.test(id) || !(r >= 0 && r <= 4)) continue;
    byId.set(id, r);
    ((byTypeRar[id[0]] ||= {})[r] ||= []).push(id);
  }
  return { byId, byTypeRar, size: byId.size };
}

function tick(s, now) {
  if (s.t > now) s.t = now;
  if (s.packs >= CFG.CAP) { s.t = now; return; }
  const n = Math.floor((now - s.t) / CFG.EVERY);
  if (n <= 0) return;
  s.packs = Math.min(CFG.CAP, s.packs + n * CFG.PER);
  s.t = s.packs >= CFG.CAP ? now : s.t + n * CFG.EVERY;
}

function pickWeighted(w, rand) {
  const entries = Object.entries(w).filter(([, v]) => v > 0);
  let x = rand() * entries.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of entries) { if ((x -= v) < 0) return k; }
  return entries[entries.length - 1][0];
}
function rollRarity(min, odds, rand) {
  const w = {};
  odds.forEach((p, i) => { if (i >= min) w[i] = p; });
  return +pickWeighted(w, rand);
}
// Une carte de ce type et de cette rareté ; si le type n'en a pas, la rareté la plus proche
function pickCard(P, type, r, taken, rand) {
  const t = P.byTypeRar[type] || {};
  for (let d = 0; d < 5; d++) {
    for (const rr of [r - d, r + d]) {
      const list = (t[rr] || []).filter((id) => !taken.has(id));
      if (list.length) return list[Math.floor(rand() * list.length)];
    }
  }
  return null;
}

function give(s, ids, now) {
  const minute = Math.floor(now / 60e3);
  return ids.map((id) => {
    const before = s.inv[id] || 0;
    s.inv[id] = before + 1;
    if (!before) s.at[id] = minute;
    return { id, isNew: !before, n: before + 1 };
  });
}

function openPack(s, P, now, rand) {
  if (!P.size) fail("no-pool", "La liste des cartes n'est pas encore en place.");
  tick(s, now);
  if (s.bonus > 0) s.bonus--; // packs rendus à l'inscription : ouverts en premier, hors du maximum
  else {
    if (s.packs <= 0) fail("no-pack", "Plus de pack pour l'instant.");
    s.packs--;
    if (s.packs === CFG.CAP - 1) s.t = now;
  }
  s.opened++;
  s.gold += CFG.GOLD_PACK;
  const special = s.opened % CFG.SPECIAL_EVERY === 0;
  const rs = [];
  for (let i = 0; i < CFG.PACK_SIZE; i++) rs.push(rollRarity(0, CFG.ODDS, rand));
  if (Math.max(...rs) < 3 && s.pity.l + 1 >= CFG.PITY_LEG) rs[CFG.PACK_SIZE - 1] = rollRarity(3, CFG.ODDS, rand);
  const taken = new Set();
  const out = [];
  for (const r of rs) {
    const surprise = rand() * 100 < CFG.SKIN_IN_PACK;
    const id = surprise ? pickCard(P, "k", rollRarity(0, CFG.SKIN_ODDS, rand), taken, rand) : pickCard(P, pickWeighted(CFG.MIX, rand), r, taken, rand);
    if (id) { taken.add(id); out.push(id); }
  }
  const top = Math.max(...out.map((id) => P.byId.get(id)));
  s.pity.l = top >= 3 ? 0 : s.pity.l + 1;
  if (special) { const k = pickCard(P, "k", rollRarity(0, CFG.SKIN_ODDS, rand), taken, rand); if (k) out.push(k); }
  return { special, cards: give(s, out, now) };
}

function buySkin(s, P, now, rand) {
  if (s.gold < CFG.SKIN_PRICE) fail("no-gold", "Pas assez d'or.");
  const k = pickCard(P, "k", rollRarity(0, CFG.SKIN_ODDS, rand), new Set(), rand);
  if (!k) fail("no-pool", "Aucun skin disponible.");
  s.gold -= CFG.SKIN_PRICE;
  return { cards: give(s, [k], now) };
}

// exemplaires pris par l'équipe : objets et runes équipés, et le champion d'un poste
function used(s, id) {
  let n = 0;
  for (const t of Object.values(s.team || {})) {
    if (!t) continue;
    for (const x of t.it || []) if (x && `i_${x}` === id) n++;
    for (const x of t.ru || []) if (x && `r_${x}` === id) n++;
    if (t.c && `c_${t.c}` === id) n++;
  }
  return n;
}
const free = (s, id) => Math.max(0, (s.inv[id] || 0) - used(s, id));

function take(s, id) {
  s.inv[id]--;
  if (!s.inv[id]) { delete s.inv[id]; delete s.at[id]; }
}

function recycle(s, P, id) {
  if (!P.byId.has(id)) fail("bad-card", "Carte inconnue.");
  if ((s.inv[id] || 0) < 2 || free(s, id) < 1) fail("no-double", "Pas de double libre à recycler.");
  take(s, id);
  const gold = CFG.RECYCLE[P.byId.get(id)];
  s.gold += gold;
  return { gold, n: 1 };
}
function recycleAll(s, P, maxR) {
  let gold = 0, n = 0;
  for (const id of Object.keys(s.inv)) {
    if (!P.byId.has(id) || P.byId.get(id) > maxR) continue;
    while ((s.inv[id] || 0) > 1 && free(s, id) > 0) { gold += recycle(s, P, id).gold; n++; }
  }
  return { gold, n };
}

// L'équipe est choisie par le joueur : on vérifie seulement qu'il possède ce qu'il équipe,
// et qu'un exemplaire ne sert qu'à un seul champion.
const ROLES = ["top", "jungle", "mid", "adc", "support"];
function setTeam(s, team) {
  if (!team || typeof team !== "object") fail("bad-team", "Équipe invalide.");
  const clean = {}, champs = new Set(), count = {};
  const str = (x) => (typeof x === "string" && x.length < 60 ? x : null);
  for (const role of ROLES) {
    const t = team[role];
    if (!t || typeof t !== "object") continue;
    const c = str(t.c);
    const out = { c: null, it: [], ru: [] };
    if (c && s.inv[`c_${c}`] && !champs.has(c)) { out.c = c; champs.add(c); }
    const slots = (list, max, prefix) => (Array.isArray(list) ? list.slice(0, max) : []).map((x) => {
      const v = str(x == null ? null : String(x));
      if (!out.c || !v) return null;
      const id = `${prefix}_${v}`;
      if ((count[id] || 0) + 1 > (s.inv[id] || 0)) return null; // pas assez d'exemplaires
      count[id] = (count[id] || 0) + 1;
      return v;
    });
    out.it = slots(t.it, 7, "i");
    out.ru = slots(t.ru, 4, "r");
    const sk = str(t.sk);
    if (out.c && sk && sk.startsWith(`k_${out.c}_`) && s.inv[sk]) out.sk = sk;
    clean[role] = out;
  }
  s.team = clean;
  return { team: clean };
}

// ---------- Marché ----------
function sell(s, P, card, price, seller, now) {
  if (!P.byId.has(card)) fail("bad-card", "Carte inconnue.");
  if (!Number.isInteger(price) || price < 1 || price > CFG.PRICE_MAX) fail("bad-price", "Prix invalide.");
  if (free(s, card) < 1) fail("not-owned", "Tu n'as pas d'exemplaire libre de cette carte.");
  take(s, card);
  return { seller: seller.uid, sellerName: seller.name, card, price, status: "open", createdAt: now };
}
function cancel(s, listing, uid, now) {
  if (!listing || listing.status !== "open") fail("gone", "Cette carte n'est plus en vente.");
  if (listing.seller !== uid) fail("not-yours", "Ce n'est pas ta vente.");
  give(s, [listing.card], now);
  return { ...listing, status: "cancelled" };
}
// buyer et sellerState sont les deux collections ; le vendeur reçoit son or tout de suite
function buy(buyer, sellerState, listing, who, now) {
  if (!listing || listing.status !== "open") fail("gone", "Trop tard : cette carte vient d'être achetée ou retirée.");
  if (listing.seller === who.uid) fail("own", "C'est ta propre vente.");
  if (buyer.gold < listing.price) fail("no-gold", "Pas assez d'or.");
  buyer.gold -= listing.price;
  sellerState.gold += listing.price;
  const cards = give(buyer, [listing.card], now);
  return { cards, listing: { ...listing, status: "sold", buyer: who.uid, buyerName: who.name, soldAt: now } };
}

// À l'inscription : les packs ouverts en invité sont rendus sous forme de packs à ouvrir (les cartes de l'invité
// viennent du navigateur, on ne peut pas leur faire confiance). Une seule fois par compte.
function grantGuest(s, opened) {
  if (s.guestDone || s.opened > 0) fail("too-late", "Déjà fait pour ce compte.");
  const n = Math.max(0, Math.min(CFG.GUEST_PACKS_MAX, Math.floor(opened) || 0));
  s.guestDone = true;
  s.bonus = n; // packs en plus du maximum habituel, à ouvrir quand on veut
  return { granted: n };
}

return { CFG, GameError, fresh, normalize, plausible, GOLD_IMPORT_MAX, indexPool, tick, openPack, buySkin, free, recycle, recycleAll, setTeam, sell, cancel, buy, grantGuest };
})();

// Serveur de LoL Master (Cloudflare Worker). Le site lui demande « ouvre un pack », « vends cette carte »… ;
// lui seul écrit les collections dans Firebase. Les règles du jeu sont dans core.js.
//
// Deux réglages secrets, à mettre dans Cloudflare (Settings > Variables and Secrets), jamais dans le dépôt :
//   SERVICE_ACCOUNT : le fichier JSON de la clé de service Firebase, collé tel quel
//   ADMIN_EMAIL     : l'adresse du compte administrateur (le seul qui peut envoyer la liste des cartes)
//                     (ou ADMIN_UID : son identifiant Firebase, si son adresse n'est pas vérifiée)

const ORIGINS = ["https://tomfro.github.io", "http://localhost:8766", "http://127.0.0.1:8766"];
const SCOPE = "https://www.googleapis.com/auth/datastore";
const JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// ---------- petits outils ----------
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
class HttpError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }

// ---------- qui appelle ? (jeton de connexion Firebase) ----------
let jwks = null, jwksAt = 0;
async function verifyIdToken(token, project) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) throw new HttpError(401, "auth", "Connecte-toi pour jouer.");
  let head, body;
  try { head = JSON.parse(new TextDecoder().decode(unb64url(parts[0]))); body = JSON.parse(new TextDecoder().decode(unb64url(parts[1]))); }
  catch { throw new HttpError(401, "auth", "Connexion invalide."); }
  if (!jwks || Date.now() - jwksAt > 3600e3 || !jwks.some((k) => k.kid === head.kid)) {
    const res = await fetch(JWKS);
    if (!res.ok) throw new HttpError(503, "auth-keys", "Vérification de la connexion impossible pour l'instant.");
    jwks = (await res.json()).keys; jwksAt = Date.now();
  }
  const jwk = jwks.find((k) => k.kid === head.kid);
  if (!jwk || head.alg !== "RS256") throw new HttpError(401, "auth", "Connexion invalide.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  const now = Date.now() / 1000;
  if (!ok || body.aud !== project || body.iss !== `https://securetoken.google.com/${project}` || !body.sub || body.exp < now || body.iat > now + 300) {
    throw new HttpError(401, "auth", "Connexion expirée : recharge la page.");
  }
  return { uid: body.sub, name: String(body.name || "Joueur").slice(0, 30), photo: String(body.picture || "").slice(0, 500),
    email: body.email_verified ? String(body.email || "").toLowerCase() : "" };
}

// ---------- accès à Firestore avec la clé de service ----------
let access = null;
async function accessToken(sa) {
  if (access && access.exp > Date.now() + 60e3) return access.token;
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${b64url(enc.encode(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 })))}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${b64url(sig)}` });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new HttpError(500, "service-account", `Clé de service refusée par Google (${data.error_description || data.error || res.status}).`);
  access = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return access.token;
}

// valeurs JavaScript <-> format de l'API Firestore
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
const toFields = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]));
function fromValue(v) {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  return null;
}
const fromFields = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fromValue(v)]));

function firestore(sa) {
  const root = `projects/${sa.project_id}/databases/(default)/documents`;
  const base = `https://firestore.googleapis.com/v1/${root}`;
  const call = async (url, init = {}) => {
    const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${await accessToken(sa)}`, "content-type": "application/json", ...(init.headers || {}) } });
    return res;
  };
  return {
    // { data, updateTime } ou null si le document n'existe pas
    async get(path) {
      const res = await call(`${base}/${path}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new HttpError(502, "firestore", `Lecture impossible (${res.status}) : ${(await res.text()).slice(0, 200)}`);
      const doc = await res.json();
      return { data: fromFields(doc.fields), updateTime: doc.updateTime };
    },
    async where(collection, field, value) {
      const res = await call(`${base}:runQuery`, { method: "POST", body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: toValue(value) } }, limit: 500 } }) });
      if (!res.ok) throw new HttpError(502, "firestore", `Recherche impossible (${res.status}).`);
      return (await res.json()).filter((r) => r.document).map((r) => ({ path: r.document.name.split("/documents/")[1], data: fromFields(r.document.fields), updateTime: r.document.updateTime }));
    },
    // writes : [{ path, data, mask?, prev }] ; prev = updateTime attendu, ou null si le document ne doit pas exister.
    // Tout passe ou rien ne passe. Renvoie false si quelqu'un a modifié un document entre-temps.
    async commit(writes) {
      const res = await call(`${base}:commit`, { method: "POST", body: JSON.stringify({ writes: writes.map((w) => ({
        update: { name: `${root}/${w.path}`, fields: toFields(w.data) },
        ...(w.mask ? { updateMask: { fieldPaths: w.mask } } : {}),
        ...(w.prev === undefined ? {} : { currentDocument: w.prev === null ? { exists: false } : { updateTime: w.prev } }),
      })) }) });
      if (res.ok) return true;
      const text = await res.text();
      if (res.status === 409 || /FAILED_PRECONDITION|ABORTED|ALREADY_EXISTS/.test(text)) return false;
      throw new HttpError(502, "firestore", `Écriture impossible (${res.status}) : ${text.slice(0, 200)}`);
    },
  };
}

// ---------- liste des cartes ----------
let poolCache = null; // { P, hash, at }
async function loadPool(db, force) {
  if (poolCache && !force && Date.now() - poolCache.at < 5 * 60e3) return poolCache;
  const doc = await db.get("config/pool");
  let list = [];
  try { list = doc ? JSON.parse(doc.data.json) : []; } catch { list = []; }
  poolCache = { P: G.indexPool(list), hash: doc ? doc.data.hash || "" : "", at: Date.now() };
  return poolCache;
}

// ---------- collection d'un joueur ----------
// Le document profiles/{uid} appartient au serveur. Au premier passage d'un joueur, on reprend
// la collection qu'il avait avant (users/{uid}.master) et l'or des ventes pas encore récupéré.
async function loadPlayer(db, P, uid, now) {
  const doc = await db.get(`profiles/${uid}`);
  const meta = { name: (doc && doc.data.name) || "", photo: (doc && doc.data.photo) || "" };
  if (doc && doc.data.srv) return { s: G.normalize(doc.data, now), prev: doc.updateTime, imported: false, extra: [], meta };
  const old = await db.get(`users/${uid}`);
  let s = G.normalize(old && old.data.master, now);
  if (P.size) for (const id of Object.keys(s.inv)) if (!P.byId.has(id)) { delete s.inv[id]; delete s.at[id]; }
  if (!G.plausible(s)) s = G.fresh(now); // collection impossible (triche) : on repart de zéro
  s.gold = Math.min(s.gold, G.GOLD_IMPORT_MAX);
  G.setTeam(s, s.team);
  const extra = [];
  for (const l of await db.where("market", "seller", uid)) {
    if (l.data.status === "sold" && l.data.claimed === false) {
      s.gold += Math.max(0, Math.floor(l.data.price) || 0);
      extra.push({ path: l.path, data: { claimed: true }, mask: ["claimed"], prev: l.updateTime });
    }
  }
  return { s, prev: doc ? doc.updateTime : null, imported: true, extra, meta };
}
function profileDoc(s, P, who) {
  const byR = [0, 0, 0, 0, 0];
  let total = 0;
  for (const [id, r] of P.byId) { if (id[0] === "k") continue; total++; if (s.inv[id]) byR[r]++; }
  return { ...s, srv: true, name: who.name, photo: who.photo, owned: byR.reduce((a, b) => a + b, 0), total, byR, updatedAt: new Date() };
}
const publicState = (s) => ({ v: s.v, gold: s.gold, packs: s.packs, t: s.t, inv: s.inv, at: s.at, pity: s.pity, opened: s.opened, team: s.team, bonus: s.bonus, guestDone: s.guestDone });

// ---------- frein : pas la peine de lire la base si on sait déjà que le joueur n'a pas de pack ----------
const wait = new Map(); // uid -> heure du prochain pack
const hits = new Map(); // uid -> [seconde, nombre]
function throttle(uid) {
  const sec = Math.floor(Date.now() / 1000), h = hits.get(uid);
  if (h && h[0] === sec) { if (++h[1] > 8) throw new HttpError(429, "slow-down", "Doucement : trop de demandes à la seconde."); }
  else hits.set(uid, [sec, 1]);
  if (hits.size > 5000) hits.clear();
  if (wait.size > 5000) wait.clear();
}

// ---------- les actions ----------
// Chaque action lit la collection, applique la règle, puis écrit si personne n'a écrit entre-temps (sinon on recommence).
async function act(db, who, change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now();
    const { P, hash } = await loadPool(db);
    const pl = await loadPlayer(db, P, who.uid, now);
    G.tick(pl.s, now);
    const before = JSON.stringify(pl.s);
    const out = (await change(pl.s, P, now)) || {};
    const writes = [...pl.extra, ...(out.writes || [])];
    // (un pseudo ou une photo qui a changé suffit à réécrire le profil)
    const changed = pl.imported || JSON.stringify(pl.s) !== before || writes.length > 0 || pl.meta.name !== who.name || pl.meta.photo !== who.photo;
    if (changed) writes.unshift({ path: `profiles/${who.uid}`, data: profileDoc(pl.s, P, who), prev: pl.prev });
    if (!changed || await db.commit(writes)) return { state: publicState(pl.s), result: out.result || null, poolHash: hash, now };
  }
  throw new HttpError(409, "busy", "Trop d'actions en même temps, réessaie.");
}

const OPS = {
  state: (db, who) => act(db, who, () => null),
  open: async (db, who) => {
    const until = wait.get(who.uid);
    if (until && Date.now() < until) throw new G.GameError("no-pack", "Plus de pack pour l'instant.");
    try {
      const r = await act(db, who, (s, P, now) => ({ result: G.openPack(s, P, now, rand) }));
      if (r.state.packs <= 0 && !r.state.bonus) wait.set(who.uid, r.state.t + G.CFG.EVERY); else wait.delete(who.uid);
      return r;
    } catch (e) {
      if (e.code === "no-pack") wait.set(who.uid, Date.now() + 5000);
      throw e;
    }
  },
  skin: (db, who) => act(db, who, (s, P, now) => ({ result: G.buySkin(s, P, now, rand) })),
  recycle: (db, who, a) => act(db, who, (s, P) => ({ result: G.recycle(s, P, String(a.id)) })),
  "recycle-all": (db, who, a) => act(db, who, (s, P) => ({ result: G.recycleAll(s, P, Math.max(0, Math.min(4, a.maxR | 0))) })),
  team: (db, who, a) => act(db, who, (s) => ({ result: G.setTeam(s, a.team) })),
  guest: (db, who, a) => { wait.delete(who.uid); return act(db, who, (s) => ({ result: G.grantGuest(s, a.opened) })); },
  sell: (db, who, a) => act(db, who, (s, P, now) => {
    const l = G.sell(s, P, String(a.card), a.price, who, now);
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    return { result: { id }, writes: [{ path: `market/${id}`, data: { ...l, createdAt: new Date(now) }, prev: null }] };
  }),
  cancel: (db, who, a) => act(db, who, async (s, P, now) => {
    const path = `market/${String(a.id).replace(/[^\w-]/g, "")}`;
    const l = await db.get(path);
    G.cancel(s, l && l.data, who.uid, now);
    return { result: {}, writes: [{ path, data: { status: "cancelled" }, mask: ["status"], prev: l.updateTime }] };
  }),
  buy: (db, who, a) => act(db, who, async (s, P, now) => {
    const path = `market/${String(a.id).replace(/[^\w-]/g, "")}`;
    const l = await db.get(path);
    if (!l) throw new G.GameError("gone", "Trop tard : cette carte vient d'être achetée ou retirée.");
    if (l.data.seller === who.uid) throw new G.GameError("own", "C'est ta propre vente.");
    const seller = await loadPlayer(db, P, l.data.seller, now);
    const r = G.buy(s, seller.s, l.data, who, now);
    // le vendeur garde son nom et sa photo : on ne touche qu'à sa collection
    const keep = { name: seller.meta.name || l.data.sellerName || "Joueur", photo: seller.meta.photo };
    return { result: { cards: r.cards }, writes: [
      ...seller.extra,
      { path: `profiles/${l.data.seller}`, data: profileDoc(seller.s, P, keep), prev: seller.prev },
      { path, data: { status: "sold", buyer: who.uid, buyerName: who.name, soldAt: new Date(now), claimed: true }, mask: ["status", "buyer", "buyerName", "soldAt", "claimed"], prev: l.updateTime },
    ] };
  }),
};

// actions réservées à l'administrateur
const ADMIN = {
  // le site de l'administrateur envoie la liste des cartes et leurs raretés (calculées dans master.js)
  pool: async (db, who, a) => {
    if (!Array.isArray(a.list) || a.list.length < 100 || a.list.length > 20000) throw new HttpError(400, "bad-pool", "Liste de cartes invalide.");
    const list = a.list.filter((x) => Array.isArray(x) && typeof x[0] === "string" && x[0].length < 80 && Number.isInteger(x[1])).map((x) => [x[0], x[1]]);
    await db.commit([{ path: "config/pool", data: { json: JSON.stringify(list), hash: String(a.hash || "").slice(0, 64), n: list.length, updatedAt: new Date() } }]);
    await loadPool(db, true);
    return { result: { n: list.length } };
  },
  // remet à zéro la collection d'un joueur (tricheur, test)
  "admin-reset": async (db, who, a) => {
    const uid = String(a.uid || "").replace(/[^\w-]/g, "");
    const old = await db.get(`profiles/${uid}`);
    if (!old) throw new HttpError(404, "no-player", "Joueur introuvable.");
    const { P } = await loadPool(db);
    await db.commit([{ path: `profiles/${uid}`, data: { ...profileDoc(G.fresh(Date.now()), P, { name: old.data.name || "Joueur", photo: old.data.photo || "" }), guestDone: true } }]);
    wait.delete(uid);
    return { result: { reset: uid } };
  },
};

function cors(request) {
  const origin = request.headers.get("origin") || "";
  return { "access-control-allow-origin": ORIGINS.includes(origin) ? origin : ORIGINS[0], "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400", vary: "origin" };
}
const json = (request, status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...cors(request) } });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    let sa = null;
    try { sa = JSON.parse(env.SERVICE_ACCOUNT || ""); } catch { /* vérifié plus bas */ }
    const ready = !!(sa && sa.project_id && sa.client_email && sa.private_key);
    try {
      // GET / : petit contrôle pour vérifier l'installation (ne montre aucun secret)
      if (request.method === "GET") {
        const check = { ok: false, service_account: ready, admin: !!(env.ADMIN_EMAIL || env.ADMIN_UID), firestore: false, cartes: 0 };
        if (ready) {
          try { const p = await loadPool(firestore(sa)); check.firestore = true; check.cartes = p.P.size; }
          catch (e) { check.erreur = e.message; }
        }
        check.ok = check.service_account && check.admin && check.firestore;
        return json(request, 200, check);
      }
      if (request.method !== "POST") return json(request, 405, { error: "method" });
      if (!ready) throw new HttpError(500, "setup", "Serveur pas encore réglé : SERVICE_ACCOUNT manque.");
      const who = await verifyIdToken((request.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), sa.project_id);
      throttle(who.uid);
      const args = await request.json().catch(() => ({}));
      const op = String(args.op || "");
      const db = firestore(sa);
      const admin = (!!env.ADMIN_EMAIL && who.email === String(env.ADMIN_EMAIL).trim().toLowerCase()) || (!!env.ADMIN_UID && who.uid === String(env.ADMIN_UID).trim());
      if (ADMIN[op]) {
        if (!admin) throw new HttpError(403, "forbidden", "Réservé à l'administrateur.");
        return json(request, 200, { ok: true, admin, ...(await ADMIN[op](db, who, args)) });
      }
      if (!OPS[op]) throw new HttpError(400, "bad-op", "Action inconnue.");
      return json(request, 200, { ok: true, admin, ...(await OPS[op](db, who, args)) });
    } catch (e) {
      if (e instanceof G.GameError) return json(request, 400, { ok: false, error: e.code, message: e.message });
      if (e instanceof HttpError) return json(request, e.status, { ok: false, error: e.code, message: e.message });
      console.error(e);
      return json(request, 500, { ok: false, error: "server", message: "Erreur du serveur." });
    }
  },
};
