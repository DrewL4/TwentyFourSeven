import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { createLoginChecker, clearLoginCache, newLocalLogin, LOGIN_CACHE_MS, defaultLogin, playlistSlug, resolveMode, LinkedWithoutTokenError, type ModeState } from "./playlist-login";
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

function checker(f: typeof fetch, espg: boolean | ModeState = true, local: Record<string, { userId: string; passwordSealed: string }> = {}) {
  const state: ModeState =
    typeof espg === "object" ? espg : espg ? { mode: "espg", url: "http://espg.test/", link: { url: "http://espg.test/", token: "service-token" } } : { mode: "tfs" };
  return createLoginChecker({
    mode: async () => state,
    fetch: f,
    findLocal: async (u) =>
      Object.entries(local)
        .filter(([name]) => name.toLowerCase() === u.toLowerCase())
        .map(([username, r]) => ({ username, ...r })),
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

// --- modes -------------------------------------------------------------------

test("mode: an explicit choice wins; before a choice, an ESPG address means linked (upgrade keeps behaviour)", () => {
  assert.equal(resolveMode("tfs", "http://espg"), "tfs");
  assert.equal(resolveMode("espg", ""), "espg");
  assert.equal(resolveMode("", "http://espg"), "espg");
  assert.equal(resolveMode(null, "  "), "tfs");
  assert.equal(resolveMode("bogus", ""), "tfs");
});

test("linked without a WatchTower token never falls back to local logins", async () => {
  const mine = newLocalLogin("Drew L");
  const { f, calls } = fakeEspg(() => ({ status: 200, json: { valid: true } }));
  const c = checker(f, { mode: "espg", url: "http://espg.test", link: null }, { [mine.username]: { userId: "u9", passwordSealed: mine.passwordSealed } });
  assert.deepEqual(await c.check({ username: mine.username, password: mine.password }), { ok: false, reason: "unavailable" });
  await assert.rejects(c.lookup("viewer@example.test"), LinkedWithoutTokenError);
  assert.equal(calls.length, 0);
});

test("on its own, ESPG is never asked even if an address is saved", async () => {
  const { f, calls } = fakeEspg(() => ({ status: 200, json: { valid: true } }));
  const c = checker(f, false);
  assert.equal(await c.lookup("viewer@example.test"), null);
  assert.deepEqual(await c.check(good), { ok: false, reason: "wrong" });
  assert.equal(calls.length, 0);
});

test("login answers are cached for about a minute by default", () => {
  assert.ok(LOGIN_CACHE_MS <= 60_000 || !!process.env.PLAYLIST_LOGIN_CACHE_SECONDS);
});

// --- default login: same answers as ESPG's model -------------------------------

const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/espg-default-login-cases.json", import.meta.url), "utf8"));

for (const c of fixture.cases) {
  test(`default login matches ESPG: ${c.name}`, async () => {
    const taken = new Set<string>(c.taken.map((t: string) => t.toLowerCase()));
    const login = await defaultLogin({ firstName: c.first, lastName: c.last, email: c.email }, c.playlist, (u) => taken.has(u.toLowerCase()));
    assert.deepEqual(login, { username: c.username, password: c.password });
  });
}

test("playlist name cleaning is Python's [^\\w] (Unicode letters, digits, _)", () => {
  assert.equal(playlistSlug("Café TV-24/7!"), "cafétv247");
  assert.equal(playlistSlug("Ünïcode_Ok 9"), "ünïcode_ok9");
  assert.equal(playlistSlug(""), "");
});

test("old-style logins still check out (existing rows are never rewritten)", async () => {
  const old = newLocalLogin("Pearl Puffin");
  const { f } = fakeEspg(() => ({ status: 500 }));
  const c = checker(f, false, { [old.username]: { userId: "u3", passwordSealed: old.passwordSealed } });
  assert.ok((await c.check({ username: old.username, password: old.password })).ok);
});

test("linked: someone ESPG refuses as expired is not let in, and an expiry lands within the cache window", async () => {
  let expired = true;
  const { f } = fakeEspg(() => ({ status: 200, json: expired ? { valid: false } : { valid: true, user: { email: "viewer@example.test" }, playlist: "Home" } }));
  const c = checker(f);
  assert.deepEqual(await c.check(good), { ok: false, reason: "wrong" });
  expired = false;
  assert.equal((await c.check(good)).ok, true);
  expired = true; // access runs out in ESPG
  clock += LOGIN_CACHE_MS + 1;
  assert.deepEqual(await c.check(good), { ok: false, reason: "wrong" });
});

test("standalone: the username ignores case, the password does not", async () => {
  const mine = { username: "247Captain", password: "Lumen" };
  const c = checker(fakeEspg(() => ({ status: 500 })).f, false, { [mine.username]: { userId: "u1", passwordSealed: sealLogin(mine) } });
  for (const username of ["247captain", "247CAPTAIN", "247Captain"]) {
    assert.deepEqual(await c.check({ username, password: "Lumen" }), { ok: true, source: "tfs", email: null, userId: "u1" });
  }
  assert.deepEqual(await c.check({ username: "247captain", password: "lumen" }), { ok: false, reason: "wrong" });
  assert.deepEqual(await c.check({ username: "247captain", password: "" }), { ok: false, reason: "wrong" });
});

test("standalone: when several logins match ignoring case, the exact-case one wins; otherwise it is refused", async () => {
  const a = { username: "TvBox", password: "pw1" };
  const b = { username: "tvbox", password: "pw1" };
  const c = checker(fakeEspg(() => ({ status: 500 })).f, false, {
    [a.username]: { userId: "uA", passwordSealed: sealLogin(a) },
    [b.username]: { userId: "uB", passwordSealed: sealLogin(b) },
  });
  assert.equal((await c.check({ username: "TvBox", password: "pw1" }) as any).userId, "uA");
  assert.equal((await c.check({ username: "tvbox", password: "pw1" }) as any).userId, "uB");
  const warn = console.warn;
  const logged: string[] = [];
  console.warn = (...args: unknown[]) => void logged.push(args.join(" "));
  try {
    assert.deepEqual(await c.check({ username: "TVBOX", password: "pw1" }), { ok: false, reason: "wrong" });
  } finally {
    console.warn = warn;
  }
  assert.ok(logged.some((l) => l.includes("ignoring case")));
  assert.ok(!logged.some((l) => l.includes("pw1")));
});

test("standalone: a case variant with a different password picks the row whose password matches", async () => {
  const a = { username: "TvBox", password: "pw1" };
  const b = { username: "tvbox", password: "pw2" };
  const c = checker(fakeEspg(() => ({ status: 500 })).f, false, {
    [a.username]: { userId: "uA", passwordSealed: sealLogin(a) },
    [b.username]: { userId: "uB", passwordSealed: sealLogin(b) },
  });
  assert.equal((await c.check({ username: "TVBOX", password: "pw2" }) as any).userId, "uB");
  assert.equal((await c.check({ username: "TVBOX", password: "pw1" }) as any).userId, "uA");
});
