import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearEspgCallerCache, createEspgCallerCheck } from "./espg-caller";
import { espgServiceCaller, keyParam, serviceCallAllowed } from "./espg-service-access";

// A stand-in WatchTower: these made-up tokens map to app names.
const apps: Record<string, string> = { "espg-app-token-test": "espg", "tfs-app-token-test": "twentyfourseven" };
let wtCalls = 0;
const isEspg = createEspgCallerCheck({
  watchTowerUrl: async () => "http://watchtower.test",
  now: () => Date.now(),
  fetch: (async (_url: string, init: any) => {
    wtCalls++;
    const { token } = JSON.parse(init.body);
    const app = apps[token];
    if (!app) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 });
    return new Response(JSON.stringify({ valid: true, app_name: app }), { status: 200 });
  }) as any,
});

const m3u = { scope: "guide" as const, resource: "m3u" };
const xmltv = { scope: "guide" as const, resource: "xmltv" };
const h = (v?: string) => new Headers(v ? { authorization: v } : {});

beforeEach(() => {
  clearEspgCallerCache();
  wtCalls = 0;
});

test("ESPG's app token opens the playlist and the guide", async () => {
  assert.equal(await espgServiceCaller(h("Bearer espg-app-token-test"), m3u, isEspg), "service");
  assert.equal(await espgServiceCaller(h("Bearer espg-app-token-test"), xmltv, isEspg), "service");
});

test("no token means no service access (falls through to keys, logins, LAN)", async () => {
  assert.equal(await espgServiceCaller(h(), m3u, isEspg), "absent");
  assert.equal(wtCalls, 0);
});

test("a wrong token is refused", async () => {
  assert.equal(await espgServiceCaller(h("Bearer not-a-real-token"), m3u, isEspg), "refused");
});

test("another app's token (TwentyFourSeven's own) is refused", async () => {
  assert.equal(await espgServiceCaller(h("Bearer tfs-app-token-test"), m3u, isEspg), "refused");
});

test("playlist logins over HTTP Basic are not treated as an app token", async () => {
  const basic = "Basic " + Buffer.from("drew:pw").toString("base64");
  assert.equal(await espgServiceCaller(h(basic), m3u, isEspg), "absent");
  assert.equal(wtCalls, 0);
});

test("the ESPG token never opens streams, images, HDHomeRun or Xtream", async () => {
  for (const check of [
    { scope: "video" as const, resource: "ch:5" },
    { scope: "image" as const, resource: "*" },
    { scope: "guide" as const, resource: "hdhr" },
    { scope: "guide" as const, resource: "xtream" },
  ]) {
    assert.equal(serviceCallAllowed(check), false);
    assert.equal(await espgServiceCaller(h("Bearer espg-app-token-test"), check, isEspg), "absent");
  }
  assert.equal(wtCalls, 0);
});

test("WatchTower down: refused, and not cached", async () => {
  const down = createEspgCallerCheck({
    watchTowerUrl: async () => "http://watchtower.test",
    now: () => Date.now(),
    fetch: (async () => {
      throw new Error("ECONNREFUSED");
    }) as any,
  });
  assert.equal(await espgServiceCaller(h("Bearer espg-app-token-test"), m3u, down), "refused");
  assert.equal(await espgServiceCaller(h("Bearer espg-app-token-test"), m3u, isEspg), "service");
});

test("links handed to ESPG carry no key", () => {
  assert.equal(keyParam(""), "");
  assert.equal(keyParam("abc"), "&k=abc");
  assert.equal(keyParam("abc", "&amp;"), "&amp;k=abc");
});
