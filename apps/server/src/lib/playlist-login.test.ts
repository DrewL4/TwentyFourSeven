import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createLoginChecker, clearLoginCache, newLocalLogin, LOGIN_CACHE_MS } from "./playlist-login";
import { sealLogin, openSealedLogin, isSealedLogin } from "./link-security";

// Secrets are read when used, so setting it here is early enough.
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || "unit-test-secret-not-real";

type Call = { url: string; auth: string | null; body: any };

function fakeEspg(answer: (body: any) => { status: number; json?: any } | Error) {
  const calls: Call[] = [];
  const f = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.Authorization ?? null, body });
    const a = answer(body);
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a.json ?? {}), { status: a.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

let clock = 1_800_000_000_000;
beforeEach(() => {
  clearLoginCache();
  clock += 10 * LOGIN_CACHE_MS;
});

function checker(f: typeof fetch, espg = true, local: Record<string, { userId: string; passwordSealed: string }> = {}) {
  return createLoginChecker({
    espg: async () => (espg ? { url: "http://espg.test/", token: "service-token" } : null),
    fetch: f,
    findLocal: async (u) => local[u] ?? null,
    userIdByEmail: async (e) => (e === "viewer@example.test" ? "user-1" : null),
    now: () => clock,
  });
}

const good = { username: "HomeVi", password: "Ewer" };

test("ESPG login is checked with ESPG using the service token, and mapped to the TFS user", async () => {
  const { f, calls } = fakeEspg((b) => ({ status: 200, json: { valid: b.password === "Ewer", user: { email: "viewer@example.test" }, playlist: "Home" } }));
  const res = await checker(f).check(good);
  assert.deepEqual(res, { ok: true, source: "espg", email: "viewer@example.test", userId: "user-1", playlist: "Home" });
  assert.equal(calls[0].url, "http://espg.test/api/v1/users/integrations/tfs/playlist-login/");
  assert.equal(calls[0].auth, "Bearer service-token");
  assert.deepEqual(calls[0].body, { action: "verify", ...good });
});

test("a good ESPG login for someone who isn't a TwentyFourSeven user is refused, not cached", async () => {
  const { f, calls } = fakeEspg(() => ({ status: 200, json: { valid: true, user: { email: "stranger@example.test" } } }));
  const c = checker(f);
  assert.deepEqual(await c.check(good), { ok: false, reason: "no-access" });
  await c.check(good);
  assert.equal(calls.length, 2);
});

test("wrong password is refused and not cached", async () => {
  const { f, calls } = fakeEspg(() => ({ status: 200, json: { valid: false } }));
  const c = checker(f);
  assert.deepEqual(await c.check({ ...good, password: "nope" }), { ok: false, reason: "wrong" });
  await c.check({ ...good, password: "nope" });
  assert.equal(calls.length, 2);
});

test("a yes is cached: a short ESPG outage keeps playback going, removal lands after the window", async () => {
  let allowed = true;
  let down = false;
  const { f, calls } = fakeEspg(() => (down ? new Error("ECONNREFUSED") : { status: 200, json: { valid: allowed, user: { email: "viewer@example.test" } } }));
  const c = checker(f);
  assert.ok((await c.check(good)).ok);
  down = true;
  clock += LOGIN_CACHE_MS - 1000;
  assert.ok((await c.check(good)).ok, "cached during outage");
  assert.equal(calls.length, 1);
  down = false;
  allowed = false;
  clock += 2000;
  assert.deepEqual(await c.check(good), { ok: false, reason: "wrong" });
});

test("ESPG unreachable and nothing cached -> unavailable, not 'wrong'", async () => {
  const { f } = fakeEspg(() => new Error("ECONNREFUSED"));
  assert.deepEqual(await checker(f).check(good), { ok: false, reason: "unavailable" });
  const { f: f403 } = fakeEspg(() => ({ status: 403 }));
  assert.deepEqual(await checker(f403).check(good), { ok: false, reason: "unavailable" });
});

test("without ESPG, TwentyFourSeven's own login is used", async () => {
  const mine = newLocalLogin("Drew L");
  assert.match(mine.username, /^tfsdrewl[0-9a-f]{4}$/);
  const { f, calls } = fakeEspg(() => ({ status: 500 }));
  const c = checker(f, false, { [mine.username]: { userId: "u9", passwordSealed: mine.passwordSealed } });
  assert.deepEqual(await c.check({ username: mine.username, password: mine.password }), { ok: true, source: "tfs", email: null, userId: "u9" });
  assert.deepEqual(await c.check({ username: mine.username, password: "x" }), { ok: false, reason: "wrong" });
  assert.deepEqual(await c.check({ username: "nobody", password: "x" }), { ok: false, reason: "wrong" });
  assert.equal(calls.length, 0);
});

test("sealed login in links: round-trips, stable, tamper-proof, no clear password", () => {
  const sealed = sealLogin(good);
  assert.ok(isSealedLogin(sealed));
  assert.equal(sealed, sealLogin(good));
  assert.ok(!sealed.includes("Ewer") && !Buffer.from(sealed.slice(4), "base64url").toString("latin1").includes("Ewer"));
  assert.deepEqual(openSealedLogin(sealed), good);
  const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
  assert.equal(openSealedLogin(flipped), null);
  assert.equal(openSealedLogin(sealed, "another-secret"), null);
  assert.equal(openSealedLogin("pl1.../../etc/passwd"), null);
});

test("lookup lists the user's ESPG logins", async () => {
  const { f, calls } = fakeEspg(() => ({ status: 200, json: { logins: [{ playlist: "Home", username: "HomeVi", password: "Ewer" }, { bad: 1 }] } }));
  const res = await checker(f).lookup("viewer@example.test");
  assert.deepEqual(res, { source: "espg", logins: [{ playlist: "Home", username: "HomeVi", password: "Ewer" }] });
  assert.deepEqual(calls[0].body, { action: "lookup", email: "viewer@example.test" });
});
