// LoL Master : on ouvre des packs pour collectionner une carte de chaque champion, sort, objet et rune.
// Utilise les cartes déjà chargées par app.js (cards, champRaw, store, persist…).
const Master = (() => {
  const RAR = ["common", "rare", "epic", "legendary", "mythic"];
  const RAR_FR = { common: "Commune", rare: "Rare", epic: "Épique", legendary: "Légendaire", mythic: "Mythique" };
  const ODDS = [68, 24, 6.5, 1.3, 0.2];           // chances (en %) pour chaque carte d'un pack
  const PACK_SIZE = 5;
  const EVERY = 5 * 60e3, PER = 2;              // 2 packs toutes les 5 minutes
  const CAP = 10, START = 4;                    // packs gardés au maximum, packs offerts au départ
  const GOLD_START = 100, GOLD_PACK = 10;       // or au départ, or gagné par pack ouvert
  const RECYCLE = [5, 15, 60, 250, 1000];       // or rendu en recyclant un double, selon la rareté
  const V = 2;                                  // changer ce numéro remet toutes les collections à zéro
  const PITY_LEG = 50;                          // au pire, une Légendaire (ou mieux) tous les 50 packs
  const TYPES = { champ: "Champion", spell: "Sort", item: "Objet", rune: "Rune", skin: "Skin" };
  const TYPES_PL = { champ: "Champions", spell: "Sorts", item: "Objets", rune: "Runes", skin: "Skins" };
  // skins : jamais dans les packs normaux. Un pack sur 10 est spécial (6e carte = un skin), et on peut en acheter en or.
  const SPECIAL_EVERY = 10, SKIN_PRICE = 200;
  const SKIN_ODDS = [60, 28, 9, 2.5, 0.5];      // chances de rareté pour chaque skin tiré
  const SKIN_IN_PACK = 0.05;                    // % de chances qu'une carte d'un pack normal soit un skin (4 fois moins qu'une Mythique)
  // part de chaque type dans un pack : peu d'objets et de runes, car chaque exemplaire ne sert qu'à un perso
  const MIX = { champ: 33, spell: 57, item: 6, rune: 4 };
  // Pourquoi une carte a sa rareté (affiché sur la carte en grand)
  const PAGE = 60;
  const pct = (x) => `${x.toLocaleString("fr-FR")} %`;

  const fresh = () => ({ v: V, gold: GOLD_START, packs: START, t: Date.now(), inv: {}, at: {}, pity: { e: 0, l: 0 }, opened: 0, team: {} });
  const valid = (x) => (x && x.v === V ? x : null); // une collection d'une ancienne version est ignorée
  let s = Object.assign(fresh(), valid(store.get("flc_master", null)) || {});
  s.packs = Math.min(s.packs, CAP);
  let pool = null, byId = {}, byTypeRar = {};
  const ui = { type: [], rar: [], own: "all", q: "", sort: "rarity", shown: PAGE, tab: "cards" };
  Object.assign(ui, store.get("flc_master_ui", {}), { shown: PAGE, q: "" });
  let opening = null, timer = null;

  // ---------- Raretés des skins ----------
  // Rareté d'un skin = sa catégorie de prix chez Riot, lue dans skins.json de CommunityDragon (gardé une semaine dans le navigateur)
  const CDRAGON_SKINS = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/skins.json";
  const SKIN_TIER = { kNoRarity: 0, kRare: 1, kEpic: 1, kLegendary: 2, kMythic: 3, kUltimate: 4, kTranscendent: 4, kExalted: 4 };
  const SKIN_TIER_FR = ["skin à 975 RP ou moins", "skin à 1350 RP", "skin Légendaire (1820 RP)", "skin Prestige ou Mythique", "skin Ultime, Transcendant ou Exalté"];
  let skinTiers = store.get("flc_skin_tiers", null), skinLoad = false;
  async function loadSkinTiers() {
    if (skinLoad) return;
    skinLoad = true;
    if (skinTiers && Date.now() - skinTiers.t < 7 * 864e5) return;
    try {
      const res = await fetch(CDRAGON_SKINS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const map = {};
      for (const k of Object.values(data)) if (k && k.id != null && !k.isBase) map[k.id] = SKIN_TIER[k.rarity] ?? 0;
      skinTiers = { t: Date.now(), map };
      store.set("flc_skin_tiers", skinTiers);
      pool = null; byId = {}; byTypeRar = {}; // on recalcule les raretés avec les vraies catégories
      if (prefs.mode === "master" && !opening) render();
    } catch (e) { console.warn("Raretés des skins indisponibles, rangées d'après leur nom", e); }
  }

  // ---------- Raretés ----------
  // Rareté à partir des stats (master-rarity.js) : la plus haute rareté dont la carte atteint le seuil
  const ST = window.MASTER_STATS || { tiers: {}, champ: {}, item: {}, rune: {}, override: {}, source: {} };
  const tierOf = (v, th) => { for (let i = 0; i < 4; i++) if (v >= th[i]) return 4 - i; return 0; };
  const nth = (n, f) => (n === 1 ? (f ? "1re" : "1er") : `${n}e`);
  const ranks = (obj, keep) => {
    const out = {};
    Object.entries(obj).filter(([k]) => !keep || keep(k)).sort((a, b) => b[1] - a[1]).forEach(([k], i) => (out[k] = i + 1));
    return out;
  };
  const num = (x) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

  function build() {
    if (pool || !cards.champ.length) return;
    pool = [];
    const champR = {}, champRank = ranks(ST.champ);
    for (const c of cards.champAll) {
      const pr = ST.champ[c.champId] || 0;
      const r = tierOf(pr, ST.tiers.champ);
      champR[c.champId] = r;
      const raw = champRaw[c.champId];
      pool.push({
        id: `c_${c.champId}`, type: "champ", r, name: c.champ, sub: raw && raw.title ? raw.title : "",
        art: c.img, champ: c.champ, champId: c.champId, lanes: c.lanes,
        desc: (c.tags || []).map((x) => CLASSES[x] || x).join(" · ") + (c.lanes.length ? ` — ${c.lanes.map((l) => LANES[l].replace(/<svg[\s\S]*<\/svg>/, "")).join(", ")}` : ""),
        spells: c.spells,
        why: pr ? `Joué dans ${num(pr)} % des parties Challenger (${nth(champRank[c.champId])} champion le plus joué)` : "Presque jamais joué en Challenger",
      });
    }
    for (const c of cards.champAll) {
      const raw = champRaw[c.champId];
      for (const k of (raw && raw.skins) || []) {
        if (!k.num) continue; // skin de base
        const known = skinTiers && skinTiers.map ? skinTiers.map[k.id] : undefined;
        const r = known ?? (/prestige/i.test(k.name) ? 3 : 0);
        pool.push({
          id: `k_${c.champId}_${k.num}`, type: "skin", r, name: k.name, sub: c.champ, champ: c.champ, champId: c.champId, num: k.num,
          art: `${DD}/cdn/img/champion/loading/${c.champId}_${k.num}.jpg`, desc: "",
          why: known != null ? `Catégorie de Riot : ${SKIN_TIER_FR[r]}` : "Catégorie de Riot pas encore chargée : rangé d'après son nom",
        });
      }
    }
    const STEP = { R: 0, Q: 1, W: 1, E: 1, P: 2 };
    for (const c of cards.champ) {
      const cr = champR[c.champId] || 0;
      const r = c.key === "R" ? Math.max(1, cr) : Math.max(0, cr - STEP[c.key]);
      const what = c.key === "R" ? "ultime : même rareté que son champion (au moins Rare)" : c.key === "P" ? "passif : deux crans sous son champion" : "sort de base : un cran sous son champion";
      pool.push({
        id: `s_${c.champId}_${c.key}`, type: "spell", r,
        name: c.name, sub: `${c.champ} · ${c.key === "P" ? "Passif" : AZERTY[c.key]}`, key: c.key,
        art: c.img, icon: c.icon, champ: c.champ, champId: c.champId, desc: custom[c.id] || c.short, official: c.official, cd: c.cd,
        why: `${c.champ} a la rareté ${RAR_FR[RAR[cr]]} (Challenger) ; ${what}`,
      });
    }
    // objets : les bottes sont classées entre elles, le reste par taux d'achat
    const itemRank = ranks(ST.item, (k) => { const it = cards.item.find((x) => x.id === `item_${k}`); return it && !it.btier; });
    const bootsR = {};
    for (const c of cards.item.filter((x) => x.btier === 2)) bootsR[c.id.slice(5)] = tierOf(ST.item[c.id.slice(5)] || 0, ST.tiers.boots);
    for (const c of cards.item) {
      const n = c.id.slice(5), pr = ST.item[n];
      let r, why;
      if (c.btier === 2) { r = bootsR[n]; why = r >= 2 ? "Bottes parmi les plus achetées (Platine+)" : "Bottes moins achetées (Platine+)"; }
      else if (c.btier === 3) { r = Math.min(4, (bootsR[c.bfrom] ?? 1) + 1); why = "Bottes T3 : un cran au-dessus de leurs bottes de base"; }
      else if (c.itype !== "legendary") { r = 0; why = "Composant"; }
      else if (pr == null) { r = 1; why = "Pas de stats d'achat pour cet objet"; }
      else { r = tierOf(pr, ST.tiers.item); why = `${nth(itemRank[n])} objet le plus acheté (Platine+)`; }
      pool.push({
        id: `i_${n}`, type: "item", r, why, name: c.name,
        sub: `${c.btier === 3 ? "Bottes T3" : c.btier === 2 ? "Bottes" : c.itype === "legendary" ? "Objet complet" : "Composant"} · ${c.gold} PO`,
        icon: c.icon, desc: custom[c.id] || c.short, official: c.official, stats: c.stats, btier: c.btier, num: n,
      });
    }
    const keyIds = new Set(cards.rune.filter((x) => x.slot === "keystone").map((x) => String(x.rid)));
    const keyRank = ranks(ST.rune, (k) => keyIds.has(k)), minorRank = ranks(ST.rune, (k) => !keyIds.has(k));
    for (const c of cards.rune) {
      const key = c.id.slice(5), ks = c.slot === "keystone", pr = ST.rune[c.rid];
      const r = pr == null ? (ks ? 1 : 0) : tierOf(pr, ks ? ST.tiers.keystone : ST.tiers.minor);
      pool.push({
        id: `r_${key}`, type: "rune", r, name: c.name,
        sub: `${c.tree} · ${ks ? "Principale" : "Secondaire"}`,
        icon: c.icon, desc: custom[c.id] || c.short, official: c.official, slot: c.slot,
        why: pr == null ? "Pas de stats pour cette rune" : `${nth((ks ? keyRank : minorRank)[c.rid], true)} rune ${ks ? "principale" : "secondaire"} la plus prise (Platine+)`,
      });
    }
    // objets et runes : un cran plus rares, car un exemplaire suffit pour un build (pas de niveau à monter)
    for (const c of pool) if (c.type === "item" || c.type === "rune") {
      if (c.r < 4) c.r++;
      c.why += " · un cran plus rare : un seul exemplaire suffit pour un build";
    }
    for (const c of pool) {
      const o = (ST.override || {})[c.id];
      if (o && RAR.includes(o)) { c.r = RAR.indexOf(o); c.why = "Rareté choisie à la main"; }
    }
    byId = Object.fromEntries(pool.map((c) => [c.id, c]));
    for (const c of pool) ((byTypeRar[c.type] ||= {})[c.r] ||= []).push(c);
  }

  // ---------- Packs ----------
  function tick() {
    const now = Date.now();
    if (s.t > now) s.t = now; // horloge revenue en arrière
    if (s.packs >= CAP) { s.t = now; return false; }
    const n = Math.floor((now - s.t) / EVERY);
    if (n <= 0) return false;
    s.packs = Math.min(CAP, s.packs + n * PER);
    s.t = s.packs >= CAP ? now : s.t + n * EVERY;
    return true;
  }

  const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  function pickWeighted(w) {
    const entries = Object.entries(w).filter(([, v]) => v > 0);
    let x = rand() * entries.reduce((a, [, v]) => a + v, 0);
    for (const [k, v] of entries) { if ((x -= v) < 0) return k; }
    return entries[entries.length - 1][0];
  }
  function rollRarity(min, odds = ODDS) {
    const w = {};
    odds.forEach((p, i) => { if (i >= min) w[i] = p; });
    return +pickWeighted(w);
  }
  // Une carte de ce type et de cette rareté ; si le type n'en a pas, on prend la rareté la plus proche
  function pickCard(type, r, taken) {
    const t = byTypeRar[type] || {};
    for (let d = 0; d < 5; d++) {
      for (const rr of [r - d, r + d]) {
        const list = (t[rr] || []).filter((c) => !taken.has(c.id)); // pas deux fois la même carte dans un pack
        if (list && list.length) return list[Math.floor(rand() * list.length)];
      }
    }
    return null;
  }

  function makePack(special) {
    const w = MIX;
    const rs = [];
    for (let i = 0; i < PACK_SIZE; i++) rs.push(rollRarity(0)); // chaque carte est tirée indépendamment
    if (Math.max(...rs) < 3 && s.pity.l + 1 >= PITY_LEG) rs[PACK_SIZE - 1] = rollRarity(3);
    const taken = new Set();
    const out = rs.map((r) => {
      const surprise = rand() * 100 < SKIN_IN_PACK; // très rarement, un skin à la place d'une carte normale
      const c = surprise ? pickCard("skin", rollRarity(0, SKIN_ODDS), taken) : pickCard(pickWeighted(w), r, taken);
      if (c) taken.add(c.id);
      return c;
    }).filter(Boolean);
    const top = Math.max(...out.map((c) => c.r));
    s.pity.l = top >= 3 ? 0 : s.pity.l + 1;
    if (special) { const k = pickCard("skin", rollRarity(0, SKIN_ODDS), taken); if (k) out.push(k); }
    return out;
  }
  // ajoute les cartes à la collection, et les montre de la moins rare à la plus rare (le skin toujours en dernier)
  function receive(got, title) {
    const now = Math.floor(Date.now() / 60e3);
    const res = got.map((c) => {
      const before = s.inv[c.id] || 0;
      s.inv[c.id] = before + 1;
      if (!before) s.at[c.id] = now;
      return { c, isNew: !before, n: before + 1 };
    });
    res.sort((a, b) => (a.c.type === "skin") - (b.c.type === "skin") || a.c.r - b.c.r);
    // pack pas encore regardé : gardé pour le remontrer si la page se recharge pendant l'ouverture
    // (gardé sur cet appareil seulement : un autre appareil n'a pas à rouvrir ce pack)
    store.set("flc_master_unseen", { t: title || "", c: res.map((x) => [x.c.id, x.isNew ? 1 : 0, x.n]) });
    save();
    showOpening(res, title);
  }
  function resumeOpening() {
    const u = store.get("flc_master_unseen", null);
    const res = ((u && u.c) || []).map(([id, isNew, n]) => byId[id] && { c: byId[id], isNew: !!isNew, n }).filter(Boolean);
    if (!res.length) { localStorage.removeItem("flc_master_unseen"); return; }
    showOpening(res, "Ton dernier pack, que tu n'avais pas fini de regarder");
  }
  function seen() {
    try { localStorage.removeItem("flc_master_unseen"); } catch {}
  }
  function buySkin() {
    build();
    if (!pool || (s.gold || 0) < SKIN_PRICE) return;
    const k = pickCard("skin", rollRarity(0, SKIN_ODDS), new Set());
    if (!k) return;
    s.gold -= SKIN_PRICE;
    receive([k], "Skin acheté !");
  }

  function openPack() {
    tick();
    if (s.packs <= 0 || !pool) return;
    s.packs--;
    if (s.packs === CAP - 1) s.t = Date.now(); // le compteur repart quand on passe sous le maximum
    s.opened++;
    s.gold = (s.gold || 0) + GOLD_PACK;
    const special = s.opened % SPECIAL_EVERY === 0;
    receive(makePack(special), special ? "Pack spécial : la dernière carte est un skin !" : "");
  }

  // ---------- Enregistrement ----------
  // hist : petites étiquettes ajoutées à chaque enregistrement. Elles permettent de savoir si une collection
  // est la suite d'une autre (même appareil, ou appareil à jour) ou si deux appareils ont joué chacun de leur côté.
  const tok = () => Math.random().toString(36).slice(2, 8);
  const lastTok = (x) => (x && x.hist && x.hist.length ? x.hist[x.hist.length - 1] : null);
  function merge(a, b) {
    a = valid(a); b = valid(b);
    if (!a || !b) return a || b;
    const la = lastTok(a), lb = lastTok(b);
    if (la && la === lb) return a;
    if (la && (b.hist || []).includes(la)) return b; // b est la suite de a
    if (lb && (a.hist || []).includes(lb)) return a; // a est la suite de b
    // deux appareils ont joué chacun de leur côté : on garde toutes les cartes des deux
    const [hi, lo] = (b.opened || 0) > (a.opened || 0) ? [b, a] : [a, b];
    const m = JSON.parse(JSON.stringify(hi));
    m.inv ||= {}; m.at ||= {};
    for (const [id, n] of Object.entries(lo.inv || {})) {
      if (n > (m.inv[id] || 0)) { m.inv[id] = n; if (!m.at[id] && lo.at && lo.at[id]) m.at[id] = lo.at[id]; }
    }
    m.gold = Math.max(a.gold || 0, b.gold || 0);
    m.hist = [...(hi.hist || []).slice(-150), ...(lo.hist || []).slice(-40), tok()];
    return m;
  }

  function save() {
    s.hist = [...(s.hist || []).slice(-199), tok()];
    if (isGuest()) { store.set("flc_master_guest", s); return; } // invité : gardé à part, passé au compte à l'inscription
    store.set("flc_master", s);
    if (isOnlineUser()) store.set("flc_unsynced", true);
    if (Account.mode === "user") { persist(); publishSoon(); }
  }
  function setState(n) {
    const old = n && !valid(n);
    s = Object.assign(fresh(), valid(n) || {});
    s.pity = Object.assign({ e: 0, l: 0 }, s.pity);
    s.team = s.team || {};
    s.packs = Math.min(s.packs, CAP);
    if (old) save(); // remise à zéro : on enregistre tout de suite la nouvelle collection
    if (prefs.mode === "master") render();
  }
  // garde la collection la plus avancée (celle qui a ouvert le plus de packs)
  const pick = (a, b) => { a = valid(a); b = valid(b); return !a ? b : !b ? a : (b.opened || 0) > (a.opened || 0) ? b : a; };

  // ---------- Affichage ----------
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

  function cardHtml(c, { n = 0, back = false, big = false, isNew = false } = {}) {
    const missing = n === 0 && !back && !isNew;
    const art = c.type === "champ" || c.type === "skin"
      ? `<img class="mc-champ" src="${c.art}" alt="" decoding="async">`
      : `${c.art ? `<img class="mc-blur" src="${c.art}" alt="" decoding="async">` : ""}<img class="mc-icon" src="${c.icon}" alt="" decoding="async">`;
    // pas de loading="lazy" : certaines images de skins ne se chargeaient jamais (la grille est déjà limitée à 60 cartes à la fois)
    const keyBadge = c.type === "spell" ? `<div class="key mc-key"><b>${c.key === "P" ? "P" : AZERTY[c.key]}</b></div>` : "";
    return `<div class="mc r-${RAR[c.r]} t-${c.type}${missing ? " missing" : ""}${big ? " big" : ""}" data-id="${c.id}">
      <div class="mc-frame">
        <div class="mc-art">${art}${keyBadge}</div>
        <div class="mc-gem" title="${RAR_FR[RAR[c.r]]}"></div>
        <div class="mc-body">
          <div class="mc-type">${TYPES[c.type]} · <span>${RAR_FR[RAR[c.r]]}</span></div>
          <div class="mc-name">${esc(c.name)}</div>
          <div class="mc-sub">${esc(c.sub)}</div>
          <div class="mc-desc">${esc(c.desc)}</div>
        </div>
        ${n > 1 ? `<div class="mc-count">×${n}</div>` : ""}
        ${isNew ? `<div class="mc-new">Nouvelle !</div>` : ""}
      </div>
    </div>`;
  }

  function chipRow(el, options, key) {
    el.innerHTML = "";
    for (const [val, label] of Object.entries(options)) {
      const b = document.createElement("button");
      b.innerHTML = label;
      const on = Array.isArray(ui[key]) ? ui[key].includes(val) : ui[key] === val;
      b.classList.toggle("on", on);
      b.onclick = () => {
        if (Array.isArray(ui[key])) {
          const i = ui[key].indexOf(val);
          i >= 0 ? ui[key].splice(i, 1) : ui[key].push(val);
        } else ui[key] = val;
        ui.shown = PAGE;
        saveUi();
        renderFilters(); renderGrid();
      };
      el.appendChild(b);
    }
  }
  const saveUi = () => store.set("flc_master_ui", { type: ui.type, rar: ui.rar, own: ui.own, sort: ui.sort, tab: ui.tab, mute: ui.mute });

  function renderPacks() {
    tick();
    $("m-count").textContent = s.packs;
    $("m-open").disabled = s.packs <= 0;
    $("m-open").textContent = s.packs > 0 ? "Ouvrir un pack" : "Plus de pack";
    if (s.packs >= CAP) $("m-timer").textContent = `Maximum atteint (${CAP} packs) : ouvre-en pour en regagner`;
    else {
      const left = Math.max(0, s.t + EVERY - Date.now());
      const m = Math.floor(left / 60e3), sec = Math.floor((left % 60e3) / 1000);
      $("m-timer").textContent = `+${PER} packs dans ${m}:${String(sec).padStart(2, "0")}`;
    }
    $("m-guest").classList.toggle("hidden", !isGuest());
    const left = SPECIAL_EVERY - (s.opened % SPECIAL_EVERY);
    $("m-special").textContent = (left === 1 ? "Le prochain pack est spécial : 6 cartes dont un skin !" : `Pack spécial avec un skin dans ${left} packs`) + ` · ${s.gold || 0} or`;
    $("m-skin").textContent = `Acheter un skin (${SKIN_PRICE} or)`;
    $("m-skin").disabled = (s.gold || 0) < SKIN_PRICE;
  }

  function renderProgress() {
    const base = pool.filter((c) => c.type !== "skin"), skins = pool.filter((c) => c.type === "skin");
    const owned = base.filter((c) => s.inv[c.id]).length, ownedSkins = skins.filter((c) => s.inv[c.id]).length;
    let html = `<div class="m-total"><b>${owned}</b> / ${base.length} cartes · ${s.opened} pack${s.opened > 1 ? "s" : ""} ouvert${s.opened > 1 ? "s" : ""}</div>`;
    for (let r = RAR.length - 1; r >= 0; r--) {
      const all = base.filter((c) => c.r === r);
      const have = all.filter((c) => s.inv[c.id]).length;
      html += `<div class="m-rbar r-${RAR[r]}"><span>${RAR_FR[RAR[r]]}</span><div class="bar"><i style="width:${all.length ? (100 * have) / all.length : 0}%"></i></div><em>${have}/${all.length}</em></div>`;
    }
    html += `<div class="m-rbar skins"><span>Skins</span><div class="bar"><i style="width:${skins.length ? (100 * ownedSkins) / skins.length : 0}%"></i></div><em>${ownedSkins}/${skins.length}</em></div>`;
    $("m-progress").innerHTML = html;
    $("stats").innerHTML = `<b>${owned}</b> / ${base.length} cartes collectionnées`;
    $("stats-bar").style.width = `${(100 * owned) / base.length}%`;
  }

  function renderFilters() {
    chipRow($("m-ftype"), TYPES_PL, "type");
    chipRow($("m-frar"), Object.fromEntries(RAR.map((r) => [String(RAR.indexOf(r)), RAR_FR[r]])), "rar");
    chipRow($("m-fown"), { all: "Toutes", have: "Possédées", missing: "Manquantes", dup: "Doubles", new: "Récentes" }, "own");
    $("m-sort").value = ui.sort;
  }

  function filtered() {
    const q = ui.q.toLowerCase();
    const recent = Math.floor(Date.now() / 60e3) - 24 * 60;
    const list = pool.filter((c) => {
      const n = s.inv[c.id] || 0;
      if (ui.type.length && !ui.type.includes(c.type)) return false;
      if (ui.rar.length && !ui.rar.includes(String(c.r))) return false;
      if (ui.own === "have" && !n) return false;
      if (ui.own === "missing" && n) return false;
      if (ui.own === "dup" && n < 2) return false;
      if (ui.own === "new" && !(n && s.at[c.id] >= recent)) return false;
      if (q && !(`${c.name} ${c.champ || ""} ${c.sub}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const byName = (a, b) => a.name.localeCompare(b.name);
    const sorts = {
      rarity: (a, b) => b.r - a.r || a.type.localeCompare(b.type) || byName(a, b),
      name: byName,
      count: (a, b) => (s.inv[b.id] || 0) - (s.inv[a.id] || 0) || b.r - a.r || byName(a, b),
      recent: (a, b) => (s.at[b.id] || 0) - (s.at[a.id] || 0) || b.r - a.r || byName(a, b),
      type: (a, b) => a.type.localeCompare(b.type) || (a.champ || "").localeCompare(b.champ || "") || "PQWER".indexOf(a.key) - "PQWER".indexOf(b.key) || byName(a, b),
    };
    return list.sort(sorts[ui.sort] || sorts.rarity);
  }

  function renderGrid() {
    const list = filtered();
    $("m-found").textContent = `${list.length} carte${list.length > 1 ? "s" : ""}`;
    $("m-grid").innerHTML = list.length
      ? list.slice(0, ui.shown).map((c) => cardHtml(c, { n: s.inv[c.id] || 0 })).join("")
      : `<div class="m-none">Aucune carte avec ces filtres.</div>`;
    $("m-more").classList.toggle("hidden", list.length <= ui.shown);
    $("m-more").textContent = `Afficher plus (${list.length - ui.shown} restantes)`;
  }

  function render() {
    build();
    loadSkinTiers();
    if (!pool) return;
    tick();
    document.querySelectorAll("#m-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === ui.tab));
    for (const t of ["cards", "team", "players", "market"]) $(`m-${t}`).classList.toggle("hidden", ui.tab !== t);
    $("m-top").classList.toggle("hidden", ui.tab !== "cards" && ui.tab !== "team");
    renderPacks();
    renderProgress();
    if (ui.tab === "team") renderTeam();
    else if (ui.tab === "players") renderPlayers();
    else if (ui.tab === "market") renderMarket();
    else { renderFilters(); renderGrid(); }
    clearInterval(timer);
    timer = setInterval(() => {
      if (prefs.mode !== "master") return clearInterval(timer);
      const before = s.packs;
      renderPacks();
      if (s.packs !== before) save();
    }, 1000);
    if (!opening && store.get("flc_master_unseen", null)) resumeOpening();
  }

  // ---------- Sons ----------
  // les vrais pings du jeu (dossier sons/), du plus discret au plus marquant :
  // Commune = ping simple, Rare = « ? » (ennemi disparu), Épique = « à l'aide », Légendaire = « danger », Mythique = « all-in »
  const PING_FILES = ["commune", "rare", "epique", "legendaire", "mythique"];
  let actx = null, buffers = null;
  function loadPings() {
    if (buffers) return;
    buffers = [];
    PING_FILES.forEach((f, i) => fetch(`sons/${f}.mp3`).then((r) => r.arrayBuffer())
      .then((b) => new Promise((ok, ko) => actx.decodeAudioData(b, ok, ko)))
      .then((buf) => (buffers[i] = buf)).catch(() => {}));
  }
  function ping(r) {
    if (ui.mute) return;
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      loadPings();
      if (buffers[r]) {
        const src = actx.createBufferSource(), g = actx.createGain();
        src.buffer = buffers[r];
        g.gain.value = 0.6;
        src.connect(g).connect(actx.destination);
        src.start();
        return;
      }
      // son pas encore chargé (ou hors ligne) : petit son fabriqué à la place
      const t0 = actx.currentTime + 0.01;
      const out = actx.createGain();
      out.gain.value = 0.25;
      out.connect(actx.destination);
      const tone = (f, at, dur, type = "sine", vol = 0.8) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f, t0 + at);
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        o.connect(g).connect(out);
        o.start(t0 + at);
        o.stop(t0 + at + dur + 0.05);
      };
      [
        () => tone(1320, 0, 0.16, "sine", 0.5),                                                     // Commune : petit « tic »
        () => { tone(740, 0, 0.15, "triangle"); tone(1110, 0.1, 0.28, "triangle"); },               // Rare : deux notes qui montent, comme un ping « ? »
        () => [784, 988, 1175].forEach((f, i) => tone(f, i * 0.08, 0.34, "triangle")),            // Épique : petit arpège, comme le ping « assistance »
        () => [0, 0.22].forEach((at) => { tone(1245, at, 0.13, "square", 0.3); tone(932, at + 0.1, 0.15, "square", 0.3); }), // Légendaire : alerte, comme le ping « danger »
        () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.07, 0.9, "sine", 0.5)); tone(2093, 0.4, 1.2, "sine", 0.3); }, // Mythique : carillon
      ][r]();
    } catch {}
  }
  function renderSound() {
    $("m-sound").textContent = ui.mute ? "🔇 Son coupé" : "🔊 Son";
  }

  // ---------- Ouverture ----------
  let openTitle = "";
  function showOpening(res, title = "") {
    if (!ui.mute) { try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); loadPings(); } catch {} }
    opening = res;
    openTitle = title;
    const box = $("m-opening");
    box.classList.remove("hidden");
    $("m-reveal").innerHTML = res.map((x, i) =>
      `<div class="m-slot r-${RAR[x.c.r]}" data-i="${i}" style="--d:${i * 70}ms"><div class="m-flip">
        <div class="m-face m-down"><div class="m-down-logo">LoL<br>Master</div></div>
        <div class="m-face m-up">${cardHtml(x.c, { n: x.n, back: true, isNew: x.isNew })}</div>
      </div></div>`).join("");
    $("m-reveal").querySelectorAll(".m-slot").forEach((el) => (el.onclick = () => reveal(el)));
    updateOpeningButtons();
  }
  function reveal(el) {
    if (el.classList.contains("shown")) { // déjà retournée : on l'affiche en grand
      return view(opening[+el.dataset.i].c.id);
    }
    el.classList.add("shown");
    ping(opening[+el.dataset.i].c.r);
    updateOpeningButtons();
  }
  function updateOpeningButtons() {
    const hidden = $("m-reveal").querySelectorAll(".m-slot:not(.shown)").length;
    if (hidden === 0) seen();
    $("m-all").classList.toggle("hidden", hidden === 0);
    $("m-again").classList.toggle("hidden", hidden > 0 || s.packs <= 0);
    $("m-again").textContent = `Ouvrir le suivant (${s.packs})`;
    $("m-close").textContent = hidden > 0 ? "Fermer" : "Voir ma collection";
    if (hidden === 0) {
      const nNew = opening.filter((x) => x.isNew).length;
      $("m-summary").textContent = nNew ? `${nNew} nouvelle${nNew > 1 ? "s" : ""} carte${nNew > 1 ? "s" : ""} !` : "Que des doubles cette fois.";
    } else $("m-summary").textContent = openTitle || "Touche les cartes pour les retourner";
  }
  function revealAll() {
    $("m-reveal").querySelectorAll(".m-slot:not(.shown)").forEach((el, i) => setTimeout(() => {
      if (!opening || el.classList.contains("shown")) return;
      el.classList.add("shown");
      ping(opening[+el.dataset.i].c.r);
      updateOpeningButtons();
    }, i * 260));
  }
  function closeOpening() {
    $("m-opening").classList.add("hidden");
    opening = null;
    seen();
    render();
  }


  // ---------- Équipe ----------
  // Un champion possédé par poste. Son niveau vient de ses cartes, le rang de ses sorts de leurs doubles.
  // Chaque exemplaire d'objet ou de rune ne peut équiper qu'un seul perso.
  const ROLES = {
    top: { name: "Top", quest: "Quête du Top : peut monter jusqu'au niveau 20" },
    jungle: { name: "Jungle", quest: "Quête de la Jungle : familier évolué, +10 % de vitesse de déplacement" },
    mid: { name: "Mid", quest: "Quête du Mid : seul poste qui peut porter des bottes T3" },
    adc: { name: "ADC", quest: "Quête de l'ADC : un 7e emplacement réservé aux bottes" },
    support: { name: "Support", quest: "Quête du Support : +10 % de puissance des soins et boucliers" },
  };
  const RUNE_SLOTS = ["keystone", "minor", "minor", "minor"];
  const MAX_RANK = { P: 1, Q: 5, W: 5, E: 5, R: 3 };
  const roleIcon = (r) => LANES[r].replace(/<\/svg>[\s\S]*$/, "</svg>");

  const slot = (role) => (s.team[role] ||= { c: null, it: [], ru: [] });
  const itemSlots = (role) => (role === "adc" ? 7 : 6);
  const spellRank = (champId, key) => Math.min(MAX_RANK[key], 1 + (s.inv[`s_${champId}_${key}`] || 0));
  // niveau : 1, +2 par double du champion, +1 par carte de ses sorts (passif compris)
  function champLevel(champId, role, inv = s.inv) {
    const copies = inv[`c_${champId}`] || 0;
    let pts = 2 * Math.max(0, copies - 1);
    for (const k of "PQWER") pts += inv[`s_${champId}_${k}`] || 0;
    const cap = role === "top" ? 20 : 18;
    return { lvl: Math.min(cap, 1 + pts), cap };
  }
  // combien d'exemplaires d'une carte sont déjà utilisés dans l'équipe (sauf à un endroit donné)
  function used(id, except) {
    let n = 0;
    for (const [role, t] of Object.entries(s.team)) {
      (t.it || []).forEach((x, i) => { if (x && `i_${x}` === id && !(except && except.role === role && except.kind === "it" && except.i === i)) n++; });
      (t.ru || []).forEach((x, i) => { if (x && `r_${x}` === id && !(except && except.role === role && except.kind === "ru" && except.i === i)) n++; });
    }
    return n;
  }

  // ---- stats : données de Riot du champion au niveau voulu + stats des objets ----
  const STAT_KEYS = [
    [/d[ée]g[âa]ts d'attaque/, "ad"], [/^puissance( magique)?$/, "ap"], [/^points de vie$|^pv$/, "hp"], [/^mana$/, "mana"],
    [/^armure$/, "armor"], [/r[ée]sistance magique/, "mr"], [/vitesse d'attaque/, "as"], [/coup critique/, "crit"],
    [/vitesse de d[ée]placement/, "ms"], [/acc[ée]l[ée]ration de comp[ée]tence/, "ah"], [/l[ée]talit[ée]/, "leth"],
    [/p[ée]n[ée]tration magique/, "mpen"], [/p[ée]n[ée]tration d'armure/, "apen"], [/vol de vie/, "ls"], [/omnivamp/, "omni"],
  ];
  function itemStats(ids) {
    const sum = {}, extra = {};
    for (const num of ids) {
      const c = byId[`i_${num}`];
      for (const line of (c && c.stats) || []) {
        const m = /^([+-]?[\d\s.,]+)\s*(%?)\s*(.+)$/.exec(line.trim());
        if (!m) continue;
        const v = parseFloat(m[1].replace(/\s/g, "").replace(",", "."));
        const label = m[3].trim();
        const hit = STAT_KEYS.find(([re]) => re.test(label.toLowerCase()));
        const key = hit ? hit[1] + (m[2] ? "%" : "") : `${m[2]}|${label}`;
        (hit ? sum : extra)[key] = ((hit ? sum : extra)[key] || 0) + v;
      }
    }
    return { sum, extra };
  }
  function statsHtml(role) {
    const t = slot(role), raw = champRaw[t.c];
    const st = raw && raw.stats;
    if (!st) return "";
    const { lvl } = champLevel(t.c, role);
    const g = (base, per) => base + per * (lvl - 1) * (0.7025 + 0.0175 * (lvl - 1)); // formule de croissance de Riot
    const { sum, extra } = itemStats(t.it.filter(Boolean));
    const n = (k) => sum[k] || 0;
    const r0 = (x) => Math.round(x);
    const as = Math.min(2.5, st.attackspeed * (1 + (n("as%") + g(0, st.attackspeedperlevel)) / 100));
    let ms = (st.movespeed + n("ms")) * (1 + n("ms%") / 100);
    if (role === "jungle") ms *= 1.1;
    const resource = raw.partype === "Mana" ? "Mana" : raw.partype;
    const rows = [
      ["Points de vie", r0(g(st.hp, st.hpperlevel) + n("hp"))],
      st.mp > 0 && [resource || "Ressource", r0(g(st.mp, st.mpperlevel) + (raw.partype === "Mana" ? n("mana") : 0))],
      ["Dégâts d'attaque", r0(g(st.attackdamage, st.attackdamageperlevel) + n("ad"))],
      n("ap") && ["Puissance", r0(n("ap"))],
      ["Armure", r0(g(st.armor, st.armorperlevel) + n("armor"))],
      ["Résistance magique", r0(g(st.spellblock, st.spellblockperlevel) + n("mr"))],
      ["Vitesse d'attaque", as.toFixed(2).replace(".", ",")],
      n("crit%") && ["Coup critique", `${r0(n("crit%"))} %`],
      ["Vitesse de déplacement", r0(ms)],
      ["Portée", r0(st.attackrange)],
      n("ah") && ["Accélération de compétence", r0(n("ah"))],
      n("leth") && ["Létalité", r0(n("leth"))],
      n("apen%") && ["Pénétration d'armure", `${r0(n("apen%"))} %`],
      (n("mpen") || n("mpen%")) && ["Pénétration magique", [n("mpen") && r0(n("mpen")), n("mpen%") && `${r0(n("mpen%"))} %`].filter(Boolean).join(" + ")],
      n("ls%") && ["Vol de vie", `${r0(n("ls%"))} %`],
      n("omni%") && ["Omnivampirisme", `${r0(n("omni%"))} %`],
      role === "support" && ["Soins et boucliers", "+10 %"],
      ...Object.entries(extra).map(([k, v]) => { const [p, label] = k.split("|"); return [label, `${r0(v)}${p ? " %" : ""}`]; }),
    ].filter(Boolean);
    return `<div class="tm-stats">${rows.map(([a, b]) => `<span>${esc(a)}</span><b>${b}</b>`).join("")}</div>`;
  }

  function renderTeam() {
    let total = 0;
    const html = Object.entries(ROLES).map(([role, R]) => {
      const t = slot(role);
      const head = `<div class="tm-rhead">${roleIcon(role)}<b>${R.name}</b></div><div class="tm-quest">${R.quest}</div>`;
      if (!t.c || !s.inv[`c_${t.c}`]) {
        t.c = null;
        return `<div class="tm-role empty">${head}<button class="tm-pick btn good" data-role="${role}">+ Choisir un champion</button></div>`;
      }
      const c = byId[`c_${t.c}`];
      const sk = skinOf(t, s.inv);
      const mySkins = pool.filter((x) => x.type === "skin" && x.champId === t.c && s.inv[x.id]).length;
      const { lvl, cap } = champLevel(t.c, role);
      total += lvl;
      const spells = "PQWER".split("").map((k) => {
        const sp = byId[`s_${t.c}_${k}`];
        if (!sp) return "";
        const rank = spellRank(t.c, k), max = MAX_RANK[k];
        const cd = k !== "P" && sp.cd && sp.cd.length ? sp.cd[Math.min(rank, sp.cd.length) - 1] : "";
        return `<div class="tm-spell${s.inv[sp.id] ? "" : " locked"}" title="${esc(sp.name)}${k === "P" ? "" : ` · rang ${rank}/${max}`}${cd ? ` · ${cd} s` : ""}">
          <img src="${sp.icon}" alt=""><span class="tm-k">${k === "P" ? "P" : AZERTY[k]}</span>
          ${k === "P" ? "" : `<i class="tm-pips">${"<u class=on></u>".repeat(rank)}${"<u></u>".repeat(max - rank)}</i>`}
          ${cd ? `<em>${cd}s</em>` : ""}</div>`;
      }).join("");
      const nItems = itemSlots(role);
      const items = Array.from({ length: nItems }, (_, i) => {
        const num = t.it[i];
        const it = num && byId[`i_${num}`];
        return `<button class="tm-slot${it ? ` r-${RAR[it.r]}` : ""}${role === "adc" && i === 6 ? " boots" : ""}" data-role="${role}" data-kind="it" data-i="${i}" title="${it ? esc(it.name) : role === "adc" && i === 6 ? "Emplacement de bottes" : "Ajouter un objet"}">${it ? `<img src="${it.icon}" alt="">` : role === "adc" && i === 6 ? "👢" : "+"}</button>`;
      }).join("");
      const runes = RUNE_SLOTS.map((kind, i) => {
        const key = t.ru[i];
        const ru = key && byId[`r_${key}`];
        return `<button class="tm-slot rune${i === 0 ? " ks" : ""}${ru ? ` r-${RAR[ru.r]}` : ""}" data-role="${role}" data-kind="ru" data-i="${i}" title="${ru ? esc(ru.name) : i === 0 ? "Rune principale" : "Rune secondaire"}">${ru ? `<img src="${ru.icon}" alt="">` : "+"}</button>`;
      }).join("");
      const next = lvl >= cap ? "Niveau max" : "Prochain niveau : 1 carte d'un de ses sorts, ou un double";
      return `<div class="tm-role r-${RAR[c.r]}">${head}
        <div class="tm-champ" data-role="${role}" title="Changer de champion"><img src="${sk ? sk.art : c.art}" alt=""><div class="tm-lvl">${lvl}</div>
          <div class="tm-cname"><b>${esc(c.name)}</b><span>Niveau ${lvl} / ${cap}</span></div></div>
        <div class="tm-next">${next}</div>
        <div class="tm-spells">${spells}</div>
        <h4>Skin</h4>
        <button class="tm-skin${sk ? ` r-${RAR[sk.r]}` : ""}" data-role="${role}" title="Changer de skin">
          <i class="tm-skinbox">${sk ? `<img src="${sk.art}" alt="">` : "+"}</i>
          <span><b>${sk ? esc(sk.name) : "Skin de base"}</b><em>${mySkins ? `${mySkins} skin${mySkins > 1 ? "s" : ""} pour ce champion : touche pour changer` : "Aucun skin pour ce champion pour l'instant"}</em></span>
        </button>
        <h4>Objets</h4><div class="tm-items">${items}</div>
        <h4>Runes</h4><div class="tm-items">${runes}</div>
        ${statsHtml(role)}
      </div>`;
    }).join("");
    $("m-team-grid").innerHTML = html;
    $("m-team-total").textContent = `Niveau total de l'équipe : ${total}`;
    $("m-team-grid").querySelectorAll(".tm-pick, .tm-champ").forEach((el) => (el.onclick = () => pickChamp(el.dataset.role)));
    $("m-team-grid").querySelectorAll(".tm-skin").forEach((el) => (el.onclick = () => pickSkin(el.dataset.role)));
    $("m-team-grid").querySelectorAll(".tm-slot").forEach((el) => (el.onclick = () => pickGear(el.dataset.role, el.dataset.kind, +el.dataset.i)));
  }

  // skin équipé sur le champion d'un poste (purement visuel), s'il est toujours possédé
  const skinOf = (t, inv) => (t && t.sk && t.c && t.sk.startsWith(`k_${t.c}_`) && inv[t.sk] ? byId[t.sk] : null);
  function pickSkin(role) {
    const t = slot(role);
    const opts = pool.filter((x) => x.type === "skin" && x.champId === t.c && s.inv[x.id])
      .map((x) => ({ c: x, v: x.id, img: x.art, search: x.name, note: `${RAR_FR[RAR[x.r]]}${t.sk === x.id ? " · équipé" : ""}` }))
      .sort((a, b) => b.c.r - a.c.r || a.c.name.localeCompare(b.c.name));
    openPicker(`Skin de ${byId[`c_${t.c}`].name} (✕ = skin de base)`, opts, (id) => { t.sk = id || null; save(); renderTeam(); }, true);
  }

  // ---- choix dans une liste ----
  // lanes : affiche des filtres par poste (Tous par défaut, quel que soit le poste choisi)
  function openPicker(title, options, onPick, removable, lanes) {
    $("m-pick-title").textContent = title;
    $("m-pick-search").value = "";
    let lane = "";
    const fbox = $("m-pick-lanes");
    fbox.classList.toggle("hidden", !lanes);
    if (lanes) {
      fbox.innerHTML = `<button data-l="" class="on">Tous</button>` + Object.keys(ROLES).map((r) => `<button data-l="${r}">${roleIcon(r)}${ROLES[r].name}</button>`).join("");
      fbox.querySelectorAll("button").forEach((b) => (b.onclick = () => {
        lane = b.dataset.l;
        fbox.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        draw();
      }));
    }
    const draw = () => {
      const q = $("m-pick-search").value.trim().toLowerCase();
      const list = options.filter((o) => (!q || o.search.toLowerCase().includes(q)) && (!lane || (o.c.lanes || []).includes(lane)));
      $("m-pick-list").innerHTML = (removable ? `<button class="pk pk-remove" data-v="">✕ Retirer</button>` : "")
        + (list.length ? list.map((o) => `<button class="pk r-${RAR[o.c.r]}${o.off ? " off" : ""}" data-v="${o.v}" ${o.off ? "disabled" : ""}>
            <img src="${o.img}" alt=""><span><b>${esc(o.c.name)}</b><em>${esc(o.note)}</em></span></button>`).join("")
          : `<div class="m-none">${lane || q ? "Aucune carte avec ces filtres." : "Aucune carte disponible. Ouvre des packs pour en trouver !"}</div>`);
      $("m-pick-list").querySelectorAll(".pk:not(.off)").forEach((b) => (b.onclick = () => { closePicker(); onPick(b.dataset.v || null); }));
    };
    $("m-pick-search").oninput = draw;
    draw();
    $("m-pick").classList.remove("hidden");
  }
  const closePicker = () => $("m-pick").classList.add("hidden");

  function pickChamp(role) {
    const where = {};
    for (const [r, t] of Object.entries(s.team)) if (t.c) where[t.c] = r;
    const champs = pool.filter((c) => c.type === "champ" && s.inv[c.id]).map((c) => {
      const fits = (c.lanes || []).includes(role);
      const { lvl } = champLevel(c.champId, role);
      const other = where[c.champId] && where[c.champId] !== role ? ` · déjà en ${ROLES[where[c.champId]].name} (échange)` : "";
      return { c, v: c.champId, img: c.art, fits, lvl, search: c.name, note: `Niveau ${lvl}${fits ? "" : " · hors poste"}${other}` };
    }).sort((a, b) => b.fits - a.fits || b.lvl - a.lvl || a.c.name.localeCompare(b.c.name));
    openPicker(`Champion pour le poste ${ROLES[role].name}`, champs, (id) => {
      if (!id) return;
      const t = slot(role);
      const from = where[id];
      if (from && from !== role) { // échange de poste entre les deux champions
        const f = slot(from);
        [f.c, t.c] = [t.c, f.c];
        [f.sk, t.sk] = [t.sk, f.sk];
      } else if (t.c !== id) { t.c = id; }
      save();
      renderTeam();
    }, false, true);
  }

  function pickGear(role, kind, i) {
    const t = slot(role);
    const cur = (kind === "it" ? t.it : t.ru)[i];
    const except = { role, kind, i };
    let options;
    if (kind === "it") {
      const bootsOnly = role === "adc" && i === 6;
      const otherBoots = t.it.some((x, j) => j !== i && x && byId[`i_${x}`] && byId[`i_${x}`].btier);
      options = pool.filter((c) => c.type === "item" && s.inv[c.id]).map((c) => {
        const free = s.inv[c.id] - used(c.id, except);
        let why = "";
        if (free <= 0) why = "tous les exemplaires sont déjà équipés";
        else if (t.it.some((x, j) => j !== i && `i_${x}` === c.id)) why = "déjà dans ce build";
        else if (bootsOnly && !c.btier) why = "emplacement réservé aux bottes";
        else if (role === "adc" && !bootsOnly && c.btier) why = "les bottes vont dans l'emplacement de bottes";
        else if (c.btier && otherBoots) why = "une seule paire de bottes";
        else if (c.btier === 3 && role !== "mid") why = "bottes T3 : seulement pour le Mid";
        return { c, v: c.num, img: c.icon, off: !!why, search: c.name, note: why || `${free} exemplaire${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""} · ${c.sub}` };
      });
    } else {
      const wantKey = i === 0;
      options = pool.filter((c) => c.type === "rune" && s.inv[c.id] && (c.slot === "keystone") === wantKey).map((c) => {
        const free = s.inv[c.id] - used(c.id, except);
        const key = c.id.slice(2);
        let why = "";
        if (free <= 0) why = "tous les exemplaires sont déjà équipés";
        else if (t.ru.some((x, j) => j !== i && x === key)) why = "déjà sur ce perso";
        return { c, v: key, img: c.icon, off: !!why, search: c.name, note: why || `${free} exemplaire${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""} · ${c.sub}` };
      });
    }
    options.sort((a, b) => a.off - b.off || b.c.r - a.c.r || a.c.name.localeCompare(b.c.name));
    const title = kind === "it" ? `Objet pour ${byId[`c_${t.c}`].name}` : `${i === 0 ? "Rune principale" : "Rune secondaire"} pour ${byId[`c_${t.c}`].name}`;
    openPicker(title, options, (v) => {
      (kind === "it" ? t.it : t.ru)[i] = v;
      save();
      renderTeam();
    }, !!cur);
  }


  // ---------- Or, recyclage ----------
  // exemplaires libres d'une carte : ni équipés dans l'équipe, ni le champion d'un poste
  function free(id) {
    let n = (s.inv[id] || 0) - used(id);
    if (id.startsWith("c_") && Object.values(s.team).some((t) => t.c && `c_${t.c}` === id)) n--;
    return Math.max(0, n);
  }
  function recycle(id, quiet) {
    const c = byId[id];
    if (!c || (s.inv[id] || 0) < 2 || free(id) < 1) return 0;
    s.inv[id]--;
    s.gold = (s.gold || 0) + RECYCLE[c.r];
    if (!quiet) save();
    return RECYCLE[c.r];
  }
  function recycleAll(maxR) {
    let gold = 0, n = 0;
    for (const c of pool) {
      if (c.r > maxR) continue;
      while ((s.inv[c.id] || 0) > 1 && free(c.id) > 0) { gold += recycle(c.id, true); n++; }
    }
    if (n) save();
    return { gold, n };
  }

  // ---------- Profil public (pour les autres joueurs) ----------
  let pubTimer = null;
  function publishSoon() {
    clearTimeout(pubTimer);
    pubTimer = setTimeout(publish, 3000);
  }
  function publish() {
    const db = Account.db, u = Account.user;
    build();
    if (!db || !u || !pool) return;
    const byR = [0, 0, 0, 0, 0];
    const base = pool.filter((c) => c.type !== "skin");
    for (const c of base) if (s.inv[c.id]) byR[c.r]++;
    db.collection("profiles").doc(u.uid).set({
      name: u.displayName || "Joueur", photo: u.photoURL || "", owned: byR.reduce((a, b) => a + b, 0), total: base.length,
      byR, opened: s.opened, inv: s.inv, team: s.team,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch((e) => console.error("Profil public non enregistré", e));
  }
  // message d'erreur clair : le cas le plus courant est des règles Firebase pas encore publiées
  const loadError = (e) => `<div class="m-none">${e && e.code === "permission-denied"
    ? "Firebase refuse l'accès : les règles de la base (fichier firestore.rules) ne sont pas encore publiées dans la console Firebase."
    : `Impossible de charger${e && e.code ? ` (${esc(e.code)})` : ""}. Vérifie ta connexion et réessaie.`}</div>`;
  const needOnline = (what) => `<div class="m-none">${isGuest() ? `Connecte-toi pour ${what}.` : `Il faut être connecté à internet pour ${what}.`}</div>`;

  // ---------- Joueurs ----------
  let players = null, viewing = null;
  async function renderPlayers() {
    const box = $("m-players");
    if (!Account.db) { box.innerHTML = needOnline("voir les autres joueurs"); return; }
    if (viewing) return renderProfile(viewing);
    box.innerHTML = `<div class="m-panel"><h2>Joueurs</h2><div id="m-plist" class="m-plist"><div class="m-none">Chargement…</div></div></div>`;
    try {
      const snap = await Account.db.collection("profiles").orderBy("updatedAt", "desc").limit(50).get();
      players = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    } catch (e) { console.error(e); if ($("m-plist")) $("m-plist").innerHTML = loadError(e); return; }
    if (ui.tab !== "players" || viewing) return;
    const me = Account.user && Account.user.uid;
    $("m-plist").innerHTML = players.length ? players.map((p) => {
      const lvl = Object.entries(p.team || {}).reduce((a, [role, t]) => a + (t.c && p.inv && p.inv[`c_${t.c}`] ? champLevel(t.c, role, p.inv).lvl : 0), 0);
      return `<button class="m-player" data-uid="${esc(p.uid)}">
        ${p.photo ? `<img src="${esc(p.photo)}" alt="" onerror="this.remove()">` : `<i class="m-avatar">${esc((p.name || "?")[0])}</i>`}
        <span><b>${esc(p.name)}${p.uid === me ? " (toi)" : ""}</b><em>${p.owned || 0} / ${p.total || pool.length} cartes · ${(p.byR || [])[4] || 0} mythique${((p.byR || [])[4] || 0) > 1 ? "s" : ""} · équipe niveau ${lvl}</em></span>
      </button>`;
    }).join("") : `<div class="m-none">Personne pour l'instant.</div>`;
    $("m-plist").querySelectorAll(".m-player").forEach((b) => (b.onclick = () => { viewing = players.find((p) => p.uid === b.dataset.uid); renderProfile(viewing); }));
  }

  function renderProfile(p) {
    const box = $("m-players");
    const inv = p.inv || {};
    const owned = pool.filter((c) => inv[c.id]).sort((a, b) => b.r - a.r || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    const base = pool.filter((c) => c.type !== "skin"), nBase = owned.filter((c) => c.type !== "skin").length, nSkins = owned.length - nBase;
    const bars = RAR.map((r, i) => i).reverse().map((i) => {
      const all = base.filter((c) => c.r === i).length, have = owned.filter((c) => c.r === i && c.type !== "skin").length;
      return `<div class="m-rbar r-${RAR[i]}"><span>${RAR_FR[RAR[i]]}</span><div class="bar"><i style="width:${all ? (100 * have) / all : 0}%"></i></div><em>${have}/${all}</em></div>`;
    }).join("");
    const team = Object.entries(ROLES).map(([role, R]) => {
      const t = (p.team || {})[role];
      const c = t && t.c && byId[`c_${t.c}`];
      if (!c) return `<div class="pf-role empty"><div class="tm-rhead">${roleIcon(role)}<b>${R.name}</b></div><em>Vide</em></div>`;
      const icons = [...(t.it || []).map((x) => x && byId[`i_${x}`]), ...(t.ru || []).map((x) => x && byId[`r_${x}`])].filter(Boolean);
      return `<div class="pf-role r-${RAR[c.r]}"><div class="tm-rhead">${roleIcon(role)}<b>${R.name}</b></div>
        <div class="pf-champ"><img src="${(skinOf(t, inv) || c).art}" alt=""><div class="tm-lvl">${champLevel(t.c, role, inv).lvl}</div><span>${esc(c.name)}</span></div>
        <div class="pf-gear">${icons.map((x) => `<img class="r-${RAR[x.r]}" src="${x.icon}" title="${esc(x.name)}" alt="">`).join("")}</div></div>`;
    }).join("");
    box.innerHTML = `<div class="m-panel">
        <button class="link pf-back">← Tous les joueurs</button>
        <div class="pf-head">${p.photo ? `<img src="${esc(p.photo)}" alt="" onerror="this.remove()">` : `<i class="m-avatar">${esc((p.name || "?")[0])}</i>`}
          <div><h2>${esc(p.name)}</h2><em>${nBase} / ${base.length} cartes · ${nSkins} skin${nSkins > 1 ? "s" : ""} · ${p.opened || 0} packs ouverts</em></div></div>
        <div class="pf-bars">${bars}</div>
      </div>
      <div class="m-panel"><h2>Équipe</h2><div class="pf-team">${team}</div></div>
      <div class="m-panel"><h2>Collection <em>${owned.length} cartes</em></h2><div class="m-grid pf-grid">${owned.slice(0, 120).map((c) => cardHtml(c, { n: inv[c.id] })).join("")}</div>
        ${owned.length > 120 ? `<div class="m-none">… et ${owned.length - 120} autres cartes</div>` : ""}</div>`;
    box.querySelector(".pf-back").onclick = () => { viewing = null; renderPlayers(); };
    box.querySelectorAll(".pf-grid .mc").forEach((el) => (el.onclick = () => view(el.dataset.id)));
  }

  // ---------- Marché ----------
  // Une carte mise en vente quitte ta collection ; l'acheteur paie en or, le vendeur récupère l'or à sa prochaine visite.
  const mk = { q: "", rar: [], sort: "recent" };
  let listings = [];
  async function claimSales() {
    const db = Account.db, u = Account.user;
    if (!db || !u) return [];
    const mine = (await db.collection("market").where("seller", "==", u.uid).get()).docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
    let gained = 0;
    for (const l of mine.filter((x) => x.status === "sold" && !x.claimed)) {
      try {
        await db.runTransaction(async (tr) => {
          const d = await tr.get(l.ref);
          if (!d.exists || d.data().claimed || d.data().status !== "sold") throw new Error("déjà récupéré");
          tr.update(l.ref, { claimed: true });
        });
        gained += l.price;
        l.claimed = true;
      } catch {}
    }
    if (gained) { s.gold = (s.gold || 0) + gained; save(); }
    return mine;
  }

  async function renderMarket() {
    const box = $("m-market");
    if (!Account.db) { box.innerHTML = needOnline("utiliser le marché"); return; }
    box.innerHTML = `<div class="m-panel mk-head">
        <div><h2>Marché</h2><div class="mk-gold"><b id="mk-gold">${s.gold || 0}</b> or</div>
          <em>Tu gagnes ${GOLD_PACK} or par pack ouvert, et en recyclant tes doubles (${RAR.map((r, i) => `${RAR_FR[r]} ${RECYCLE[i]}`).join(", ")}).</em></div>
        <div class="mk-actions"><button id="mk-sell" class="btn good">Vendre une carte</button>
          <button id="mk-recycle" class="btn">Recycler les doubles Communs et Rares</button></div>
      </div>
      <div class="m-panel"><h2>Mes ventes</h2><div id="mk-mine"><div class="m-none">Chargement…</div></div></div>
      <div class="m-panel"><h2>En vente <em id="mk-count"></em></h2>
        <div class="m-frow"><input id="mk-search" type="search" placeholder="Chercher une carte…" value="${esc(mk.q)}">
          <select id="mk-sort"><option value="recent">Les plus récentes</option><option value="cheap">Prix croissant</option><option value="dear">Prix décroissant</option><option value="rarity">Rareté</option></select></div>
        <div class="chips" id="mk-rar"></div>
        <div id="mk-list" class="mk-list"><div class="m-none">Chargement…</div></div></div>`;
    $("mk-sort").value = mk.sort;
    $("mk-sell").onclick = sellPicker;
    $("mk-recycle").onclick = () => {
      const { gold, n } = recycleAll(1);
      $("mk-recycle").textContent = n ? `${n} doubles recyclés : +${gold} or` : "Aucun double Commun ou Rare à recycler";
      $("mk-gold").textContent = s.gold;
    };
    $("mk-search").oninput = (e) => { mk.q = e.target.value; drawListings(); };
    $("mk-sort").onchange = (e) => { mk.sort = e.target.value; drawListings(); };
    const rarBox = $("mk-rar");
    RAR.forEach((r, i) => {
      const b = document.createElement("button");
      b.textContent = RAR_FR[r];
      b.className = mk.rar.includes(i) ? "on" : "";
      b.onclick = () => { const k = mk.rar.indexOf(i); k >= 0 ? mk.rar.splice(k, 1) : mk.rar.push(i); b.classList.toggle("on"); drawListings(); };
      rarBox.appendChild(b);
    });
    try {
      const [mine, open] = await Promise.all([claimSales(), Account.db.collection("market").where("status", "==", "open").limit(300).get()]);
      if (ui.tab !== "market") return;
      listings = open.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })).filter((l) => byId[l.card]);
      $("mk-gold").textContent = s.gold || 0;
      drawMine(mine);
      drawListings();
    } catch (e) {
      console.error(e);
      if ($("mk-list")) { $("mk-list").innerHTML = loadError(e); $("mk-mine").innerHTML = ""; }
    }
  }

  const tsOf = (x) => (x && x.toMillis ? x.toMillis() : typeof x === "number" ? x : 0);
  function drawMine(mine) {
    const open = mine.filter((l) => l.status === "open" && byId[l.card]);
    const sold = mine.filter((l) => l.status === "sold" && byId[l.card]).sort((a, b) => tsOf(b.soldAt) - tsOf(a.soldAt)).slice(0, 8);
    $("mk-mine").innerHTML = (open.length || sold.length) ? [
      ...open.map((l) => `<div class="mk-row"><img src="${byId[l.card].icon || byId[l.card].art}" alt=""><span><b class="r-${RAR[byId[l.card].r]}">${esc(byId[l.card].name)}</b><em>En vente pour ${l.price} or</em></span><button class="link mk-cancel" data-id="${l.id}">Retirer</button></div>`),
      ...sold.map((l) => `<div class="mk-row sold"><img src="${byId[l.card].icon || byId[l.card].art}" alt=""><span><b class="r-${RAR[byId[l.card].r]}">${esc(byId[l.card].name)}</b><em>Vendue ${l.price} or à ${esc(l.buyerName || "un joueur")}</em></span></div>`),
    ].join("") : `<div class="m-none">Tu n'as rien en vente.</div>`;
    $("mk-mine").querySelectorAll(".mk-cancel").forEach((b) => (b.onclick = () => cancelListing(mine.find((l) => l.id === b.dataset.id))));
  }

  function drawListings() {
    const me = Account.user && Account.user.uid;
    const q = mk.q.trim().toLowerCase();
    const list = listings.filter((l) => l.status === "open").filter((l) => {
      const c = byId[l.card];
      return (!q || `${c.name} ${c.champ || ""} ${c.sub}`.toLowerCase().includes(q)) && (!mk.rar.length || mk.rar.includes(c.r));
    });
    const sorts = { recent: (a, b) => tsOf(b.createdAt) - tsOf(a.createdAt), cheap: (a, b) => a.price - b.price, dear: (a, b) => b.price - a.price, rarity: (a, b) => byId[b.card].r - byId[a.card].r || a.price - b.price };
    list.sort(sorts[mk.sort]);
    $("mk-count").textContent = `${list.length} carte${list.length > 1 ? "s" : ""}`;
    $("mk-list").innerHTML = list.length ? list.map((l) => {
      const c = byId[l.card], mine = l.seller === me, have = s.inv[c.id] || 0;
      return `<div class="mk-item">${cardHtml(c, { n: 1, back: true })}
        <div class="mk-info"><div class="mk-price">${l.price} or</div><em>${mine ? "Ta vente" : `Vendue par ${esc(l.sellerName || "un joueur")}`}</em>
          <em>${have ? `Tu en as ${have}` : "Tu ne l'as pas encore"}</em>
          ${mine ? "" : `<button class="btn good mk-buy" data-id="${l.id}" ${(s.gold || 0) < l.price ? "disabled" : ""}>Acheter</button>`}</div></div>`;
    }).join("") : `<div class="m-none">Aucune carte en vente${q || mk.rar.length ? " avec ces filtres" : ""}.</div>`;
    $("mk-list").querySelectorAll(".mk-buy").forEach((b) => (b.onclick = () => buy(listings.find((l) => l.id === b.dataset.id), b)));
    $("mk-list").querySelectorAll(".mc").forEach((el) => (el.onclick = () => view(el.dataset.id)));
  }

  function sellPicker() {
    const options = pool.filter((c) => s.inv[c.id]).map((c) => {
      const f = free(c.id);
      return { c, v: c.id, img: c.type === "champ" ? c.art : c.icon, off: f < 1, search: `${c.name} ${c.champ || ""}`,
        note: f < 1 ? "exemplaire utilisé dans ton équipe" : `${f} exemplaire${f > 1 ? "s" : ""} libre${f > 1 ? "s" : ""} · ${RAR_FR[RAR[c.r]]}` };
    }).sort((a, b) => a.off - b.off || b.c.r - a.c.r || a.c.name.localeCompare(b.c.name));
    openPicker("Quelle carte vendre ?", options, (id) => {
      if (!id) return;
      const c = byId[id];
      const def = RECYCLE[c.r] * 3;
      const txt = prompt(`Prix de vente pour ${c.name} (en or) :`, String(def));
      if (txt === null) return;
      const price = Math.round(Number(String(txt).replace(/\s/g, "")));
      if (!(price >= 1 && price <= 1000000)) { alert("Prix invalide (entre 1 et 1 000 000 or)."); return; }
      sell(id, price);
    }, false);
  }

  async function sell(id, price) {
    const db = Account.db, u = Account.user;
    if (!db || free(id) < 1) return;
    s.inv[id]--;
    if (!s.inv[id]) delete s.inv[id];
    save();
    try {
      await db.collection("market").add({ seller: u.uid, sellerName: u.displayName || "Joueur", card: id, price, status: "open", claimed: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
      console.error(e);
      s.inv[id] = (s.inv[id] || 0) + 1; save();
      alert("La mise en vente a échoué. Ta carte t'a été rendue.");
    }
    renderMarket();
  }

  async function cancelListing(l) {
    if (!l) return;
    try {
      await Account.db.runTransaction(async (tr) => {
        const d = await tr.get(l.ref);
        if (!d.exists || d.data().status !== "open") throw new Error("plus en vente");
        tr.update(l.ref, { status: "cancelled" });
      });
      s.inv[l.card] = (s.inv[l.card] || 0) + 1;
      save();
    } catch { alert("Cette carte n'est plus en vente (peut-être déjà achetée)."); }
    renderMarket();
  }

  async function buy(l, btn) {
    const u = Account.user;
    if (!l || (s.gold || 0) < l.price) return;
    btn.disabled = true;
    try {
      await Account.db.runTransaction(async (tr) => {
        const d = await tr.get(l.ref);
        if (!d.exists || d.data().status !== "open") throw new Error("plus en vente");
        tr.update(l.ref, { status: "sold", buyer: u.uid, buyerName: u.displayName || "Joueur", soldAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      s.gold -= l.price;
      const before = s.inv[l.card] || 0;
      s.inv[l.card] = before + 1;
      if (!before) s.at[l.card] = Math.floor(Date.now() / 60e3);
      save();
      l.status = "sold";
      drawListings();
      $("mk-gold").textContent = s.gold;
      view(l.card);
    } catch {
      alert("Trop tard : cette carte vient d'être achetée ou retirée.");
      renderMarket();
    }
  }

  // ---------- Carte en grand ----------
  function view(id) {
    const c = byId[id];
    if (!c) return;
    const n = s.inv[id] || 0;
    let extra = "";
    if (n && c.type === "champ" && c.spells) {
      extra = `<div class="mv-spells">${c.spells.map((sp) => {
        const got = s.inv[`s_${c.champId}_${sp.key}`];
        return `<div class="mv-spell${got ? "" : " missing"}" title="${esc(sp.name)}"><img src="${sp.icon}" alt=""><span>${sp.key === "P" ? "P" : AZERTY[sp.key]}</span></div>`;
      }).join("")}</div>`;
    }
    if (n && c.stats && c.stats.length) extra += `<div class="mv-stats">${c.stats.map(esc).join(" · ")}</div>`;
    if (n && c.official) extra += `<details class="mv-off"><summary>Description officielle</summary><div>${esc(c.official)}</div></details>`;
    $("m-view-box").innerHTML = `${cardHtml(c, { n, big: true })}
      <div class="mv-info">
        <div class="mv-own">${n ? `Possédée${n > 1 ? ` en ${n} exemplaires` : ""}` : "Pas encore trouvée"}</div>
        <div class="mv-why"><b class="r-${RAR[c.r]}">${RAR_FR[RAR[c.r]]}</b> : ${esc(c.why)}</div>
        <div class="mv-chance">${c.type === "skin" ? `${pct(SKIN_ODDS[c.r])} de chances qu'un skin tiré soit ${RAR_FR[RAR[c.r]]}` : `${pct(ODDS[c.r])} de chances par carte d'un pack`}</div>
        ${n > 1 && free(id) > 0 && !isGuest() ? `<button class="btn good mv-recycle" data-id="${id}">Recycler un double (+${RECYCLE[c.r]} or)</button>` : ""}
        ${extra}
      </div>`;
    $("m-view").classList.remove("hidden");
    const rb = $("m-view-box").querySelector(".mv-recycle");
    if (rb) rb.onclick = (e) => { e.stopPropagation(); recycle(id); view(id); renderGrid(); };
  }

  // image de skin introuvable chez Data Dragon (souvent les skins récents) : on essaie deux adresses de CommunityDragon,
  // et si aucune ne charge, l'image de base du champion
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!img || img.tagName !== "IMG") return;
    const m = img.src.match(/\/champion\/loading\/(\w+)_(\d+)\.jpg$/);
    if (m && m[2] !== "0") {
      const raw = champRaw[m[1]];
      if (!raw) { img.src = `${DD}/cdn/img/champion/loading/${m[1]}_0.jpg`; return; }
      img.dataset.fb = JSON.stringify([
        `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-splashes/${raw.key}/${+raw.key * 1000 + +m[2]}.jpg`,
        `${DD}/cdn/img/champion/loading/${m[1]}_0.jpg`,
      ]);
      img.src = `https://cdn.communitydragon.org/latest/champion/${raw.key}/splash-art/centered/skin/${m[2]}`;
    } else if (img.dataset.fb) {
      const rest = JSON.parse(img.dataset.fb);
      const nextSrc = rest.shift();
      if (rest.length) img.dataset.fb = JSON.stringify(rest); else delete img.dataset.fb;
      if (nextSrc) img.src = nextSrc;
    }
  }, true);

  function wireUi() {
    $("m-open").onclick = openPack;
    $("m-skin").onclick = buySkin;
    document.querySelectorAll("#m-tabs button").forEach((b) => (b.onclick = () => { ui.tab = b.dataset.t; viewing = null; saveUi(); render(); }));
    $("m-pick").onclick = (e) => { if (e.target.id === "m-pick" || e.target.id === "m-pick-close") closePicker(); };
    $("m-pick-search").onkeydown = (e) => { if (e.key === "Escape") closePicker(); };
    $("m-all").onclick = revealAll;
    $("m-sound").onclick = () => { ui.mute = !ui.mute; saveUi(); renderSound(); if (!ui.mute) ping(1); };
    renderSound();
    $("m-again").onclick = () => { if (s.packs > 0) openPack(); };
    $("m-close").onclick = closeOpening;
    $("m-more").onclick = () => { ui.shown += PAGE * 2; renderGrid(); };
    $("m-search").oninput = (e) => { ui.q = e.target.value.trim(); ui.shown = PAGE; renderGrid(); };
    $("m-search").onkeydown = (e) => { if (e.key === "Enter" || e.key === "Escape") e.target.blur(); };
    $("m-sort").onchange = (e) => { ui.sort = e.target.value; saveUi(); renderGrid(); };
    $("m-grid").onclick = (e) => { const el = e.target.closest(".mc"); if (el) view(el.dataset.id); };
    $("m-view").onclick = (e) => { if (!e.target.closest("details")) $("m-view").classList.add("hidden"); };
    $("m-odds").innerHTML = RAR.map((r, i) => `<span class="r-${r}">${RAR_FR[r]} ${pct(ODDS[i])}</span>`).join("")
      + `<em>Chances pour chaque carte d'un pack (5 cartes). Si tu n'as eu aucune Légendaire en ${PITY_LEG} packs, la suivante est garantie. Un pack sur ${SPECIAL_EVERY} est spécial : il a un skin en 6e carte. Et chaque carte a ${pct(SKIN_IN_PACK)} de chances d'être un skin surprise.</em>`
      + `<details><summary>Comment sont choisies les raretés ?</summary><ul>
        <li><b>Champions</b> : selon leur taux de pick en Challenger (${ST.source.champ}). Plus un champion est joué, plus il est rare.</li>
        <li><b>Sorts</b> : la rareté de leur champion. L'ultime au même niveau (au moins Rare), A Z E un cran en dessous, le passif deux crans en dessous.</li>
        <li><b>Objets</b> : selon leur taux d'achat (${ST.source.item}, pas de filtre Challenger disponible). Composants Rares. Bottes Légendaires si très achetées, sinon Épiques ; bottes T3 un cran au-dessus. Tout est un cran plus rare que le taux d'achat seul, car un exemplaire suffit pour un build.</li>
        <li><b>Runes</b> : selon leur taux de choix (${ST.source.rune}), runes principales et secondaires classées à part, puis un cran plus rares (un exemplaire suffit pour un build).</li>
        <li><b>Skins</b> : dans le pack spécial (1 sur ${SPECIAL_EVERY}), achetés ${SKIN_PRICE} or, ou très rarement en surprise dans un pack normal (${pct(SKIN_IN_PACK)} par carte, 4 fois moins qu'une Mythique). Rareté selon la catégorie de prix de Riot : Commune jusqu'à 975 RP, Rare 1350 RP, Épique 1820 RP, Légendaire Prestige et Mythiques, Mythique Ultimes et Transcendants. Chances pour chaque skin : ${RAR.map((r, i) => `${RAR_FR[r]} ${pct(SKIN_ODDS[i])}`).join(", ")}.</li>
        <li>Touche une carte de ta collection pour voir sa stat.</li></ul></details>`;
    document.addEventListener("keydown", (e) => {
      if (prefs.mode !== "master" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (e.key === "Escape") {
        if (!$("m-pick").classList.contains("hidden")) closePicker();
        else if (!$("m-view").classList.contains("hidden")) $("m-view").classList.add("hidden");
        else if (opening) closeOpening();
      } else if ((e.code === "Space" || e.code === "Enter") && ui.tab === "cards" && $("m-pick").classList.contains("hidden")) {
        e.preventDefault();
        if (!$("m-view").classList.contains("hidden")) return $("m-view").classList.add("hidden");
        if (!opening) return openPack();
        const next = $("m-reveal").querySelector(".m-slot:not(.shown)");
        if (next) reveal(next); else if (s.packs > 0) openPack(); else closeOpening();
      }
    });
  }
  let wired = false;

  return {
    render() { if (!wired) { wired = true; wireUi(); } render(); },
    get state() { return s; },
    publish: () => publishSoon(),
    setState,
    pick,
    merge,
    same: (a, b) => !!a && !!b && lastTok(a) === lastTok(b),
    reset() { setState(null); },
    refreshDescs() { pool = null; byTypeRar = {}; },
  };
})();
