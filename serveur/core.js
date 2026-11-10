// Règles de LoL Master côté serveur : c'est ici, et plus dans le navigateur, que se décident
// les packs, l'or, le recyclage, le marché et l'équipe. Aucun accès réseau ici : que de la logique.
// Les mêmes nombres sont affichés par master.js ; si tu en changes un, change-le aux deux endroits.
export const CFG = {
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

export class GameError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
const fail = (code, message) => { throw new GameError(code, message); };

export const fresh = (now) => ({ v: CFG.V, gold: CFG.GOLD_START, packs: CFG.START, t: now, inv: {}, at: {}, pity: { e: 0, l: 0 }, opened: 0, team: {}, bonus: 0, guestDone: false });

// Remet un état lu dans la base dans une forme sûre (champs manquants, mauvais types)
export function normalize(s, now) {
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
export function plausible(s) {
  const cards = Object.values(s.inv).reduce((a, n) => a + n, 0);
  return cards <= s.opened * (CFG.PACK_SIZE + 1) + 10 && s.opened <= 100000;
}
export const GOLD_IMPORT_MAX = 20000;

// pool : liste [id, rareté] envoyée par le site de l'administrateur. Le type se lit dans l'identifiant :
// c_ champion, s_ sort, i_ objet, r_ rune, k_ skin.
export function indexPool(list) {
  const byId = new Map(), byTypeRar = {};
  for (const [id, r] of list) {
    if (typeof id !== "string" || !/^[csirk]_/.test(id) || !(r >= 0 && r <= 4)) continue;
    byId.set(id, r);
    ((byTypeRar[id[0]] ||= {})[r] ||= []).push(id);
  }
  return { byId, byTypeRar, size: byId.size };
}

export function tick(s, now) {
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

export function openPack(s, P, now, rand) {
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

export function buySkin(s, P, now, rand) {
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
export const free = (s, id) => Math.max(0, (s.inv[id] || 0) - used(s, id));

function take(s, id) {
  s.inv[id]--;
  if (!s.inv[id]) { delete s.inv[id]; delete s.at[id]; }
}

export function recycle(s, P, id) {
  if (!P.byId.has(id)) fail("bad-card", "Carte inconnue.");
  if ((s.inv[id] || 0) < 2 || free(s, id) < 1) fail("no-double", "Pas de double libre à recycler.");
  take(s, id);
  const gold = CFG.RECYCLE[P.byId.get(id)];
  s.gold += gold;
  return { gold, n: 1 };
}
export function recycleAll(s, P, maxR) {
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
export function setTeam(s, team) {
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
export function sell(s, P, card, price, seller, now) {
  if (!P.byId.has(card)) fail("bad-card", "Carte inconnue.");
  if (!Number.isInteger(price) || price < 1 || price > CFG.PRICE_MAX) fail("bad-price", "Prix invalide.");
  if (free(s, card) < 1) fail("not-owned", "Tu n'as pas d'exemplaire libre de cette carte.");
  take(s, card);
  return { seller: seller.uid, sellerName: seller.name, card, price, status: "open", createdAt: now };
}
export function cancel(s, listing, uid, now) {
  if (!listing || listing.status !== "open") fail("gone", "Cette carte n'est plus en vente.");
  if (listing.seller !== uid) fail("not-yours", "Ce n'est pas ta vente.");
  give(s, [listing.card], now);
  return { ...listing, status: "cancelled" };
}
// buyer et sellerState sont les deux collections ; le vendeur reçoit son or tout de suite
export function buy(buyer, sellerState, listing, who, now) {
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
export function grantGuest(s, opened) {
  if (s.guestDone || s.opened > 0) fail("too-late", "Déjà fait pour ce compte.");
  const n = Math.max(0, Math.min(CFG.GUEST_PACKS_MAX, Math.floor(opened) || 0));
  s.guestDone = true;
  s.bonus = n; // packs en plus du maximum habituel, à ouvrir quand on veut
  return { granted: n };
}
