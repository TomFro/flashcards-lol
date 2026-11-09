// Flashcards LoL : lit les données de Riot (en local si mise-a-jour.bat a été lancé,
// sinon sur internet) puis fait tourner les cartes.
const DD = "https://ddragon.leagueoflegends.com";
const VIDEO = "https://d28xe8vt774jo5.cloudfront.net/champion-abilities";
// Icônes de lane dessinées à la main (style mini-carte)
const svg = (d) => `<svg viewBox="0 0 24 24" fill="currentColor">${d}</svg>`;
const FAINT = 'opacity=".3"';
const LANES = {
  top: svg(`<path d="M3 3h15l-4 4H7v7l-4 4z"/><path ${FAINT} d="M10 10h4v4h-4zM21 6v15H6l4-4h7v-7z"/>`) + "Top",
  jungle: svg(`<path d="M6 3c3 4 4 9 2 18l-2-1c1-6 1-11-2-15zM12 2c2 5 2 11 0 20h-2c2-8 2-13 0-19zM18 3c2 4 2 9-1 17l-2-1c2-6 3-11 1-15z"/>`) + "Jungle",
  mid: svg(`<path d="M17 3h4v4L7 21H3v-4z"/><path ${FAINT} d="M3 3h9l-3 3H6v3l-3 3zM21 21h-9l3-3h3v-3l3-3z"/>`) + "Mid",
  adc: svg(`<path d="M21 21H6l4-4h7v-7l4-4z"/><path ${FAINT} d="M10 10h4v4h-4zM3 18V3h15l-4 4H7v7z"/>`) + "ADC",
  support: svg(`<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5zm-1.5 5v3.5H7v3h3.5V17h3v-3.5H17v-3h-3.5V7z"/>`) + "Support",
};
const CLASSES = { Assassin: "Assassin", Fighter: "Combattant", Mage: "Mage", Marksman: "Tireur", Support: "Support", Tank: "Tank" };
const KEYS = ["P", "Q", "W", "E", "R"];
const KEY_LABEL = { P: "Passif", Q: "Q", W: "W", E: "E", R: "R" };

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const progress = store.get("flc_progress", {});   // id de carte -> boîte 0..5
const custom = store.get("flc_custom", {});       // id de carte -> description modifiée
const isGuest = () => window.Account && Account.mode === "guest";
// Onglet Vidéos + un champion tapé dans la recherche : on revoit toutes ses vidéos dans l'ordre, sans deviner
const studyMode = () => prefs.mode === "video" && $("f-search").value.trim() !== "";
let studyIdx = -1;
const isOnlineUser = () => window.Account && (Account.mode === "user" || Account.mode === "offline");
function replaceObj(o, n) { for (const k of Object.keys(o)) delete o[k]; Object.assign(o, n || {}); }
// Enregistre la progression : navigateur (+ compte si connecté). Rien pour un invité.
// Hors ligne, le navigateur garde tout et le compte est mis à jour au retour d'internet.
function persist() {
  if (isGuest()) return;
  store.set("flc_progress", progress);
  store.set("flc_custom", custom);
  if (isOnlineUser()) store.set("flc_unsynced", true);
  if (Account.mode === "user") Account.save({ progress, custom, master: Master.state });
}
const prefs = Object.assign(
  { mode: "champ", all: true, lane: [], cls: [], key: [], tree: [], slot: [], itype: ["legendary", "boots"], irole: [], icon: false, name: false, learn: "discover" },
  store.get("flc_prefs", {}));
// v2 : "tous les sorts d'un coup" devient le mode par défaut, même pour les réglages déjà enregistrés
// lien direct vers la page LoL Master : …/flashcards-lol/#master
if (location.hash === "#master") prefs.mode = "master";
if (prefs.v !== 2) { prefs.all = true; prefs.v = 2; store.set("flc_prefs", prefs); }

let version = "", local = false;
let cards = { champ: [], champAll: [], video: [], rune: [], item: [] };
let deck = [], current = null, lastId = null;
const champRaw = {}; // données officielles complètes de chaque champion, pour la fiche détaillée
const brokenVideos = new Set(); // vidéos introuvables, on ne les propose plus pendant la session
const $ = (id) => document.getElementById(id);

// Chemins des fichiers : dossier data\ si on est hors ligne, sinon serveurs de Riot.
const url = {
  loading: (id) => local ? `data/img/loading/${id}_0.jpg` : `${DD}/cdn/img/champion/loading/${id}_0.jpg`,
  spell: (f) => local ? `data/img/spell/${f}` : `${DD}/cdn/${version}/img/spell/${f}`,
  passive: (f) => local ? `data/img/passive/${f}` : `${DD}/cdn/${version}/img/passive/${f}`,
  rune: (icon) => local ? `data/img/runes/${icon}` : `${DD}/cdn/img/${icon}`,
  square: (id) => local ? `data/img/champion/${id}.png` : `${DD}/cdn/${version}/img/champion/${id}.png`,
  item: (f) => local ? `data/img/item/${f}` : `${DD}/cdn/${version}/img/item/${f}`,
  videoLocal: (k, s) => `data/videos/${k}_${s}.webm`,
  videoOnline: (k, s) => `${VIDEO}/${k}/ability_${k}_${s}1.webm`,
};

function clean(html) {
  const div = document.createElement("div");
  div.innerHTML = (html || "").replace(/<br\s*\/?>/gi, " ");
  return div.textContent.replace(/\s+/g, " ").trim();
}
function shorten(text) {
  const first = text.split(/(?<=[.!?])\s/)[0];
  return first.length > 140 ? first.slice(0, 137) + "…" : first;
}

async function getData() {
  if (window.DD_DATA) {
    local = true;
    version = window.DD_DATA.version;
    const d = window.DD_DATA;
    // anciens fichiers sans objets : on va chercher les objets en ligne
    const items = d.items || await fetch(`${DD}/cdn/${version}/data/fr_FR/item.json`).then((r) => r.json()).catch(() => ({ data: {} }));
    return [d.champions, d.runes, items];
  }
  const versions = await (await fetch(`${DD}/api/versions.json`)).json();
  version = versions[0];
  return Promise.all([
    fetch(`${DD}/cdn/${version}/data/fr_FR/championFull.json`).then((r) => r.json()),
    fetch(`${DD}/cdn/${version}/data/fr_FR/runesReforged.json`).then((r) => r.json()).catch(() => []),
    fetch(`${DD}/cdn/${version}/data/fr_FR/item.json`).then((r) => r.json()).catch(() => ({ data: {} })),
  ]);
}

// En local, on regarde quand même si un nouveau patch est sorti (si internet est là).
async function checkUpdate() {
  if (!local) {
    if (location.protocol !== "file:") return; // version en ligne (GitHub Pages) : rien à signaler
    $("banner").textContent = "Mode en ligne. Pour jouer hors ligne, double-clique sur mise-a-jour.bat dans le dossier du site.";
    $("banner").classList.remove("hidden");
    return;
  }
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    const latest = (await (await fetch(`${DD}/api/versions.json`, { signal: ctrl.signal })).json())[0];
    if (latest !== version) {
      $("banner").textContent = `Nouveau patch ${latest} disponible (tu as le ${version}). Double-clique sur mise-a-jour.bat pour mettre à jour.`;
      $("banner").classList.remove("hidden");
    }
  } catch { /* hors ligne : rien à signaler */ }
}

// Cooldown par rang du sort, ex. [12, 11, 10, 9, 8]
function cooldowns(s) {
  if (!s || !s.cooldownBurn || s.cooldownBurn === "0") return [];
  return s.cooldownBurn.split("/");
}

async function load() {
  const [champs, runes, items] = await getData();
  buildItems(items);

  for (const c of Object.values(champs.data)) {
    champRaw[c.id] = c;
    const d = window.CHAMP_DESC[c.id] || {};
    const lanes = d.lanes || [];
    const vkey = String(c.key).padStart(4, "0");
    const spells = [
      { key: "P", name: c.passive.name, desc: c.passive.description, icon: url.passive(c.passive.image.full), cd: [] },
      ...c.spells.map((s, i) => ({ key: "QWER"[i], name: s.name, desc: s.description, icon: url.spell(s.image.full), cd: cooldowns(s) })),
    ];
    cards.champAll.push({
      id: `${c.id}_ALL`, type: "champ", all: true, champ: c.name, champId: c.id, lanes, tags: c.tags, key: "ALL",
      img: url.loading(c.id), official: "", short: "", name: c.name, icon: url.loading(c.id),
      spells: spells.map((s) => ({ key: s.key, name: s.name, icon: s.icon, cd: s.cd, short: d[s.key] || shorten(clean(s.desc)) })),
    });
    for (const s of spells) {
      const official = clean(s.desc);
      const base = {
        type: "champ", champ: c.name, champId: c.id, lanes, tags: c.tags,
        key: s.key, name: s.name, icon: s.icon, official, cd: s.cd,
        short: d[s.key] || shorten(official), img: url.loading(c.id),
      };
      cards.champ.push({ ...base, id: `${c.id}_${s.key}` });
      if (s.key !== "P") cards.video.push({ // pas de passif en vidéo : seulement les vrais sorts
        ...base, type: "video", id: `vid_${c.id}_${s.key}`,
        videos: [local && url.videoLocal(vkey, s.key), url.videoOnline(vkey, s.key)].filter(Boolean),
      });
    }
  }

  for (const tree of runes) {
    tree.slots.forEach((slot, i) => {
      for (const r of slot.runes) {
        cards.rune.push({
          id: `rune_${r.key}`, rid: r.id, type: "rune", tree: tree.name, slot: i === 0 ? "keystone" : "minor",
          name: r.name, icon: url.rune(r.icon), img: url.rune(r.icon), official: clean(r.longDesc || r.shortDesc),
          short: window.RUNE_DESC[r.key] || shorten(clean(r.shortDesc)),
        });
      }
    });
  }
  window._trees = runes.map((t) => t.name);
}

// ---------- Objets ----------
const ROLES = { adc: "Tireurs", assassin: "Assassins", fighter: "Combattants", mage: "Mages", tank: "Tanks", support: "Supports" };
const ITYPES = { legendary: "Légendaires", boots: "Bottes", epic: "Composants" };

// Profil deviné à partir des stats de l'objet, quand on n'a pas écrit de description
function guessRoles(t) {
  const has = (x) => t.includes(x);
  const r = new Set();
  if (has("CriticalStrike")) r.add("adc");
  if (has("Damage") && has("AttackSpeed") && !has("CriticalStrike")) { r.add("adc"); r.add("fighter"); }
  if (has("ArmorPenetration") && !has("Health")) r.add("assassin");
  if (has("Damage") && has("Health")) r.add("fighter");
  if (has("Damage") && r.size === 0) r.add("fighter");
  if (has("SpellDamage")) r.add("mage");
  if ((has("Armor") || has("SpellBlock") || has("Health")) && !has("Damage") && !has("SpellDamage")) r.add("tank");
  if (has("GoldPer") || (has("ManaRegen") && has("Aura"))) r.add("support");
  return [...r];
}

// Première phrase du premier effet de l'objet (texte officiel), pour les objets sans description écrite
function firstEffect(html) {
  const m = /<(?:passive|active)>([\s\S]*?)<\/(?:passive|active)>\s*(?:<br\s*\/?>)?([\s\S]*?)(?:<br|<\/mainText>|$)/.exec(html || "");
  if (!m) return "";
  const text = shorten(clean(m[2]));
  return text ? `${clean(m[1])} : ${text}` : "";
}

function buildItems(items) {
  const seen = new Set();
  const list = Object.entries(items.data || {})
    .filter(([id, it]) => it.maps && it.maps["11"] && it.gold && it.gold.purchasable && !it.requiredChampion && !it.requiredAlly
      && it.inStore !== false && !(it.tags || []).some((t) => t === "Consumable" || t === "Trinket") && +id < 10000)
    .sort((a, b) => +a[0] - +b[0]);
  for (const [id, it] of list) {
    if (seen.has(it.name)) continue;
    seen.add(it.name);
    const tags = it.tags || [];
    const final = !it.into || it.into.length === 0;
    let itype = null;
    if (tags.includes("Boots") && it.from && it.from.length) itype = "boots";
    else if (final && it.gold.total >= 2000) itype = "legendary";
    else if (it.from && it.from.length && it.into && it.into.length) itype = "epic";
    if (!itype) continue;
    const desc = window.ITEM_DESC[id] || {};
    const statsHtml = (/<stats>([\s\S]*?)<\/stats>/.exec(it.description || "") || [])[1] || "";
    const stats = statsHtml.split(/<br\s*\/?>/i).map(clean).filter(Boolean);
    const effects = [...(it.description || "").matchAll(/<(passive|active)>([\s\S]*?)<\/\1>/g)].map((m) => clean(m[2])).filter(Boolean);
    const roles = desc.who ? desc.who.split(" ") : guessRoles(tags);
    // bottes : 2 = bottes de base améliorées une fois, 3 = bottes améliorées (T3)
    const isT2 = (fid) => { const f = (items.data || {})[fid]; return f && (f.tags || []).includes("Boots") && f.from && f.from.length; };
    const btier = itype === "boots" ? (it.from.some(isT2) ? 3 : 2) : 0;
    cards.item.push({
      id: `item_${id}`, type: "item", itype, btier, bfrom: btier === 3 ? it.from.find(isT2) : null, name: it.name, icon: url.item(it.image.full), img: url.item(it.image.full),
      gold: it.gold.total, stats, roles, note: desc.note || "",
      short: desc.d || clean(it.plaintext) || firstEffect(it.description) || (effects.length ? `Effets : ${[...new Set(effects)].join(", ")}` : "Objet de stats"),
      official: clean((it.description || "").replace(/<br\s*\/?>/gi, " · ")),
    });
  }
}

function chips(el, options, prefKey) {
  el.innerHTML = "";
  for (const [val, label] of Object.entries(options)) {
    const b = document.createElement("button");
    b.innerHTML = label;
    b.classList.toggle("on", prefs[prefKey].includes(val));
    b.onclick = () => {
      const list = prefs[prefKey];
      const i = list.indexOf(val);
      i >= 0 ? list.splice(i, 1) : list.push(val);
      b.classList.toggle("on");
      saveAndRebuild();
    };
    el.appendChild(b);
  }
}

function buildFilters() {
  chips($("f-lane"), LANES, "lane");
  chips($("f-class"), CLASSES, "cls");
  chips($("f-key"), Object.fromEntries(KEYS.map((k) => [k, KEY_LABEL[k]])), "key");
  chips($("f-tree"), Object.fromEntries(window._trees.map((t) => [t, t])), "tree");
  chips($("f-slot"), { keystone: "Runes principales", minor: "Runes secondaires" }, "slot");
  chips($("f-itype"), ITYPES, "itype");
  chips($("f-irole"), ROLES, "irole");
  $("o-icon").checked = prefs.icon;
  $("o-name").checked = prefs.name;
  $("o-all").checked = prefs.all;
  $("o-all").onchange = (e) => { prefs.all = e.target.checked; saveAndRebuild(); };
  $("o-name").onchange = (e) => { prefs.name = e.target.checked; store.set("flc_prefs", prefs); show(); };
  $("o-icon").onchange = (e) => { prefs.icon = e.target.checked; store.set("flc_prefs", prefs); show(); };
  // Découverte : seulement des cartes jamais vues / Révision : les cartes déjà notées, celles à revoir d'abord
  document.querySelectorAll("#learnmode button").forEach((b) => (b.onclick = () => setLearn(b.dataset.m)));
  $("b-switch").onclick = () => setLearn(prefs.learn === "discover" ? "review" : "discover");
  $("f-search").oninput = () => rebuild();
  // Entrée : quitte la recherche pour pouvoir utiliser les touches P A Z E R tout de suite
  $("f-search").onkeydown = (e) => { if (e.key === "Enter" || e.key === "Escape") e.target.blur(); };
  document.querySelectorAll("#modes button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === prefs.mode);
    b.onclick = () => {
      prefs.mode = b.dataset.mode;
      document.querySelectorAll("#modes button").forEach((x) => x.classList.toggle("on", x === b));
      saveAndRebuild();
    };
  });
}

function saveAndRebuild() { store.set("flc_prefs", prefs); rebuild(); }

function rebuild() {
  ahead = false;
  if (prefs.mode === "master") { // page LoL Master : packs et collection
    document.body.className = `mode-master${isGuest() ? " guest" : ""}`;
    closeDetail();
    $("fr-video").pause();
    Master.render();
    return;
  }
  const allMode = prefs.mode === "champ" && prefs.all;
  document.body.className = `mode-${prefs.mode}${allMode ? " all-mode" : ""}${isGuest() ? " guest" : ""}${studyMode() ? " study" : ""}`;
  $("f-search").placeholder = prefs.mode === "video" ? "Taper un champion pour revoir ses vidéos…" : "Chercher un champion…";
  const q = $("f-search").value.trim().toLowerCase();
  const any = (sel, vals) => sel.length === 0 || vals.some((v) => sel.includes(v));
  if (prefs.mode === "rune") {
    deck = cards.rune.filter((c) => any(prefs.tree, [c.tree]) && any(prefs.slot, [c.slot]));
  } else if (prefs.mode === "item") {
    deck = cards.item.filter((c) => any(prefs.itype, [c.itype]) && any(prefs.irole, c.roles));
  } else {
    deck = (allMode ? cards.champAll : cards[prefs.mode]).filter((c) =>
      any(prefs.lane, c.lanes) && any(prefs.cls, c.tags) && (allMode || any(prefs.key, [c.key])) &&
      (!q || c.champ.toLowerCase().includes(q)) && !brokenVideos.has(c.id));
  }
  if (studyMode()) {
    deck.sort((a, b) => a.champ.localeCompare(b.champ) || "QWER".indexOf(a.key) - "QWER".indexOf(b.key));
    studyIdx = -1;
  }
  const champs = new Set(deck.map((c) => c.champId)).size;
  $("count").textContent = prefs.mode === "rune" ? `${deck.length} runes`
    : prefs.mode === "item" ? `${deck.length} objets`
    : allMode ? `${deck.length} champions`
    : studyMode() ? `Mode étude : ${deck.length} vidéos (${champs} champion${champs > 1 ? "s" : ""})`
    : `${deck.length} cartes (${champs} champions)`;
  updateStats();
  if ($("dl-btn")) updateDlButton();
  next();
}

function updateStats() {
  if (isGuest()) {
    $("stats").innerHTML = "<b>Mode invité</b> · non enregistré";
    $("stats-bar").style.width = "0";
    return;
  }
  const all = prefs.mode === "champ" && prefs.all ? cards.champAll : cards[prefs.mode];
  const now = Date.now();
  let known = 0, due = 0;
  for (const c of all) { const p = srs(c.id); if (!p) continue; if (p.i >= MASTERED) known++; if (p.d <= now) due++; }
  $("stats").innerHTML = `<b>${known}</b> / ${all.length} maîtrisées · <b>${due}</b> à revoir`;
  // compteurs du choix Découverte / Révision, sur la sélection actuelle (filtres)
  let fresh = 0, dueSel = 0;
  for (const c of deck) { const p = srs(c.id); if (!p) fresh++; else if (p.d <= now) dueSel++; }
  $("lm-new").textContent = `${fresh} nouvelle${fresh > 1 ? "s" : ""}`;
  $("lm-due").textContent = `${dueSel} à revoir`;
  document.querySelectorAll("#learnmode button").forEach((b) => b.classList.toggle("on", b.dataset.m === prefs.learn));
  $("stats-bar").style.width = all.length ? `${(100 * known) / all.length}%` : "0";
}

// ---------- Répétition espacée (façon Anki) ----------
// Chaque carte vue garde : i = intervalle en jours, e = facilité, d = date de la prochaine révision,
// r = révisions réussies, l = oublis, s = étape d'apprentissage (0 ou 1).
const MIN = 60e3, HOUR = 36e5, DAY = 864e5;
const MASTERED = 21;            // maîtrisée quand l'intervalle atteint 3 semaines (comme les cartes « mûres » d'Anki)
const LEARN_AHEAD = 20 * MIN;   // s'il n'y a plus rien, on montre en avance les cartes prévues dans les 20 min
let ahead = false;              // « Continuer quand même » : réviser les cartes pas encore dues

// Lit l'état d'une carte ; convertit l'ancien système à boîtes (0 à 5) sans perdre la progression
function srs(id) {
  const p = progress[id];
  if (p == null) return null;
  if (typeof p === "number") {
    const ivl = [0, 1, 3, 7, 15, 30][p] || 0;
    progress[id] = { i: ivl, e: 2.5, d: Date.now() + Math.random() * ivl * DAY, r: p, l: 0, s: 0 };
  }
  return progress[id];
}

// Calcule le nouvel état après une réponse : 0 À revoir, 1 Difficile, 2 Bien, 3 Facile
function schedule(old, g, now = Date.now()) {
  const p = old ? { ...old } : { i: 0, e: 2.5, d: now, r: 0, l: 0, s: 0 };
  const learning = p.i < 1;
  if (g === 0) {
    if (!learning) p.l++;
    p.e = Math.max(1.3, p.e - 0.2); p.i = 0; p.s = 0; p.d = now + MIN;
    return p;
  }
  if (learning && g === 1) { p.d = now + 6 * MIN; return p; }
  if (learning && g === 2 && p.s === 0) { p.s = 1; p.d = now + 10 * MIN; return p; }
  if (learning) p.i = g === 3 ? 4 : 1;
  else if (g === 1) { p.i = Math.max(1, p.i * 1.2); p.e = Math.max(1.3, p.e - 0.15); }
  else if (g === 2) p.i = Math.max(p.i + 1, p.i * p.e);
  else { p.i = Math.max(p.i + 1, p.i * p.e * 1.3); p.e += 0.15; }
  if (p.i > 2) p.i *= 0.95 + Math.random() * 0.1; // petit décalage pour ne pas tout revoir le même jour
  p.i = Math.round(p.i * 10) / 10;
  p.s = 0; p.r++; p.d = now + p.i * DAY;
  return p;
}

function fmtDelay(ms) {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  const d = ms / DAY;
  if (d < 30) return `${Math.round(d)} j`;
  if (d < 365) return `${Math.round(d / 30)} mois`;
  return `${(d / 365).toFixed(1)} an`;
}

// Choisit la prochaine carte : d'abord celles à revoir (les plus en retard), puis des nouvelles,
// puis celles prévues dans les 20 min. Sinon : « tout est révisé ».
// Dernières cartes montrées : on évite de les revoir tout de suite, et de rester sur le même champion
const recent = [];
const rand = (list) => list[Math.floor(Math.random() * list.length)];
function varied(list) {
  const ids = new Set(recent.map((c) => c.id));
  const champs = new Set(recent.slice(-3).map((c) => c.champId).filter(Boolean));
  let l = list.filter((c) => !ids.has(c.id));
  if (!l.length) l = list.filter((c) => c.id !== lastId);
  if (!l.length) l = list;
  const other = l.filter((c) => !c.champId || !champs.has(c.champId));
  return other.length ? other : l;
}

// Choisit la prochaine carte, au hasard parmi : celles à revoir (mélangées avec quelques nouvelles),
// sinon des nouvelles, sinon celles prévues dans les 20 min. Sinon : « tout est révisé ».
function pickCard() {
  const now = Date.now();
  const due = [], soon = [], fresh = [], later = [];
  for (const c of deck) {
    const p = srs(c.id);
    if (!p) fresh.push(c);
    else if (p.d <= now) due.push(c);
    else if (p.d <= now + LEARN_AHEAD) soon.push(c);
    else later.push(c);
  }
  if (prefs.learn === "discover") return fresh.length ? rand(varied(fresh)) : null;
  if (due.length) return rand(varied(due));
  if (soon.length) return rand(varied(soon));
  if (ahead && later.length) return rand(varied(later.sort((a, b) => srs(a.id).d - srs(b.id).d).slice(0, 20)));
  return null;
}

function showDone() {
  const now = Date.now();
  const seen = deck.filter((c) => srs(c.id));
  current = null;
  $("fr-video").pause();
  $("card").classList.add("hidden");
  $("hint").classList.add("hidden");
  const discover = prefs.learn === "discover";
  if (discover) $("empty-text").innerHTML = "Tu as découvert toutes les cartes de cette sélection !<br>Passe en révision pour les retravailler.";
  else if (!seen.length) $("empty-text").innerHTML = "Aucune carte encore notée ici.<br>Commence par la découverte.";
  else $("empty-text").innerHTML = `Bravo, tout est révisé pour l'instant !<br>Prochaine carte dans <b>${fmtDelay(Math.min(...seen.map((c) => srs(c.id).d)) - now)}</b>.`;
  $("b-ahead").classList.toggle("hidden", discover || !seen.length);
  $("b-switch").textContent = discover || !seen.length ? (discover ? "Passer en révision" : "Passer en découverte") : "";
  $("b-switch").classList.toggle("hidden", !discover && !!seen.length);
  $("empty").classList.remove("hidden");
}
function setLearn(m) {
  prefs.learn = m;
  saveAndRebuild();
}
// Quand une carte redevient due pendant l'écran « tout est révisé », on reprend tout seul
setInterval(() => { if (!current && deck.length && !$("empty").classList.contains("hidden") && pickCard()) next(); }, 30e3);

// Mode étude : les 4 sorts du champion recherché sur le même écran (vidéo + descriptions)
const STUDY_MAX = 3;
function renderStudy() {
  current = null;
  $("fr-video").pause();
  ["card", "answer", "hint", "spellbar", "matchups", "empty"].forEach((id) => $(id).classList.add("hidden"));
  const box = $("study");
  box.classList.remove("hidden");
  if (!deck.length) { box.innerHTML = `<div class="study-note">Aucun champion ne correspond à cette recherche.</div>`; return; }
  const champs = [...new Set(deck.map((c) => c.champId))];
  box.innerHTML = champs.length > STUDY_MAX
    ? `<div class="study-note">${champs.length} champions correspondent : voici les ${STUDY_MAX} premiers, précise la recherche pour en voir un autre.</div>` : "";
  box.insertAdjacentHTML("beforeend", `<div class="study-note">Maintiens <b>A Z E R</b> pour retourner un sort, <b>P</b> pour le détail du passif (ou clique / touche-les)</div>`);
  for (const id of champs.slice(0, STUDY_MAX)) {
    const list = deck.filter((c) => c.champId === id);
    const raw = champRaw[id];
    const sec = document.createElement("section");
    sec.className = "study-champ";
    sec.innerHTML = `<h2><img src="${list[0].img}" alt=""><span></span></h2>
      <div class="study-passive" data-k="P"><div class="key"><b>P</b></div><img src="${url.passive(raw.passive.image.full)}" alt="">
        <div class="sp-text"><b></b><span></span><p class="study-official"></p></div></div>
      <div class="study-grid"></div>`;
    sec.querySelector("h2 span").textContent = list[0].champ;
    sec.querySelector(".sp-text b").textContent = `Passif · ${raw.passive.name}`;
    sec.querySelector(".sp-text span").textContent = custom[`${id}_P`] || (window.CHAMP_DESC[id] || {}).P || shorten(clean(raw.passive.description));
    sec.querySelector(".sp-text .study-official").textContent = clean(raw.passive.description);
    sec.querySelector(".study-passive").onclick = (e) => e.currentTarget.classList.toggle("open");
    for (const c of list) {
      const tile = document.createElement("article");
      tile.className = "study-tile";
      tile.dataset.k = c.key;
      tile.innerHTML = `<div class="st-inner">
        <div class="st-front"><video muted loop playsinline autoplay preload="metadata"></video>
          <div class="key"><b></b></div><em class="study-missing hidden">Vidéo indisponible</em><div class="st-name"></div></div>
        <div class="st-back"><div class="study-head"><div class="key"><b></b></div><img src="${c.icon}" alt=""><b class="st-title"></b></div>
          <p class="study-short"></p>${c.cd && c.cd.length ? `<div class="study-cd">CD ${c.cd.join(" / ")} s</div>` : ""}
          <p class="study-official"></p></div></div>`;
      tile.querySelectorAll(".key b").forEach((b) => (b.textContent = AZERTY[c.key] || c.key));
      tile.querySelector(".st-name").textContent = c.name;
      tile.querySelector(".st-title").textContent = c.name;
      tile.querySelector(".study-short").textContent = custom[c.id.replace(/^vid_/, "")] || c.short;
      tile.querySelector(".study-official").textContent = c.official;
      tile.onclick = () => tile.classList.toggle("flipped"); // au toucher : retourne / remet la carte
      const v = tile.querySelector("video");
      let i = 0;
      v.onerror = () => {
        i++;
        if (i < c.videos.length) { v.src = c.videos[i]; v.play().catch(() => {}); }
        else tile.querySelector(".study-missing").classList.remove("hidden");
      };
      v.src = c.videos[0];
      v.play().catch(() => {});
      sec.querySelector(".study-grid").appendChild(tile);
    }
    box.appendChild(sec);
  }
}
// Mode étude : maintenir P A Z E R retourne la carte du sort (ou ouvre le passif), relâcher la remet
function studyKey(k, down) {
  const sel = k === "P" ? `.study-passive[data-k="P"]` : `.study-tile[data-k="${k}"]`;
  document.querySelectorAll(`#study ${sel}`).forEach((el) => el.classList.toggle(k === "P" ? "open" : "flipped", down));
}

function next(step = 1) {
  closeDetail();
  if (studyMode()) return renderStudy();
  if (!$("study").classList.contains("hidden")) { $("study").classList.add("hidden"); $("study").innerHTML = ""; }
  $("card").classList.remove("flipped");
  $("answer").classList.toggle("hidden", !studyMode());
  $("spellbar").classList.add("hidden");
  $("matchups").classList.add("hidden");
  $("hint").classList.toggle("hidden", deck.length === 0 || studyMode());
  if (deck.length === 0) {
    current = null;
    $("fr-video").pause();
    $("card").classList.add("hidden");
    $("empty-text").textContent = "Aucune carte avec ces filtres.";
    $("b-ahead").classList.add("hidden");
    $("b-switch").classList.add("hidden");
    $("empty").classList.remove("hidden");
    return;
  }
  const pick = studyMode() ? deck[(studyIdx = (studyIdx + step + deck.length) % deck.length)]
    : isGuest() ? rand(varied(deck)) : pickCard();
  if (!pick) return showDone();
  $("empty").classList.add("hidden");
  current = pick;
  lastId = current.id;
  if (!studyMode()) { recent.push(current); if (recent.length > Math.min(12, Math.floor(deck.length / 2))) recent.shift(); }
  setTimeout(show, 150); // laisse la carte se retourner avant de changer le contenu
}

// Essaie la vidéo locale puis celle en ligne ; si aucune ne marche, passe à la carte suivante.
function playVideo(c) {
  const v = $("fr-video");
  let i = 0;
  v.onerror = () => {
    if (current !== c) return;
    i++;
    if (i < c.videos.length) { v.src = c.videos[i]; v.play().catch(() => {}); return; }
    brokenVideos.add(c.id);
    deck = deck.filter((x) => x.id !== c.id);
    if (studyMode()) studyIdx--; // la carte suivante a pris sa place dans la liste
    next();
  };
  v.src = c.videos[0];
  v.play().catch(() => {});
}

function show() {
  const c = current;
  if (!c) return;
  const isVideo = c.type === "video";
  $("card").classList.remove("hidden");
  $("fr-img").classList.toggle("hidden", isVideo);
  $("fr-video").classList.toggle("hidden", !isVideo);
  $("bk-portrait").classList.toggle("hidden", !isVideo);
  $("bk-key").classList.toggle("hidden", !isVideo);
  if (isVideo) $("bk-key").querySelector("b").textContent = c.key;
  if (isVideo) playVideo(c); else { $("fr-video").pause(); $("fr-img").src = c.img; }

  const isChamp = c.type === "champ" || c.type === "video";
  $("backdrop").style.backgroundImage = isChamp ? `url("${c.img}")` : "none";
  const keyBox = $("fr-key");
  $("card").classList.toggle("all", !!c.all);
  if (c.all) {
    $("fr-name").textContent = prefs.name ? c.champ : "Qui est-ce ?";
    $("fr-q").textContent = "Et ses 5 sorts ?";
    keyBox.classList.add("hidden");
    $("fr-spell").classList.add("hidden");
    fillAll(c);
  } else if (c.type === "champ") {
    $("fr-name").textContent = prefs.name ? c.champ : "Qui est-ce ?";
    $("fr-q").textContent = c.key === "P" ? "Quel est son passif" : "Quel est son sort";
    keyBox.querySelector("b").textContent = c.key;
    keyBox.classList.remove("hidden");
    $("fr-spell").src = c.icon;
    $("fr-spell").classList.toggle("hidden", !prefs.icon);
  } else if (isVideo && studyMode()) {
    $("fr-name").textContent = c.champ;
    $("fr-q").textContent = `${c.name} · ${studyIdx + 1} / ${deck.length}`;
    keyBox.querySelector("b").textContent = c.key;
    keyBox.classList.remove("hidden");
    $("fr-spell").classList.add("hidden");
    $("bk-portrait").src = c.img;
  } else if (isVideo) {
    $("fr-name").textContent = "Quel champion ?";
    $("fr-q").textContent = "Et quel sort ?";
    keyBox.classList.add("hidden");
    $("fr-spell").classList.add("hidden");
    $("bk-portrait").src = c.img;
  } else if (c.type === "item") {
    $("fr-name").textContent = prefs.icon ? c.name : "Quel objet ?";
    $("fr-q").textContent = `${ITYPES[c.itype]} · ${c.gold} or`;
    keyBox.classList.add("hidden");
    $("fr-spell").classList.add("hidden");
  } else {
    $("fr-name").textContent = prefs.icon ? c.name : "Quelle rune ?";
    $("fr-q").textContent = c.tree;
    keyBox.classList.add("hidden");
    $("fr-spell").classList.add("hidden");
  }
  $("bk-title").innerHTML = c.type === "rune" ? `${c.tree}<b></b>`
    : c.type === "item" ? `${ITYPES[c.itype]} · ${c.gold} or<b></b>` : `${c.champ} · ${KEY_LABEL[c.key]}<b></b>`;
  $("bk-title").querySelector("b").textContent = c.name;
  $("bk-icon").src = c.icon;
  $("bk-desc").textContent = custom[c.id.replace(/^vid_/, "")] || c.short;
  $("bk-desc").classList.toggle("long", $("bk-desc").textContent.length > 100);
  $("bk-who").innerHTML = c.type === "item" && c.roles.length
    ? `<span>Pour</span> ${c.roles.map((r) => ROLES[r]).join(", ")}${c.note ? `<em>${c.note}</em>` : ""}` : "";
  $("bk-cd").innerHTML = c.type === "item"
    ? (c.stats.length ? `<div class="cd-label">Statistiques</div>` + c.stats.map((x) => `<span class="cd stat">${x}</span>`).join("") : "")
    : c.cd && c.cd.length
    ? `<div class="cd-label">Cooldown (secondes)</div>` + c.cd.map((x) => `<span class="cd">${x}</span>`).join("")
    : "";
  $("bk-official").textContent = c.official;
  $("bk-details").open = studyMode(); // en mode étude, la vraie description est affichée sous la rapide
}

// Verso du mode "tous les sorts" : une ligne par sort, cliquable pour les détails
function fillAll(c) {
  $("bk-all-name").textContent = c.champ;
  $("bk-all-list").innerHTML = "";
  for (const s of c.spells) {
    const row = document.createElement("button");
    row.className = "all-row";
    row.dataset.k = s.key;
    row.innerHTML = `<img src="${s.icon}" alt=""><span class="all-key">${s.key}</span>
      <span class="all-text"><b></b><span></span>${s.cd.length ? `<em>CD ${s.cd.join(" / ")} s</em>` : ""}</span>`;
    row.querySelector("b").textContent = s.name;
    row.querySelector(".all-text > span").textContent = custom[`${c.champId}_${s.key}`] || s.short;
    row.onclick = (e) => { e.stopPropagation(); openDetail(s.key); };
    $("bk-all-list").appendChild(row);
  }
}

function flip() {
  if (!current) return;
  $("card").classList.toggle("flipped");
  const flipped = $("card").classList.contains("flipped");
  $("answer").classList.toggle("hidden", !flipped && !studyMode());
  if (flipped) updateGradeLabels();
  $("hint").classList.toggle("hidden", flipped || studyMode());
  $("spellbar").classList.toggle("hidden", !flipped || !["champ", "video"].includes(current.type));
  showMatchups(flipped && ["champ", "video"].includes(current.type) ? current.champId : null);
}

// 5 bons et 5 mauvais matchups sous la carte, une fois retournée
const MU_LANE = { top: "en top", jungle: "en jungle", mid: "en mid", adc: "en bot", support: "en support" };
function showMatchups(champId) {
  const box = $("matchups");
  const m = champId && window.MATCHUPS && window.MATCHUPS[champId];
  box.classList.toggle("hidden", !m);
  if (!m) return;
  const list = (ids) => ids.filter((id) => champRaw[id]).map((id) =>
    `<div class="mu" title="${champRaw[id].name}"><img src="${url.square(id)}" alt="" loading="lazy"><span>${champRaw[id].name}</span></div>`).join("");
  box.innerHTML = `
    <div class="mu-col good"><h4>Bons matchups <em>${MU_LANE[m.lane] || ""}</em></h4><div class="mu-list">${list(m.good)}</div></div>
    <div class="mu-col bad"><h4>Mauvais matchups <em>${MU_LANE[m.lane] || ""}</em></h4><div class="mu-list">${list(m.bad)}</div></div>`;
}

function answer(g) {
  if (studyMode()) return next(); // mode étude : rien n'est noté, on passe à la suivante
  if (!current || !$("card").classList.contains("flipped")) return;
  if (isGuest()) return next(); // invité : on passe juste à la suivante
  progress[current.id] = schedule(srs(current.id), g);
  persist();
  updateStats();
  next();
}

// Affiche sous chaque bouton le délai avant de revoir la carte
function updateGradeLabels() {
  if (!current) return;
  const now = Date.now(), p = srs(current.id);
  document.querySelectorAll("#answer .grade").forEach((b) => {
    b.querySelector("small").textContent = fmtDelay(schedule(p, +b.dataset.g, now).d - now);
  });
}

// ---------- Fiche détaillée d'un sort (touches P A Z E R) ----------
// Le texte de Riot contient des balises (<magicDamage>…) et des valeurs {{ e1 }}.
// On remplace ce qu'on peut avec les données du patch ; Riot ne fournit plus toutes les valeurs.
function fillPlaceholders(text, s, champ) {
  return (text || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name) => {
    const m = /^e(\d+)$/.exec(name);
    if (m && s.effectBurn && s.effectBurn[+m[1]] && s.effectBurn[+m[1]] !== "0") return s.effectBurn[+m[1]];
    if (name === "cost" && s.costBurn) return s.costBurn;
    if (name === "abilityresourcename") return champ.partype;
    if (name === "cooldown" && s.cooldownBurn) return s.cooldownBurn;
    return "?";
  })
    .replace(/\(\s*\+\s*\?\s*\)/g, "")          // bonus de ratio inconnu : on l'enlève
    .replace(/\s*\?\s*%/g, " ?%");
}

// Transforme le HTML de Riot en éléments sûrs : on garde le texte, les retours à la ligne,
// et chaque balise devient un <span> avec une classe pour la couleur.
function riotHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const out = document.createElement("div");
  (function walk(src, dst) {
    for (const n of src.childNodes) {
      if (n.nodeType === 3) dst.appendChild(document.createTextNode(n.textContent));
      else if (n.nodeType === 1) {
        const tag = n.tagName.toLowerCase();
        if (tag === "br") { dst.appendChild(document.createElement("br")); continue; }
        const span = document.createElement("span");
        span.className = `t-${tag.replace(/[^a-z0-9]/g, "")}`;
        dst.appendChild(span);
        walk(n, span);
      }
    }
  })(doc.body.firstChild, out);
  // évite plus de deux retours à la ligne d'affilée
  out.innerHTML = out.innerHTML.replace(/(<br>\s*){3,}/g, "<br><br>").replace(/^(<br>\s*)+/, "");
  return out.innerHTML;
}

// ---------- Chiffres détaillés (Meraki Analytics) ----------
const MERAKI = "https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions";
const merakiCache = {};
window.MERAKI_CB = (id, data) => { merakiCache[id] = data; };
function loadMeraki(id) {
  if (id in merakiCache) return Promise.resolve(merakiCache[id]);
  const done = (d) => (merakiCache[id] = d || null);
  if (local) {
    return new Promise((resolve) => {
      const tag = document.createElement("script");
      tag.src = `data/meraki/${id}.js`;
      tag.onload = () => resolve(merakiCache[id] || null);
      tag.onerror = () => resolve(done(null));
      document.head.appendChild(tag);
    });
  }
  return fetch(`${MERAKI}/${id}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then(done);
}

// Traduction des libellés anglais les plus courants
const FR_WORDS = [
  ["Total Mixed Damage", "Dégâts mixtes totaux"], ["Magic Damage", "Dégâts magiques"], ["Physical Damage", "Dégâts physiques"],
  ["True Damage", "Dégâts bruts"], ["Mixed Damage", "Dégâts mixtes"], ["Bonus Attack Speed", "Vitesse d'attaque bonus"],
  ["Attack Speed", "Vitesse d'attaque"], ["Bonus Movement Speed", "Vitesse bonus"], ["Movement Speed", "Vitesse"],
  ["Shield Strength", "Bouclier"], ["Shield", "Bouclier"], ["Healing", "Soin"], ["Heal", "Soin"],
  ["Knock Up Duration", "Durée du knock-up"], ["Stun Duration", "Durée du stun"], ["Root Duration", "Durée du root"],
  ["Charm Duration", "Durée du charme"], ["Fear Duration", "Durée du fear"], ["Silence Duration", "Durée du silence"],
  ["Slow", "Ralentissement"], ["Duration", "Durée"], ["Cooldown", "Délai"], ["Damage", "Dégâts"],
  ["Per Second", "par seconde"], ["Per Pass", "par passage"], ["Per Hit", "par coup"], ["Per Stack", "par cumul"],
  ["Minimum", "Minimum"], ["Maximum", "Maximum"], ["Increased", "augmentés"], ["Reduction", "réduction"],
  ["Bonus", "bonus"], ["Total", "total"], ["Range", "Portée"], ["Armor", "Armure"], ["Magic Resistance", "Résistance magique"],
];
const FR_UNITS = [
  ["% of target's maximum health", "% PV max de la cible"], ["% of target's missing health", "% PV manquants de la cible"],
  ["% of target's current health", "% PV actuels de la cible"], ["% maximum health", "% PV max"], ["% bonus health", "% PV bonus"],
  ["% missing health", "% PV manquants"], ["% bonus AD", "% AD bonus"], ["% bonus armor", "% armure bonus"],
  ["% bonus magic resistance", "% RM bonus"], [" seconds", " s"], [" second", " s"],
];
const tr = (txt, table) => table.reduce((t, [en, fr]) => t.split(en).join(fr), txt || "");
const fmtNum = (n) => (Math.round(n * 100) / 100).toString().replace(".", ",");

function fmtModifier(m) {
  const unit = tr(m.units[0] || "", FR_UNITS);
  const same = m.values.every((v) => v === m.values[0]);
  const vals = same ? fmtNum(m.values[0]) : m.values.map(fmtNum).join(" / ");
  return vals + unit;
}
function merakiHtml(data, key) {
  const abilities = data && data.abilities && data.abilities[key];
  if (!abilities || !abilities.length) return "";
  const rows = [];
  for (const ab of abilities) {
    for (const ef of ab.effects || []) {
      for (const lv of ef.leveling || []) {
        if (!lv.modifiers || !lv.modifiers.length) continue;
        const [base, ...ratios] = lv.modifiers;
        const ratioTxt = ratios.map((r) => {
          const u = r.units[0] || "";
          const cls = /AP/.test(u) ? "r-ap" : /AD/.test(u) ? "r-ad" : /health/i.test(u) ? "r-hp" : "";
          return ` <span class="ratio ${cls}">(+ ${fmtModifier(r)})</span>`;
        }).join("");
        rows.push(`<div class="v-row"><span>${tr(lv.attribute, FR_WORDS)}</span><b>${fmtModifier(base)}${ratioTxt}</b></div>`);
      }
    }
  }
  if (!rows.length) return "";
  const patch = data.patchLastChanged ? ` · données du patch ${data.patchLastChanged}` : "";
  return `<div class="values"><div class="v-title">Valeurs par rang${patch}</div>${rows.join("")}</div>`;
}

const isDetail = () => $("card").classList.contains("detailed");

function openDetail(key) {
  if (!current || !["champ", "video"].includes(current.type)) return;
  if (!$("card").classList.contains("flipped")) return; // seulement une fois la carte révélée
  const c = champRaw[current.champId];
  if (!c) return;
  document.querySelectorAll("#detail-tabs button, #spellbar button").forEach((b) => b.classList.toggle("on", b.dataset.k === key));
  let name, icon, body, stats = [];
  if (key === "P") {
    name = c.passive.name; icon = url.passive(c.passive.image.full);
    body = riotHtml(c.passive.description);
  } else {
    const s = c.spells["QWER".indexOf(key)];
    name = s.name; icon = url.spell(s.image.full);
    const cd = cooldowns(s);
    if (cd.length) stats.push(["Cooldown", cd.join(" / ") + " s"]);
    const cost = fillPlaceholders(s.resource || "", s, c).replace(/\s*\?\s*/g, " ").trim();
    if (s.costBurn && s.costBurn !== "0" && cost) stats.push(["Coût", cost]);
    if (s.rangeBurn && s.rangeBurn !== "self") stats.push(["Portée", s.rangeBurn === "25000" ? "Globale" : s.rangeBurn]);
    body = riotHtml(clean(s.description) === clean(s.tooltip) ? s.description : fillPlaceholders(s.tooltip, s, c));
    body = `<p class="d-short">${riotHtml(s.description)}</p><div class="d-sep"></div>${body}`;
  }
  const keyLabel = key === "P" ? "Passif" : key;
  $("detail-icon").src = icon;
  $("detail-name").textContent = name;
  $("detail-sub").textContent = `${c.name} · ${keyLabel}`;
  $("detail-stats").innerHTML = stats.map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join("");
  $("detail-body").innerHTML = body;
  $("detail-values").innerHTML = "";
  // petite animation quand on passe d'un sort à l'autre
  const box = $("detail");
  box.classList.remove("swap"); void box.offsetWidth; box.classList.add("swap");
  $("card").classList.add("detailed");
  box.scrollTop = 0;
  box.dataset.k = key;
  const champId = c.id;
  loadMeraki(champId).then((data) => {
    if ($("detail").dataset.k === key && current && current.champId === champId) $("detail-values").innerHTML = merakiHtml(data, key);
  });
}
function closeDetail() {
  $("card").classList.remove("detailed");
  $("detail").dataset.k = "";
  document.querySelectorAll("#spellbar button").forEach((b) => b.classList.remove("on"));
}
// touche du clavier français -> sort
const AZERTY = { Q: "A", W: "Z", E: "E", R: "R" };
const KEY_FROM_PRESS = { p: "P", a: "Q", q: "Q", z: "W", w: "W", e: "E", r: "R" };

function wire() {
  $("detail-close").onclick = (e) => { e.stopPropagation(); closeDetail(); };
  $("detail-tabs").querySelectorAll("button").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openDetail(b.dataset.k); }));
  $("spellbar").querySelectorAll("button").forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    if (isDetail() && $("detail").dataset.k === b.dataset.k) closeDetail(); else openDetail(b.dataset.k);
  }));
  $("card").onclick = (e) => {
    if (isDetail()) { closeDetail(); return; } // détail ouvert : toucher la carte n'importe où le ferme
    if (e.target.closest("details, #edit, .all-row")) return;
    flip();
  };
  document.querySelectorAll("#answer .grade").forEach((b) => (b.onclick = () => answer(+b.dataset.g)));
  $("b-next").onclick = () => answer(2);
  $("b-prev").onclick = () => next(-1);
  $("b-ahead").onclick = () => { ahead = true; next(); };
  $("edit").onclick = () => {
    const id = current.id.replace(/^vid_/, ""); // même description pour la carte classique et la vidéo
    const text = prompt("Ta description courte pour cette carte (vide = remettre celle d'origine) :", custom[id] || current.short);
    if (text === null) return;
    if (text.trim()) custom[id] = text.trim(); else delete custom[id];
    Master.refreshDescs();
    persist();
    show();
  };
  $("reset").onclick = () => {
    if (!confirm("Effacer toute ta progression ?")) return;
    for (const k of Object.keys(progress)) delete progress[k];
    persist();
    rebuild();
  };
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || prefs.mode === "master") return;
    if (studyMode() && KEY_FROM_PRESS[e.key.toLowerCase()] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!e.repeat) studyKey(KEY_FROM_PRESS[e.key.toLowerCase()], true);
      return;
    }
    if (isDetail() && ["Space", "Enter"].includes(e.code)) { e.preventDefault(); closeDetail(); return; }
    if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); flip(); }
    // chiffres 1 à 4 (rangée du haut sans Maj sur AZERTY, ou pavé numérique) ; flèches = À revoir / Bien
    else if (/^(Digit|Numpad)[1-4]$/.test(e.code)) answer(+e.code.slice(-1) - 1);
    else if (e.key === "ArrowLeft") { if (studyMode()) next(-1); else answer(0); }
    else if (e.key === "ArrowRight") answer(2);
    else if (e.key === "Escape") closeDetail();
    else if (KEY_FROM_PRESS[e.key.toLowerCase()] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // le détail reste affiché tant que la touche est enfoncée
      if (!e.repeat) openDetail(KEY_FROM_PRESS[e.key.toLowerCase()]);
    }
  });
  document.addEventListener("keyup", (e) => {
    if (prefs.mode === "master") return;
    const k = KEY_FROM_PRESS[(e.key || "").toLowerCase()];
    if (k && studyMode()) return studyKey(k, false);
    if (k && isDetail() && $("detail").dataset.k === k) closeDetail();
  });
  window.addEventListener("blur", () => {
    if (isDetail()) closeDetail();
    document.querySelectorAll("#study .flipped, #study .open").forEach((el) => el.classList.remove("flipped", "open"));
  });
}

// ---------- Téléchargement par section (hors ligne dans le navigateur) ----------
const SECTION_NAMES = { champ: "Sorts", video: "Vidéos", rune: "Runes", item: "Objets" };
const dlState = store.get("flc_dl", {}); // section -> patch téléchargé
let downloading = false;
const canCache = () => location.protocol.startsWith("http") && "caches" in window && !local;

function sectionUrls(section) {
  const urls = new Set([`${DD}/api/versions.json`]);
  if (section === "champ") {
    urls.add(`${DD}/cdn/${version}/data/fr_FR/championFull.json`);
    for (const c of cards.champ) { urls.add(c.img); urls.add(c.icon); urls.add(url.square(c.champId)); }
    for (const id of Object.keys(champRaw)) urls.add(`${MERAKI}/${id}.json`);
  } else if (section === "video") {
    for (const c of cards.video) urls.add(c.videos[c.videos.length - 1]);
  } else if (section === "rune") {
    urls.add(`${DD}/cdn/${version}/data/fr_FR/runesReforged.json`);
    for (const c of cards.rune) urls.add(c.icon);
  } else if (section === "item") {
    urls.add(`${DD}/cdn/${version}/data/fr_FR/item.json`);
    for (const c of cards.item) urls.add(c.icon);
  }
  // les sections ont besoin des données des champions pour démarrer
  urls.add(`${DD}/cdn/${version}/data/fr_FR/championFull.json`);
  urls.add(`${DD}/cdn/${version}/data/fr_FR/runesReforged.json`);
  urls.add(`${DD}/cdn/${version}/data/fr_FR/item.json`);
  return [...urls];
}

function updateDlButton() {
  const section = prefs.mode;
  const btn = $("dl-btn");
  if (downloading) return;
  $("dl-bar").parentElement.classList.add("hidden");
  if (!canCache()) {
    btn.textContent = "⟳ Mettre à jour les données";
    btn.title = local ? "Lance mise-a-jour.bat dans le dossier du site" : "Les boutons de téléchargement marchent sur la page GitHub du site";
    $("dl-status").textContent = "";
    return;
  }
  btn.title = "";
  const have = dlState[section];
  if (!have) { btn.textContent = `⤓ Télécharger ${SECTION_NAMES[section]} pour hors ligne`; $("dl-status").textContent = ""; }
  else if (have !== version) { btn.textContent = `⟳ Mettre à jour ${SECTION_NAMES[section]}`; $("dl-status").textContent = `Patch ${have} → ${version}`; }
  else { btn.textContent = `⟳ Retélécharger`; $("dl-status").textContent = `✓ ${SECTION_NAMES[section]} dispo hors ligne (patch ${version})`; }
}

async function downloadSection() {
  if (!canCache()) {
    $("banner").innerHTML = 'Tu as ouvert le fichier depuis ton dossier : ici, le navigateur ne peut pas enregistrer les données. '
      + "Double-clique sur <b>mise-a-jour.bat</b> dans le dossier du site, "
      + 'ou utilise la version en ligne où ce bouton télécharge tout : <a href="https://tomfro.github.io/flashcards-lol/">tomfro.github.io/flashcards-lol</a>';
    $("banner").classList.remove("hidden");
    return;
  }
  if (downloading) return;
  const section = prefs.mode;
  if (section === "video" && !confirm("Les vidéos pèsent environ 1 à 2 Go. Les télécharger maintenant ?")) return;
  downloading = true;
  const urls = sectionUrls(section);
  const cache = await caches.open("flc-data");
  let done = 0, failed = 0, i = 0;
  const btn = $("dl-btn");
  btn.disabled = true;
  $("dl-bar").parentElement.classList.remove("hidden");
  const tick = () => {
    btn.textContent = `Téléchargement… ${done} / ${urls.length}`;
    $("dl-bar").style.width = `${(100 * done) / urls.length}%`;
  };
  tick();
  async function worker() {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        const fresh = u.endsWith("versions.json");
        if (fresh || !(await cache.match(u))) {
          const res = await fetch(u, { mode: "cors", cache: "no-store" });
          if (!res.ok) throw new Error(res.status);
          await cache.put(u, res);
        }
      } catch { failed++; }
      done++;
      if (done % 5 === 0 || done === urls.length) tick();
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  downloading = false;
  btn.disabled = false;
  if (failed < urls.length) { dlState[section] = version; store.set("flc_dl", dlState); }
  updateDlButton();
  if (failed) $("dl-status").textContent += ` · ${failed} fichier(s) introuvable(s)`;
}

// ---------- Comptes ----------
let lastMode = null;
function renderAccount() {
  const box = $("account");
  const mode = Account.mode;
  if (mode === "local") { box.innerHTML = ""; return; }
  if (mode === "guest") {
    box.innerHTML = `<button id="acc-login" class="acc-btn">Se connecter</button>
      <div id="acc-menu" class="hidden">
        <button data-p="google"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22zM6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9zM12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.7 9.4 6 12 6z"/></svg>Google</button>
        <button data-p="github"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>GitHub</button>
        <button data-p="email"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18v14H3zm2 2v.5l7 4.5 7-4.5V7zm0 2.9V17h14V9.9l-7 4.5z"/></svg>E-mail</button>
      </div>`;
    $("acc-login").onclick = (e) => { e.stopPropagation(); $("acc-menu").classList.toggle("hidden"); };
    $("acc-menu").querySelectorAll("button").forEach((b) => (b.onclick = async () => {
      $("acc-menu").classList.add("hidden");
      if (b.dataset.p === "email") return openEmailLogin();
      try { await Account.signIn(b.dataset.p); }
      catch (err) { $("banner").textContent = err.message || "Connexion impossible."; $("banner").classList.remove("hidden"); }
    }));
    return;
  }
  const u = Account.user;
  const offline = mode === "offline";
  box.innerHTML = `<div class="acc-user">${u.photoURL ? `<img src="${u.photoURL}" alt="" onerror="this.remove()">` : ""}<span></span>
    ${offline && Account.restoring ? `<em class="acc-off">connexion…</em>`
      : offline ? `<em class="acc-off" title="Ta progression est gardée sur cet appareil et sera envoyée sur ton compte au retour d'internet">hors ligne</em>`
              : `<button id="acc-logout" class="link">Déconnexion</button>`}</div>`;
  box.querySelector("span").textContent = u.displayName || u.email || "Connecté";
  if (!offline) $("acc-logout").onclick = () => Account.signOut();
}

// Fenêtre de connexion par e-mail : se connecter, créer un compte ou recevoir un lien de nouveau mot de passe
function openEmailLogin() {
  let box = $("email-login");
  if (!box) {
    box = document.createElement("div");
    box.id = "email-login";
    box.innerHTML = `<form class="el-box">
        <div class="el-head"><b>Connexion par e-mail</b><button type="button" class="link el-x">✕</button></div>
        <div class="el-tabs"><button type="button" data-m="in" class="on">Se connecter</button><button type="button" data-m="up">Créer un compte</button></div>
        <label class="el-name">Pseudo (visible par les autres joueurs)<input name="name" maxlength="30" autocomplete="nickname"></label>
        <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
        <label>Mot de passe<input name="pw" type="password" autocomplete="current-password" minlength="6" required></label>
        <div class="el-msg"></div>
        <button type="submit" class="btn good el-go">Se connecter</button>
        <button type="button" class="link el-forgot">Mot de passe oublié ?</button>
      </form>`;
    document.body.appendChild(box);
    const f = box.querySelector("form");
    let m = "in";
    const setM = (x) => {
      m = x;
      box.querySelectorAll(".el-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
      box.classList.toggle("up", m === "up");
      f.pw.autocomplete = m === "up" ? "new-password" : "current-password";
      box.querySelector(".el-go").textContent = m === "up" ? "Créer mon compte" : "Se connecter";
      box.querySelector(".el-msg").textContent = "";
    };
    box.querySelectorAll(".el-tabs button").forEach((b) => (b.onclick = () => setM(b.dataset.m)));
    const close = () => box.classList.add("hidden");
    box.querySelector(".el-x").onclick = close;
    box.onclick = (e) => { if (e.target === box) close(); };
    const msg = (t, ok) => { const el = box.querySelector(".el-msg"); el.textContent = t; el.classList.toggle("ok", !!ok); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const go = box.querySelector(".el-go");
      go.disabled = true;
      msg("");
      try {
        if (m === "up") await Account.signUpEmail(f.email.value, f.pw.value, f.name.value);
        else await Account.signInEmail(f.email.value, f.pw.value);
        close();
      } catch (err) { msg(err.message); }
      go.disabled = false;
    };
    box.querySelector(".el-forgot").onclick = async () => {
      if (!f.email.value.trim()) return msg("Entre ton e-mail au-dessus, puis clique à nouveau.");
      try { await Account.resetPassword(f.email.value); msg("C'est envoyé : regarde ta boîte mail pour choisir un nouveau mot de passe.", true); }
      catch (err) { msg(err.message); }
    };
  }
  box.classList.remove("hidden");
  setTimeout(() => box.querySelector("input[name=email]").focus(), 50);
}

// flc_owner : compte à qui appartient la progression gardée dans ce navigateur
// flc_unsynced : des réponses données hors ligne n'ont pas encore été envoyées au compte
async function onAccountChange(mode) {
  const local = () => ({ progress: store.get("flc_progress", {}), custom: store.get("flc_custom", {}), master: store.get("flc_master", null) });
  if (mode === "guest") {
    if (lastMode === "user") { // déconnexion : on ne laisse rien
      ["flc_progress", "flc_custom", "flc_owner", "flc_unsynced", "flc_master"].forEach((k) => localStorage.removeItem(k));
    }
    replaceObj(progress, {});
    replaceObj(custom, {});
    Master.setState(null);
  } else if (mode === "offline") {
    // pas d'internet : on continue avec la copie du navigateur, tout est gardé
    const l = local();
    replaceObj(progress, l.progress);
    replaceObj(custom, l.custom);
    Master.setState(l.master);
  } else if (mode === "user") {
    const uid = Account.user.uid;
    const owner = store.get("flc_owner", null);
    const l = owner === uid || owner === null ? local() : { progress: {}, custom: {}, master: null };
    // on affiche tout de suite la copie du navigateur, le compte arrive juste après
    replaceObj(progress, l.progress);
    replaceObj(custom, l.custom);
    Master.setState(l.master);
    store.set("flc_owner", uid);
    lastMode = mode;
    renderAccount();
    if (cards.champ.length) rebuild();
    let cloud = null, failed = false;
    try { cloud = await Account.load(); } catch { failed = true; }
    if (Account.mode !== "user" || Account.user.uid !== uid) return; // changé entre-temps
    const unsynced = store.get("flc_unsynced", false) && owner === uid;
    const hasCloud = cloud && (cloud.progress || cloud.custom || cloud.master);
    // collection LoL Master : on garde celle qui a ouvert le plus de packs
    const master = hasCloud ? Master.pick(l.master, cloud.master) : l.master;
    if (!failed) Master.setState(master);
    if (failed) {
      // compte injoignable : on garde la copie locale, elle partira au prochain enregistrement
    } else if (hasCloud && unsynced) {
      // réponses données hors ligne : on les ajoute par-dessus le compte
      replaceObj(progress, { ...cloud.progress, ...l.progress });
      if (master) store.set("flc_master", master);
      replaceObj(custom, { ...cloud.custom, ...l.custom });
      persist();
    } else if (hasCloud) {
      replaceObj(progress, cloud.progress || {});
      replaceObj(custom, cloud.custom || {});
      store.set("flc_progress", progress);
      store.set("flc_custom", custom);
      if (master) store.set("flc_master", master);
      if (master && master !== cloud.master) persist(); // la collection de cet appareil était plus avancée
    } else {
      // première connexion : on reprend la progression déjà faite sur cet appareil
      persist();
    }
  }
  lastMode = mode;
  renderAccount();
  if (cards.champ.length) rebuild();
  if (mode === "user") Master.publish(); // profil visible par les autres joueurs
}
document.addEventListener("click", () => { const m = document.getElementById("acc-menu"); if (m) m.classList.add("hidden"); });

load()
  .then(() => {
    $("loading").classList.add("hidden");
    $("learnmode").classList.remove("hidden");
    $("version").textContent = `Données Riot, patch ${version}${local ? " (hors ligne)" : " (en ligne)"}`;
    buildFilters();
    wire();
    rebuild();
    checkUpdate();
    Account.onChange(onAccountChange);
    if (Account.mode !== "local") onAccountChange(Account.mode);
    renderAccount();
    Account.init();
    $("dl-btn").onclick = downloadSection;
    updateDlButton();
    if (location.protocol.startsWith("http") && "serviceWorker" in navigator) {
      // une nouvelle version du site vient de s'installer : on recharge une fois pour l'afficher tout de suite
      const hadSw = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadSw && !reloaded) { reloaded = true; location.reload(); } });
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
    }
  })
  .catch((err) => {
    console.error(err);
    $("loading").textContent = "Impossible de charger les données. Lance mise-a-jour.bat (avec internet) ou vérifie ta connexion, puis recharge la page.";
  });
