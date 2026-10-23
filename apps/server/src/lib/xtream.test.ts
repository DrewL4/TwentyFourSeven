import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryId, epgListings, liveCategories, liveStreams, parseLiveStream, serverInfo, xtreamTime } from "./xtream";
import { createEspgCallerCheck, bearer, clearEspgCallerCache } from "./espg-caller";
import { signLink, verifyLink } from "./link-security";

process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || "unit-test-secret-not-real";

const channels = [
  { number: 1, name: "Cartoons", groupTitle: "Kids", icon: null, createdAt: new Date(1_700_000_000_000) },
  { number: 2, name: "Movies 24/7", groupTitle: null, icon: "http://x/logo.png", createdAt: new Date(1_700_000_000_000) },
  { number: 5, name: "Toons 2", groupTitle: "Kids", icon: null },
];

test("categories: one per group, stable ids, ungrouped goes to TwentyFourSeven", () => {
  const cats = liveCategories(channels);
  assert.deepEqual(cats.map((c) => c.category_name), ["Kids", "TwentyFourSeven"]);
  assert.equal(cats[0].category_id, categoryId("Kids"));
  assert.equal(categoryId("Kids"), categoryId("Kids"));
  assert.notEqual(categoryId("Kids"), categoryId("News"));
  assert.match(cats[0].category_id, /^\d+$/);
});

test("live streams: stream_id is the channel number, epg id matches XMLTV, no direct_source", () => {
  const rows = liveStreams(channels, (c) => (c.icon ? "ICON" : ""));
  assert.deepEqual(rows.map((r) => r.stream_id), [1, 2, 5]);
  assert.equal(rows[1].epg_channel_id, "Movies 24/7");
  assert.equal(rows[1].stream_icon, "ICON");
  assert.ok(rows.every((r) => r.direct_source === "" && r.stream_type === "live"));
  assert.deepEqual(liveStreams(channels, () => "", categoryId("Kids")).map((r) => r.stream_id), [1, 5]);
});

test("short EPG: base64 title/description and UTC times", () => {
  const start = new Date(Date.UTC(2026, 9, 23, 18, 0, 0));
  const rows = epgListings(channels[0], [{ id: "p1", startTime: start, durationMs: 30 * 60_000, title: "Show – S1E1", description: "Fun" }], new Date(Date.UTC(2026, 9, 23, 18, 10)), true);
  assert.equal(Buffer.from(String(rows[0].title), "base64").toString("utf8"), "Show – S1E1");
  assert.equal(rows[0].start, "2026-10-23 18:00:00");
  assert.equal(rows[0].end, "2026-10-23 18:30:00");
  assert.equal(rows[0].now_playing, 1);
  assert.equal(xtreamTime(start), "2026-10-23 18:00:00");
});

test("server_info reflects the address the app used", () => {
  const s = serverInfo("http://192.168.1.5:8247", new Date(0));
  assert.equal(s.url, "192.168.1.5");
  assert.equal(s.port, "8247");
  assert.equal(s.server_protocol, "http");
  const h = serverInfo("https://tv.example.com", new Date(0));
  assert.equal(h.https_port, "443");
  assert.equal(h.server_protocol, "https");
});

test("/live stream names", () => {
  assert.deepEqual(parseLiveStream("12.ts"), { channel: 12, ext: "ts" });
  assert.deepEqual(parseLiveStream("3.m3u8"), { channel: 3, ext: "m3u8" });
  assert.deepEqual(parseLiveStream("7"), { channel: 7, ext: "ts" });
  assert.equal(parseLiveStream("../etc"), null);
  assert.equal(parseLiveStream("1.mp4"), null);
});

test("signed per-viewer links only open their channel and expire", () => {
  const now = 1_800_000_000_000;
  const t = signLink("video", "ch:5", "espg:viewer@example.test", 300, { now });
  assert.ok(verifyLink(t, "video", "ch:5", { now: now + 299_000 }).ok);
  assert.ok(!verifyLink(t, "video", "ch:6", { now }).ok);
  assert.ok(!verifyLink(t, "video", "ch:5", { now: now + 301_000 }).ok);
});

test("ESPG caller check: only active 'espg' app tokens, cached by hash", async () => {
  clearEspgCallerCache();
  const seen: string[] = [];
  let clock = 0;
  const check = createEspgCallerCheck({
    watchTowerUrl: async () => "http://wt.test/",
    fetch: (async (url: string, init: any) => {
      seen.push(url);
      const token = JSON.parse(init.body).token;
      const app = token === "espg-token" ? "espg" : token === "tfs-token" ? "twentyfourseven" : null;
      return new Response(JSON.stringify(app ? { valid: true, app_name: app } : { error: "nope" }), {
        status: app ? 200 : 401,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
    now: () => clock,
  });
  assert.equal(await check("espg-token"), true);
  assert.equal(await check("tfs-token"), false);
  assert.equal(await check("garbage"), false);
  assert.equal(await check(null), false);
  assert.equal(seen[0], "http://wt.test/api/api/v1/auth/validate-api-token/");
  await check("espg-token");
  assert.equal(seen.length, 3, "cached");
  clock += 61_000;
  await check("espg-token");
  assert.equal(seen.length, 4);
  assert.equal(bearer(new Headers({ authorization: "Bearer abc" })), "abc");
  assert.equal(bearer(new Headers({ authorization: "Token abc" })), "abc");
  assert.equal(bearer(new Headers()), null);
});
