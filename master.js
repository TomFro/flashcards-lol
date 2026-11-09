// LoL Master : on ouvre des packs pour collectionner une carte de chaque champion, sort, objet et rune.
// Utilise les cartes déjà chargées par app.js (cards, champRaw, store, persist…).
const Master = (() => {
  const RAR = ["common", "rare", "epic", "legendary", "mythic"];
  const RAR_FR = { common: "Commune", rare: "Rare", epic: "Épique", legendary: "Légendaire", mythic: "Mythique" };
  const ODDS = [62, 26, 9, 2.5, 0.5];           // chances (en %) pour chaque carte d'un pack
  const PACK_SIZE = 5;
  const EVERY = 5 * 60e3, PER = 2;              // 2 packs toutes les 5 minutes
  const CAP = 20, START = 4;                    // packs gardés au maximum, packs offerts au départ
  const PITY_LEG = 40;                          // au pire, une Légendaire (ou mieux) tous les 40 packs
  const TYPES = { champ: "Champion", spell: "Sort", item: "Objet", rune: "Rune" };
  const TYPES_PL = { champ: "Champions", spell: "Sorts", item: "Objets", rune: "Runes" };
  const MIX = { champ: 25, spell: 45, item: 18, rune: 12 }; // part de chaque type dans un pack
  // Pourquoi une carte a sa rareté (affiché sur la carte en grand)
  const WHY = {
    champ: ["Peu présent dans la méta actuelle", "Joué régulièrement en classé ou en pro", "Souvent joué en pro et en classé",
      "Très présent en compétition et en émeraude+", "Parmi les champions les plus joués et les plus célèbres"],
    spell: ["Sort de base", "Ultime", "Sort marquant, qui change un combat", "Sort emblématique de LoL", "Parmi les sorts les plus forts et célèbres du jeu"],
    item: ["Composant ou objet peu acheté", "Objet légendaire plus situationnel", "Objet très acheté dans son rôle",
      "Objet central, acheté dans la plupart des parties de son rôle", "Parmi les objets les plus achetés du jeu"],
    rune: ["Rune secondaire peu prise", "Rune secondaire courante, ou rune principale plus rare", "Rune très prise",
      "Rune principale parmi les plus jouées", "La rune principale la plus jouée du jeu"],
  };
  const PAGE = 60;
  const pct = (x) => `${x.toLocaleString("fr-FR")} %`;

  const fresh = () => ({ packs: START, t: Date.now(), inv: {}, at: {}, pity: { e: 0, l: 0 }, opened: 0 });
  let s = Object.assign(fresh(), store.get("flc_master", {}));
  let pool = null, byId = {}, byTypeRar = {};
  const ui = { type: [], rar: [], own: "all", q: "", sort: "rarity", shown: PAGE };
  Object.assign(ui, store.get("flc_master_ui", {}), { shown: PAGE, q: "" });
  let opening = null, timer = null;

  // ---------- Raretés ----------
  function lists() {
    const out = {};
    for (const [type, tiers] of Object.entries(window.MASTER_RARITY || {})) {
      out[type] = {};
      for (const [tier, ids] of Object.entries(tiers)) for (const id of ids.split(/\s+/)) if (id) out[type][id] = RAR.indexOf(tier);
    }
    return out;
  }

  function build() {
    if (pool || !cards.champ.length) return;
    const L = lists();
    const get = (type, id) => (L[type] || {})[id];
    pool = [];
    for (const c of cards.champAll) {
      const t = get("champ", c.champId) ?? 0;
      const raw = champRaw[c.champId];
      pool.push({
        id: `c_${c.champId}`, type: "champ", r: t, name: c.champ, sub: raw && raw.title ? raw.title : "",
        art: c.img, champ: c.champ, champId: c.champId, lanes: c.lanes,
        desc: (c.tags || []).map((x) => CLASSES[x] || x).join(" · ") + (c.lanes.length ? ` — ${c.lanes.map((l) => LANES[l].replace(/<svg[\s\S]*<\/svg>/, "")).join(", ")}` : ""),
        spells: c.spells,
      });
    }
    for (const c of cards.champ) {
      const def = c.key === "R" ? 1 : 0; // par défaut : ultime Rare, autres sorts Communs
      pool.push({
        id: `s_${c.champId}_${c.key}`, type: "spell", r: get("spell", `${c.champId}_${c.key}`) ?? def,
        name: c.name, sub: `${c.champ} · ${c.key === "P" ? "Passif" : AZERTY[c.key]}`, key: c.key,
        art: c.img, icon: c.icon, champ: c.champ, champId: c.champId, desc: custom[c.id] || c.short, official: c.official,
      });
    }
    for (const c of cards.item) {
      const num = c.id.slice(5);
      // composants Communs, objets légendaires et bottes Rares, bottes T3 Épiques
      // (Légendaires si ce sont les T3 de bottes très achetées)
      let r = get("item", num), why = null;
      if (c.btier === 3) {
        r = r ?? (get("item", c.bfrom) >= 2 ? 3 : 2);
        why = r >= 3 ? "Bottes améliorées (T3) des bottes les plus achetées" : "Bottes améliorées (T3)";
      } else if (c.btier === 2) {
        why = (r ?? 1) >= 2 ? "Bottes achetées dans une grande partie des parties" : "Bottes plus situationnelles";
        r = r ?? 1;
      } else r = r ?? (c.itype === "legendary" ? 1 : 0);
      pool.push({
        id: `i_${num}`, type: "item", r, why, name: c.name,
        sub: `${c.btier === 3 ? "Bottes T3" : c.btier === 2 ? "Bottes" : ITYPES[c.itype].replace(/s$/, "")} · ${c.gold} PO`,
        icon: c.icon, desc: custom[c.id] || c.short, official: c.official, stats: c.stats,
      });
    }
    for (const c of cards.rune) {
      const key = c.id.slice(5);
      const def = c.slot === "keystone" ? 1 : 0;
      pool.push({
        id: `r_${key}`, type: "rune", r: get("rune", key) ?? def, name: c.name,
        sub: `${c.tree} · ${c.slot === "keystone" ? "Principale" : "Secondaire"}`,
        icon: c.icon, desc: custom[c.id] || c.short, official: c.official,
      });
    }
    for (const c of pool) c.why ||= WHY[c.type][c.r];
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
  function rollRarity(min) {
    const w = {};
    ODDS.forEach((p, i) => { if (i >= min) w[i] = p; });
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

  function makePack() {
    const w = MIX;
    const rs = [];
    for (let i = 0; i < PACK_SIZE; i++) rs.push(rollRarity(0)); // chaque carte est tirée indépendamment
    if (Math.max(...rs) < 3 && s.pity.l + 1 >= PITY_LEG) rs[PACK_SIZE - 1] = rollRarity(3);
    const taken = new Set();
    const out = rs.map((r) => { const c = pickCard(pickWeighted(w), r, taken); if (c) taken.add(c.id); return c; }).filter(Boolean);
    const top = Math.max(...out.map((c) => c.r));
    s.pity.l = top >= 3 ? 0 : s.pity.l + 1;
    return out;
  }

  function openPack() {
    tick();
    if (s.packs <= 0 || !pool) return;
    s.packs--;
    if (s.packs === CAP - 1) s.t = Date.now(); // le compteur repart quand on passe sous le maximum
    s.opened++;
    const got = makePack();
    const now = Math.floor(Date.now() / 60e3);
    const res = got.map((c) => {
      const before = s.inv[c.id] || 0;
      s.inv[c.id] = before + 1;
      if (!before) s.at[c.id] = now;
      return { c, isNew: !before, n: before + 1 };
    });
    // les cartes les plus rares à la fin, pour le suspense
    res.sort((a, b) => a.c.r - b.c.r);
    save();
    showOpening(res);
  }

  // ---------- Enregistrement ----------
  function save() {
    if (isGuest()) return; // invité : la collection dure le temps de la visite
    store.set("flc_master", s);
    if (isOnlineUser()) store.set("flc_unsynced", true);
    if (Account.mode === "user") persist();
  }
  function setState(n) {
    s = Object.assign(fresh(), n || {});
    s.pity = Object.assign({ e: 0, l: 0 }, s.pity);
    if (prefs.mode === "master") render();
  }
  // garde la collection la plus avancée (celle qui a ouvert le plus de packs)
  const pick = (a, b) => (!a ? b : !b ? a : (b.opened || 0) > (a.opened || 0) ? b : a);

  // ---------- Affichage ----------
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

  function cardHtml(c, { n = 0, back = false, big = false, isNew = false } = {}) {
    const missing = n === 0 && !back && !isNew;
    const art = c.type === "champ"
      ? `<img class="mc-champ" src="${c.art}" alt="" loading="lazy">`
      : `${c.art ? `<img class="mc-blur" src="${c.art}" alt="" loading="lazy">` : ""}<img class="mc-icon" src="${c.icon}" alt="" loading="lazy">`;
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
  const saveUi = () => store.set("flc_master_ui", { type: ui.type, rar: ui.rar, own: ui.own, sort: ui.sort });

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
  }

  function renderProgress() {
    const owned = pool.filter((c) => s.inv[c.id]).length;
    let html = `<div class="m-total"><b>${owned}</b> / ${pool.length} cartes · ${s.opened} pack${s.opened > 1 ? "s" : ""} ouvert${s.opened > 1 ? "s" : ""}</div>`;
    for (let r = RAR.length - 1; r >= 0; r--) {
      const all = pool.filter((c) => c.r === r);
      const have = all.filter((c) => s.inv[c.id]).length;
      html += `<div class="m-rbar r-${RAR[r]}"><span>${RAR_FR[RAR[r]]}</span><div class="bar"><i style="width:${all.length ? (100 * have) / all.length : 0}%"></i></div><em>${have}/${all.length}</em></div>`;
    }
    $("m-progress").innerHTML = html;
    $("stats").innerHTML = `<b>${owned}</b> / ${pool.length} cartes collectionnées`;
    $("stats-bar").style.width = `${(100 * owned) / pool.length}%`;
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
    if (!pool) return;
    tick();
    renderPacks();
    renderProgress();
    renderFilters();
    renderGrid();
    clearInterval(timer);
    timer = setInterval(() => {
      if (prefs.mode !== "master") return clearInterval(timer);
      const before = s.packs;
      renderPacks();
      if (s.packs !== before) save();
    }, 1000);
  }

  // ---------- Ouverture ----------
  function showOpening(res) {
    opening = res;
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
    updateOpeningButtons();
  }
  function updateOpeningButtons() {
    const hidden = $("m-reveal").querySelectorAll(".m-slot:not(.shown)").length;
    $("m-all").classList.toggle("hidden", hidden === 0);
    $("m-again").classList.toggle("hidden", hidden > 0 || s.packs <= 0);
    $("m-again").textContent = `Ouvrir le suivant (${s.packs})`;
    $("m-close").textContent = hidden > 0 ? "Fermer" : "Voir ma collection";
    if (hidden === 0) {
      const nNew = opening.filter((x) => x.isNew).length;
      $("m-summary").textContent = nNew ? `${nNew} nouvelle${nNew > 1 ? "s" : ""} carte${nNew > 1 ? "s" : ""} !` : "Que des doubles cette fois.";
    } else $("m-summary").textContent = "Touche les cartes pour les retourner";
  }
  function revealAll() {
    $("m-reveal").querySelectorAll(".m-slot:not(.shown)").forEach((el, i) => setTimeout(() => { el.classList.add("shown"); updateOpeningButtons(); }, i * 180));
  }
  function closeOpening() {
    $("m-opening").classList.add("hidden");
    opening = null;
    render();
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
        <div class="mv-chance">${pct(ODDS[c.r])} de chances par carte d'un pack</div>
        ${extra}
      </div>`;
    $("m-view").classList.remove("hidden");
  }

  function wireUi() {
    $("m-open").onclick = openPack;
    $("m-all").onclick = revealAll;
    $("m-again").onclick = () => { if (s.packs > 0) openPack(); };
    $("m-close").onclick = closeOpening;
    $("m-more").onclick = () => { ui.shown += PAGE * 2; renderGrid(); };
    $("m-search").oninput = (e) => { ui.q = e.target.value.trim(); ui.shown = PAGE; renderGrid(); };
    $("m-search").onkeydown = (e) => { if (e.key === "Enter" || e.key === "Escape") e.target.blur(); };
    $("m-sort").onchange = (e) => { ui.sort = e.target.value; saveUi(); renderGrid(); };
    $("m-grid").onclick = (e) => { const el = e.target.closest(".mc"); if (el) view(el.dataset.id); };
    $("m-view").onclick = (e) => { if (!e.target.closest("details")) $("m-view").classList.add("hidden"); };
    $("m-odds").innerHTML = RAR.map((r, i) => `<span class="r-${r}">${RAR_FR[r]} ${pct(ODDS[i])}</span>`).join("")
      + `<em>Chances pour chaque carte d'un pack (5 cartes). Si tu n'as eu aucune Légendaire en ${PITY_LEG} packs, la suivante est garantie.</em>`
      + `<details><summary>Comment sont choisies les raretés ?</summary><ul>
        <li><b>Champions</b> : selon leur présence en compétition et en classé émeraude et plus. Les plus joués sont Mythiques, ceux hors méta Communs.</li>
        <li><b>Sorts</b> : un sort de base est Commun, un ultime Rare. Les sorts qui changent un combat montent en Épique, les plus emblématiques en Légendaire ou Mythique.</li>
        <li><b>Objets</b> : composants Communs, objets légendaires Rares, puis Épique, Légendaire ou Mythique plus ils sont achetés. Bottes Rares (Épiques si très achetées), bottes T3 Épiques (Légendaires pour les T3 des bottes les plus achetées).</li>
        <li><b>Runes</b> : selon leur taux de choix. Conquérant, la plus jouée, est Mythique.</li>
        <li>Touche une carte de ta collection pour voir pourquoi elle a sa rareté.</li></ul></details>`;
    document.addEventListener("keydown", (e) => {
      if (prefs.mode !== "master" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (e.key === "Escape") {
        if (!$("m-view").classList.contains("hidden")) $("m-view").classList.add("hidden");
        else if (opening) closeOpening();
      } else if (e.code === "Space" || e.code === "Enter") {
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
    setState,
    pick,
    reset() { setState(null); },
    refreshDescs() { pool = null; byTypeRar = {}; },
  };
})();
