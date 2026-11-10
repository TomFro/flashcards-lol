// Serveur de LoL Master (Cloudflare Worker). Le site lui demande « ouvre un pack », « vends cette carte »… ;
// lui seul écrit les collections dans Firebase. Les règles du jeu sont dans core.js.
//
// Deux réglages secrets, à mettre dans Cloudflare (Settings > Variables and Secrets), jamais dans le dépôt :
//   SERVICE_ACCOUNT : le fichier JSON de la clé de service Firebase, collé tel quel
//   ADMIN_EMAIL     : l'adresse du compte administrateur (le seul qui peut envoyer la liste des cartes)
//                     (ou ADMIN_UID : son identifiant Firebase, si son adresse n'est pas vérifiée)
import * as G from "./core.js";

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
