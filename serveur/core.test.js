// Tests des règles : node --test serveur/
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "./core.js";
const { CFG } = G;

// faux pool : 40 champions, leurs sorts, objets, runes, skins, sur toutes les raretés
const list = [];
for (let i = 0; i < 40; i++) {
  const r = i % 5;
  list.push([`c_C${i}`, r]);
  for (const k of "PQWER") list.push([`s_C${i}_${k}`, Math.max(0, r - 1)]);
  list.push([`i_${3000 + i}`, r], [`r_R${i}`, r], [`k_C${i}_1`, r], [`k_C${i}_2`, (r + 2) % 5]);
}
const P = G.indexPool(list);
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const total = (s) => Object.values(s.inv).reduce((a, b) => a + b, 0);

test("un pack donne 5 cartes différentes, 10 or, et en coûte un", () => {
  const s = G.fresh(0);
  const r = G.openPack(s, P, 0, seeded(1));
  assert.equal(r.cards.length, 5);
  assert.equal(new Set(r.cards.map((c) => c.id)).size, 5);
  assert.equal(s.packs, CFG.START - 1);
  assert.equal(s.gold, CFG.GOLD_START + CFG.GOLD_PACK);
  assert.equal(total(s), 5);
});

test("impossible d'ouvrir sans pack, et les packs reviennent avec le temps (max 10)", () => {
  const s = G.fresh(0), rand = seeded(2);
  for (let i = 0; i < CFG.START; i++) G.openPack(s, P, 1000, rand);
  assert.throws(() => G.openPack(s, P, 2000, rand), (e) => e.code === "no-pack");
  assert.equal(total(s), 20);
  G.tick(s, 1000 + CFG.EVERY); assert.equal(s.packs, 2);
  G.tick(s, 1000 + 100 * CFG.EVERY); assert.equal(s.packs, CFG.CAP);
});

test("un bot qui ouvre tout le temps n'obtient jamais plus que 2 packs par 5 minutes", () => {
  const s = G.fresh(0), rand = seeded(3);
  let opened = 0;
  const hours = 10;
  for (let now = 0; now <= hours * 3600e3; now += 1000) {
    try { G.openPack(s, P, now, rand); opened++; } catch (e) { assert.equal(e.code, "no-pack"); }
  }
  assert.ok(opened <= CFG.START + hours * 12 * CFG.PER, `ouverts : ${opened}`);
  assert.equal(s.opened, opened);
});

test("un pack sur 10 a un skin en plus, toujours en dernier", () => {
  const s = G.fresh(0), rand = seeded(4);
  s.packs = 10; s.opened = 9;
  const r = G.openPack(s, P, 0, rand);
  assert.equal(r.special, true);
  assert.equal(r.cards.length, 6);
  assert.ok(r.cards[5].id.startsWith("k_"));
});

test("les taux sont respectés à peu près (20 000 packs)", () => {
  const s = G.fresh(0), rand = seeded(5), by = [0, 0, 0, 0, 0];
  let n = 0;
  for (let i = 0; i < 20000; i++) {
    s.packs = 5;
    for (const c of G.openPack(s, P, 0, rand).cards.slice(0, 5)) { if (!c.id.startsWith("k_")) { by[P.byId.get(c.id)]++; n++; } }
  }
  by.forEach((x, r) => assert.ok(Math.abs((100 * x) / n - CFG.ODDS[r]) < 1.2, `rareté ${r} : ${((100 * x) / n).toFixed(2)} %`));
});

test("Légendaire garantie au bout de 50 packs sans", () => {
  const s = G.fresh(0);
  s.packs = 5; s.pity.l = CFG.PITY_LEG - 1;
  const never = () => 0.01; // ne tire que des Communes
  const r = G.openPack(s, P, 0, never);
  assert.ok(Math.max(...r.cards.map((c) => P.byId.get(c.id))) >= 3);
  assert.equal(s.pity.l, 0);
});

test("acheter un skin coûte 200 or et il faut les avoir", () => {
  const s = G.fresh(0);
  assert.throws(() => G.buySkin(s, P, 0, seeded(6)), (e) => e.code === "no-gold");
  s.gold = 250;
  const r = G.buySkin(s, P, 0, seeded(6));
  assert.ok(r.cards[0].id.startsWith("k_"));
  assert.equal(s.gold, 50);
});

test("recycler : seulement un double libre, et jamais une carte inventée", () => {
  const s = G.fresh(0);
  s.inv = { c_C1: 1, c_C2: 2, i_3003: 2 };
  assert.throws(() => G.recycle(s, P, "c_C1"), (e) => e.code === "no-double");
  assert.throws(() => G.recycle(s, P, "c_Faux"), (e) => e.code === "bad-card");
  assert.equal(G.recycle(s, P, "c_C2").gold, CFG.RECYCLE[2]);
  assert.equal(s.inv.c_C2, 1);
  // les deux exemplaires de l'objet sont équipés : pas de double libre
  s.inv.c_C3 = 1;
  G.setTeam(s, { top: { c: "C2", it: ["3003"], ru: [] }, mid: { c: "C3", it: ["3003"], ru: [] } });
  assert.throws(() => G.recycle(s, P, "i_3003"), (e) => e.code === "no-double");
});

test("équipe : on ne peut équiper que ce qu'on possède, un exemplaire = un champion", () => {
  const s = G.fresh(0);
  s.inv = { c_C1: 1, c_C2: 1, i_3001: 1, r_R1: 2, k_C1_1: 1 };
  const { team } = G.setTeam(s, {
    top: { c: "C1", it: ["3001", "3999"], ru: ["R1"], sk: "k_C1_1" },
    mid: { c: "C2", it: ["3001"], ru: ["R1"], sk: "k_C1_1" },
    adc: { c: "C1", it: [], ru: [] },      // déjà en top
    jungle: { c: "C9", it: [], ru: [] },   // pas possédé
  });
  assert.deepEqual(team.top, { c: "C1", it: ["3001", null], ru: ["R1"], sk: "k_C1_1" });
  assert.deepEqual(team.mid, { c: "C2", it: [null], ru: ["R1"] });
  assert.equal(team.adc.c, null);
  assert.equal(team.jungle.c, null);
});

test("marché : la carte quitte le vendeur, l'or passe de l'acheteur au vendeur, une seule fois", () => {
  const a = G.fresh(0), b = G.fresh(0);
  a.inv = { c_C4: 1 };
  assert.throws(() => G.sell(a, P, "c_C9", 50, { uid: "a", name: "A" }, 0), (e) => e.code === "not-owned");
  assert.throws(() => G.sell(a, P, "c_C4", 0, { uid: "a", name: "A" }, 0), (e) => e.code === "bad-price");
  assert.throws(() => G.sell(a, P, "c_C4", 1.5, { uid: "a", name: "A" }, 0), (e) => e.code === "bad-price");
  const l = G.sell(a, P, "c_C4", 80, { uid: "a", name: "A" }, 0);
  assert.equal(a.inv.c_C4, undefined);
  assert.throws(() => G.buy(a, a, l, { uid: "a", name: "A" }, 0), (e) => e.code === "own");
  b.gold = 50;
  assert.throws(() => G.buy(b, a, l, { uid: "b", name: "B" }, 0), (e) => e.code === "no-gold");
  b.gold = 100;
  const r = G.buy(b, a, l, { uid: "b", name: "B" }, 0);
  assert.equal(b.gold, 20); assert.equal(a.gold, CFG.GOLD_START + 80); assert.equal(b.inv.c_C4, 1);
  assert.throws(() => G.buy(b, a, r.listing, { uid: "b", name: "B" }, 0), (e) => e.code === "gone");
  assert.throws(() => G.cancel(a, r.listing, "a", 0), (e) => e.code === "gone");
});

test("marché : annuler rend la carte, et seul le vendeur peut annuler", () => {
  const a = G.fresh(0);
  a.inv = { c_C4: 2 };
  const l = G.sell(a, P, "c_C4", 10, { uid: "a", name: "A" }, 0);
  assert.throws(() => G.cancel(G.fresh(0), l, "x", 0), (e) => e.code === "not-yours");
  G.cancel(a, l, "a", 0);
  assert.equal(a.inv.c_C4, 2);
});

test("invité : des packs rendus une seule fois, 20 au plus, ouverts hors du maximum", () => {
  const s = G.fresh(0);
  assert.equal(G.grantGuest(s, 500).granted, CFG.GUEST_PACKS_MAX);
  assert.throws(() => G.grantGuest(s, 5), (e) => e.code === "too-late");
  const before = s.packs;
  G.openPack(s, P, 0, seeded(7));
  assert.equal(s.bonus, CFG.GUEST_PACKS_MAX - 1);
  assert.equal(s.packs, before);
});

test("un état trafiqué dans la base est remis au propre", () => {
  const s = G.normalize({ v: CFG.V, gold: -5, packs: 9999, inv: { c_C1: -3, c_C2: 2.7, c_C3: "x" }, opened: NaN, pity: null }, 42);
  assert.equal(s.gold, 0); assert.equal(s.packs, CFG.CAP); assert.deepEqual(s.inv, { c_C2: 2 }); assert.equal(s.opened, 0);
  assert.equal(G.normalize({ v: 1, gold: 1e9 }, 42).gold, CFG.GOLD_START);
});

test("une ancienne collection impossible n'est pas reprise", () => {
  const s = G.normalize({ v: G.CFG.V, opened: 2, inv: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`c_X${i}`, 1])) }, 0);
  assert.equal(G.plausible(s), false);
  assert.equal(G.plausible(G.normalize({ v: G.CFG.V, opened: 10, inv: { c_A: 30 } }, 0)), true);
});
