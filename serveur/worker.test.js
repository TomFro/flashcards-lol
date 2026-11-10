// Test du serveur complet, avec un faux Firestore et de faux jetons de connexion : node --test serveur/
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto as wc, generateKeyPairSync } from "node:crypto";
const worker = (await import(process.env.WORKER || "./worker.js")).default;

const PROJECT = "demo";
// clé qui signe les faux jetons de connexion (à la place de Google)
const idKeys = await wc.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const idJwk = { ...(await wc.subtle.exportKey("jwk", idKeys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const b64 = (x) => Buffer.from(x).toString("base64url");
async function idToken(uid, extra = {}, key = idKeys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const body = { aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, iat: now - 10, exp: now + 3600, name: uid.toUpperCase(), ...extra };
  const unsigned = `${b64(JSON.stringify({ alg: "RS256", kid: "k1" }))}.${b64(JSON.stringify(body))}`;
  return `${unsigned}.${b64(new Uint8Array(await wc.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(unsigned))))}`;
}
const sa = { project_id: PROJECT, client_email: "srv@demo.iam", private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) };
const env = { SERVICE_ACCOUNT: JSON.stringify(sa), ADMIN_EMAIL: "Admin@Site.fr" };

// ---- faux Firestore (API REST) ----
const docs = new Map(); // chemin -> { fields, updateTime }
let clock = 0, reads = 0, writes = 0;
const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++clock).toISOString();
const root = `projects/${PROJECT}/databases/(default)/documents`;
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("securetoken@system")) return reply(200, { keys: [idJwk] });
  if (url.includes("oauth2.googleapis.com")) return reply(200, { access_token: "tok", expires_in: 3600 });
  assert.equal(init.headers.authorization, "Bearer tok");
  if (url.endsWith(":commit")) {
    const body = JSON.parse(init.body);
    for (const w of body.writes) {
      const path = w.update.name.split("/documents/")[1], cur = docs.get(path);
      const pre = w.currentDocument;
      if (pre && ("exists" in pre ? !!cur !== pre.exists : !cur || cur.updateTime !== pre.updateTime)) return reply(400, { error: { status: "FAILED_PRECONDITION" } });
    }
    for (const w of body.writes) {
      const path = w.update.name.split("/documents/")[1], cur = docs.get(path);
      const fields = w.updateMask ? { ...(cur ? cur.fields : {}), ...Object.fromEntries(w.updateMask.fieldPaths.map((k) => [k, w.update.fields[k]])) } : w.update.fields;
      docs.set(path, { fields, updateTime: stamp() }); writes++;
    }
    return reply(200, {});
  }
  if (url.endsWith(":runQuery")) {
    const q = JSON.parse(init.body).structuredQuery, f = q.where.fieldFilter;
    const out = [...docs].filter(([p, d]) => p.startsWith(`${q.from[0].collectionId}/`) && JSON.stringify(d.fields[f.field.fieldPath]) === JSON.stringify(f.value))
      .map(([p, d]) => ({ document: { name: `${root}/${p}`, fields: d.fields, updateTime: d.updateTime } }));
    return reply(200, out.length ? out : [{}]);
  }
  const path = url.split("/documents/")[1];
  reads++;
  return docs.has(path) ? reply(200, { name: `${root}/${path}`, ...docs.get(path) }) : reply(404, {});
};

async function call(uid, body, tokenExtra, token) {
  const r = await callOnce(uid, body, tokenExtra, token);
  if (r.status !== 429 || uid === "spam") return r;
  await new Promise((ok) => setTimeout(ok, 1050)); // frein « trop de demandes à la seconde » : on attend comme le ferait le site
  return call(uid, body, tokenExtra, token);
}
async function callOnce(uid, body, tokenExtra, token) {
  const res = await worker.fetch(new Request("https://srv.test/", { method: "POST", headers: { authorization: `Bearer ${token ?? (await idToken(uid, tokenExtra))}`, origin: "https://tomfro.github.io" }, body: JSON.stringify(body) }), env);
  return { status: res.status, cors: res.headers.get("access-control-allow-origin"), ...(await res.json()) };
}
const plain = (path) => JSON.parse(JSON.stringify(docs.get(path).fields));
const num = (v) => Number(v.integerValue);

const list = [];
for (let i = 0; i < 60; i++) { list.push([`c_C${i}`, i % 5], [`s_C${i}_Q`, i % 4], [`i_${3000 + i}`, i % 5], [`r_R${i}`, i % 5], [`k_C${i}_1`, i % 5]); }

test("sans connexion valide, rien ne passe", async () => {
  assert.equal((await call("a", { op: "open" }, null, "n.im.porte")).status, 401);
  const other = await wc.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  assert.equal((await call("a", { op: "open" }, null, await idToken("a", {}, other.privateKey))).status, 401, "jeton signé par quelqu'un d'autre");
  assert.equal((await call("a", { op: "open" }, { aud: "autre-projet" })).status, 401);
  assert.equal((await call("a", { op: "open" }, { exp: 5 })).status, 401);
  assert.equal(writes, 0);
});

test("seul l'administrateur peut envoyer la liste des cartes", async () => {
  assert.equal((await call("a", { op: "pool", list })).status, 403);
  assert.equal((await call("a", { op: "pool", list }, { email: "admin@site.fr", email_verified: false })).status, 403, "adresse non vérifiée");
  const r = await call("tom", { op: "pool", list, hash: "h1" }, { email: "admin@site.fr", email_verified: true });
  assert.equal(r.status, 200); assert.equal(r.result.n, list.length); assert.equal(r.admin, true);
});

test("ouvrir un pack : le serveur tire les cartes et les enregistre", async () => {
  const r = await call("a", { op: "open" });
  assert.equal(r.status, 200); assert.equal(r.cors, "https://tomfro.github.io");
  assert.equal(r.result.cards.length, 5); assert.equal(r.state.packs, 3); assert.equal(r.poolHash, "h1");
  const saved = plain("profiles/a");
  assert.equal(saved.srv.booleanValue, true); assert.equal(saved.name.stringValue, "A");
  assert.equal(Object.keys(saved.inv.mapValue.fields).length, 5);
  assert.equal(num(saved.gold), 110);
  assert.ok(saved.updatedAt.timestampValue);
});

test("pas plus de packs que prévu, et le serveur ne relit pas la base à chaque essai d'un bot", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await call("a", { op: "open" })).status, 200);
  const before = reads;
  for (let i = 0; i < 5; i++) { const r = await call("a", { op: "open" }); assert.equal(r.status, 400); assert.equal(r.error, "no-pack"); }
  assert.equal(reads, before, "aucune lecture pendant l'attente");
  assert.equal(Object.values(plain("profiles/a").inv.mapValue.fields).reduce((a, v) => a + num(v), 0), 20);
});

test("trop de demandes à la seconde : refusé", async () => {
  let refused = 0;
  for (let i = 0; i < 30; i++) if ((await call("spam", { op: "state" })).status === 429) refused++;
  assert.ok(refused > 0);
});

test("premier passage : la collection d'avant est reprise, sans les cartes inconnues, avec l'or des ventes", async () => {
  const f = (o) => JSON.parse(JSON.stringify(o));
  docs.set("users/old", { updateTime: stamp(), fields: f({ master: { mapValue: { fields: {
    v: { integerValue: "2" }, gold: { integerValue: "40" }, packs: { integerValue: "1" }, t: { integerValue: String(Date.now()) }, opened: { integerValue: "12" },
    inv: { mapValue: { fields: { c_C1: { integerValue: "2" }, c_Invente: { integerValue: "99" } } } },
    team: { mapValue: { fields: { top: { mapValue: { fields: { c: { stringValue: "C1" }, it: { arrayValue: { values: [{ stringValue: "3001" }] } }, ru: { arrayValue: {} } } } } } } } } } } }) });
  docs.set("market/v1", { updateTime: stamp(), fields: f({ seller: { stringValue: "old" }, status: { stringValue: "sold" }, claimed: { booleanValue: false }, price: { integerValue: "70" }, card: { stringValue: "c_C2" } }) });
  const r = await call("old", { op: "state" });
  assert.deepEqual(r.state.inv, { c_C1: 2 });
  assert.equal(r.state.gold, 110); assert.equal(r.state.opened, 12);
  assert.deepEqual(r.state.team.top, { c: "C1", it: [null], ru: [] }, "objet pas possédé retiré de l'équipe");
  assert.equal(plain("market/v1").claimed.booleanValue, true);
  assert.equal((await call("old", { op: "state" })).state.gold, 110, "l'or n'est compté qu'une fois");
});

test("marché complet entre deux joueurs", async () => {
  const card = Object.keys((await call("a", { op: "state" })).state.inv)[0];
  const s1 = await call("a", { op: "sell", card, price: 30 });
  assert.equal(s1.status, 200);
  const id = s1.result.id;
  assert.equal(plain(`market/${id}`).status.stringValue, "open");
  assert.equal((await call("a", { op: "sell", card: "c_C59", price: 30 })).error, "not-owned");
  assert.equal((await call("a", { op: "buy", id })).error, "own");
  assert.equal((await call("b", { op: "cancel", id })).error, "not-yours");
  const goldA = (await call("a", { op: "state" })).state.gold;
  const b = await call("b", { op: "buy", id });
  assert.equal(b.status, 200); assert.equal(b.state.gold, 70); assert.equal(b.state.inv[card], 1);
  assert.equal((await call("a", { op: "state" })).state.gold, goldA + 30);
  assert.equal(plain("profiles/a").name.stringValue, "A", "le vendeur garde son nom");
  assert.equal((await call("b", { op: "buy", id })).error, "gone");
  assert.equal(plain(`market/${id}`).buyer.stringValue, "b");
});

test("deux acheteurs en même temps : un seul gagne", async () => {
  const card = Object.keys((await call("a", { op: "state" })).state.inv)[0];
  const id = (await call("a", { op: "sell", card, price: 10 })).result.id;
  const [x, y] = await Promise.all([call("c", { op: "buy", id }), call("d", { op: "buy", id })]);
  assert.deepEqual([x.status, y.status].sort(), [200, 400]);
  const gold = (await call("c", { op: "state" })).state.gold + (await call("d", { op: "state" })).state.gold;
  assert.equal(gold, 190, "un seul a payé");
});

test("recyclage, skin, équipe, invité", async () => {
  assert.equal((await call("b", { op: "recycle", id: Object.keys((await call("b", { op: "state" })).state.inv)[0] })).error, "no-double");
  assert.equal((await call("b", { op: "skin" })).error, "no-gold");
  const g = await call("neuf", { op: "guest", opened: 3 });
  assert.equal(g.result.granted, 3); assert.equal(g.state.bonus, 3);
  assert.equal((await call("neuf", { op: "guest", opened: 3 })).error, "too-late");
  for (let i = 0; i < 7; i++) assert.equal((await call("neuf", { op: "open" })).status, 200);
  assert.equal((await call("neuf", { op: "open" })).error, "no-pack");
  const st = (await call("neuf", { op: "state" })).state;
  const champ = Object.keys(st.inv).find((k) => k.startsWith("c_"));
  if (champ) {
    const t = await call("neuf", { op: "team", team: { mid: { c: champ.slice(2), it: ["9999"], ru: [] } } });
    assert.deepEqual(t.state.team.mid, { c: champ.slice(2), it: [null], ru: [] });
  }
  assert.equal((await call("neuf", { op: "nimporte" })).error, "bad-op");
});

test("l'administrateur peut remettre un joueur à zéro, pas les autres", async () => {
  assert.equal((await call("a", { op: "admin-reset", uid: "b" })).status, 403);
  const r = await call("tom", { op: "admin-reset", uid: "b" }, { email: "admin@site.fr", email_verified: true });
  assert.equal(r.status, 200);
  assert.deepEqual((await call("b", { op: "state" })).state.inv, {});
});

test("contrôle d'installation", async () => {
  const ok = await (await worker.fetch(new Request("https://srv.test/"), env)).json();
  assert.equal(ok.ok, true); assert.equal(ok.cartes, list.length);
  const ko = await (await worker.fetch(new Request("https://srv.test/"), {})).json();
  assert.equal(ko.ok, false); assert.equal(ko.service_account, false);
  assert.ok(!JSON.stringify(ok).includes("PRIVATE"));
});
