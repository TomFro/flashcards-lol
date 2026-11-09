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
const prefs = Object.assign(
  { mode: "champ", all: false, lane: [], cls: [], key: [], tree: [], slot: [], itype: ["legendary", "boots"], irole: [], icon: false, name: false, review: false },
  store.get("flc_prefs", {}));

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
    fetch(`${DD}/cdn/${version}/data/fr_FR/runesReforged.json`).then((r) => r.json()),
    fetch(`${DD}/cdn/${version}/data/fr_FR/item.json`).then((r) => r.json()),
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
      cards.video.push({
        ...base, type: "video", id: `vid_${c.id}_${s.key}`,
        videos: [local && url.videoLocal(vkey, s.key), url.videoOnline(vkey, s.key)].filter(Boolean),
      });
    }
  }

  for (const tree of runes) {
    tree.slots.forEach((slot, i) => {
      for (const r of slot.runes) {
        cards.rune.push({
          id: `rune_${r.key}`, type: "rune", tree: tree.name, slot: i === 0 ? "keystone" : "minor",
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
    const statsHtml = (/<stats>([\s\S]*?)<\/stats>/.exec(it.description) || [])[1] || "";
    const stats = statsHtml.split(/<br\s*\/?>/i).map(clean).filter(Boolean);
    const effects = [...it.description.matchAll(/<(passive|active)>([\s\S]*?)<\/\1>/g)].map((m) => clean(m[2])).filter(Boolean);
    const roles = desc.who ? desc.who.split(" ") : guessRoles(tags);
    cards.item.push({
      id: `item_${id}`, type: "item", itype, name: it.name, icon: url.item(it.image.full), img: url.item(it.image.full),
      gold: it.gold.total, stats, roles, note: desc.note || "",
      short: desc.d || clean(it.plaintext) || firstEffect(it.description) || (effects.length ? `Effets : ${[...new Set(effects)].join(", ")}` : "Objet de stats"),
      official: clean(it.description.replace(/<br\s*\/?>/gi, " · ")),
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
  $("o-review").checked = prefs.review;
  $("o-name").checked = prefs.name;
  $("o-all").checked = prefs.all;
  $("o-all").onchange = (e) => { prefs.all = e.target.checked; saveAndRebuild(); };
  $("o-name").onchange = (e) => { prefs.name = e.target.checked; store.set("flc_prefs", prefs); show(); };
  $("o-icon").onchange = (e) => { prefs.icon = e.target.checked; store.set("flc_prefs", prefs); show(); };
  $("o-review").onchange = (e) => { prefs.review = e.target.checked; saveAndRebuild(); };
  $("f-search").oninput = () => rebuild();
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
  const allMode = prefs.mode === "champ" && prefs.all;
  document.body.className = `mode-${prefs.mode}${allMode ? " all-mode" : ""}`;
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
  if (prefs.review) deck = deck.filter((c) => (progress[c.id] ?? 0) < 3);
  const champs = new Set(deck.map((c) => c.champId)).size;
  $("count").textContent = prefs.mode === "rune" ? `${deck.length} runes`
    : prefs.mode === "item" ? `${deck.length} objets`
    : allMode ? `${deck.length} champions` : `${deck.length} cartes (${champs} champions)`;
  updateStats();
  next();
}

function updateStats() {
  const all = prefs.mode === "champ" && prefs.all ? cards.champAll : cards[prefs.mode];
  const known = all.filter((c) => (progress[c.id] ?? 0) >= 3).length;
  $("stats").innerHTML = `<b>${known}</b> / ${all.length} cartes maîtrisées`;
  $("stats-bar").style.width = all.length ? `${(100 * known) / all.length}%` : "0";
}

// Tirage pondéré : les cartes ratées ou jamais vues sortent beaucoup plus souvent.
function next() {
  closeDetail();
  $("card").classList.remove("flipped");
  $("answer").classList.add("hidden");
  $("spellbar").classList.add("hidden");
  $("hint").classList.toggle("hidden", deck.length === 0);
  if (deck.length === 0) {
    current = null;
    $("fr-video").pause();
    $("card").classList.add("hidden");
    $("empty").classList.remove("hidden");
    return;
  }
  $("empty").classList.add("hidden");
  const pool = deck.length > 1 ? deck.filter((c) => c.id !== lastId) : deck;
  const weights = pool.map((c) => 2 ** (5 - (progress[c.id] ?? 0)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  current = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { current = pool[i]; break; } }
  lastId = current.id;
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
  $("bk-who").innerHTML = c.type === "item" && c.roles.length
    ? `<span>Pour</span> ${c.roles.map((r) => ROLES[r]).join(", ")}${c.note ? `<em>${c.note}</em>` : ""}` : "";
  $("bk-cd").innerHTML = c.type === "item"
    ? (c.stats.length ? `<div class="cd-label">Statistiques</div>` + c.stats.map((x) => `<span class="cd stat">${x}</span>`).join("") : "")
    : c.cd && c.cd.length
    ? `<div class="cd-label">Cooldown (secondes)</div>` + c.cd.map((x) => `<span class="cd">${x}</span>`).join("")
    : "";
  $("bk-official").textContent = c.official;
  $("bk-details").open = false;
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
  $("answer").classList.toggle("hidden", !flipped);
  $("hint").classList.toggle("hidden", flipped);
  $("spellbar").classList.toggle("hidden", !flipped || !["champ", "video"].includes(current.type));
}

function answer(good) {
  if (!current || !$("card").classList.contains("flipped")) return;
  const box = progress[current.id] ?? 0;
  progress[current.id] = good ? Math.min(5, box + 1) : 0;
  store.set("flc_progress", progress);
  updateStats();
  if (prefs.review && good && progress[current.id] >= 3) deck = deck.filter((c) => c.id !== current.id);
  next();
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
  $("detail-tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === key));
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
function closeDetail() { $("card").classList.remove("detailed"); $("detail").dataset.k = ""; }
// touche du clavier français -> sort
const AZERTY = { Q: "A", W: "Z", E: "E", R: "R" };
const KEY_FROM_PRESS = { p: "P", a: "Q", q: "Q", z: "W", w: "W", e: "E", r: "R" };

function wire() {
  $("detail-close").onclick = (e) => { e.stopPropagation(); closeDetail(); };
  $("detail-tabs").querySelectorAll("button").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openDetail(b.dataset.k); }));
  $("spellbar").querySelectorAll("button").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openDetail(b.dataset.k); }));
  $("card").onclick = (e) => {
    if (e.target.closest("details, #edit, #detail, .all-row")) return;
    flip();
  };
  $("b-again").onclick = () => answer(false);
  $("b-good").onclick = () => answer(true);
  $("edit").onclick = () => {
    const id = current.id.replace(/^vid_/, ""); // même description pour la carte classique et la vidéo
    const text = prompt("Ta description courte pour cette carte (vide = remettre celle d'origine) :", custom[id] || current.short);
    if (text === null) return;
    if (text.trim()) custom[id] = text.trim(); else delete custom[id];
    store.set("flc_custom", custom);
    show();
  };
  $("reset").onclick = () => {
    if (!confirm("Effacer toute ta progression ?")) return;
    for (const k of Object.keys(progress)) delete progress[k];
    store.set("flc_progress", progress);
    rebuild();
  };
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (isDetail() && ["Space", "Enter"].includes(e.code)) { e.preventDefault(); closeDetail(); return; }
    if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); flip(); }
    else if (e.key === "1" || e.key === "ArrowLeft") answer(false);
    else if (e.key === "2" || e.key === "ArrowRight") answer(true);
    else if (e.key === "Escape") closeDetail();
    else if (KEY_FROM_PRESS[e.key.toLowerCase()] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = KEY_FROM_PRESS[e.key.toLowerCase()];
      if (isDetail() && $("detail").dataset.k === k) closeDetail(); else openDetail(k);
    }
  });
}

load()
  .then(() => {
    $("loading").classList.add("hidden");
    $("version").textContent = `Données Riot, patch ${version}${local ? " (hors ligne)" : " (en ligne)"}`;
    buildFilters();
    wire();
    rebuild();
    checkUpdate();
  })
  .catch((err) => {
    console.error(err);
    $("loading").textContent = "Impossible de charger les données. Lance mise-a-jour.bat (avec internet) ou vérifie ta connexion, puis recharge la page.";
  });
