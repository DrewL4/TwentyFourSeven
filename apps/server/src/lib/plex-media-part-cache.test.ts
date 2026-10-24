import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { PlexAPI, mediaPartCacheSize } from "./plex";

test("expired media part entries are dropped when new ones are stored", async () => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  console.log = () => {};
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ MediaContainer: { Metadata: [{ Media: [{ Part: [{ key: "/p", duration: "1000" }] }] }] } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  try {
    const plex = new PlexAPI();
    const before = mediaPartCacheSize();
    for (let i = 0; i < 50; i++) await plex.getMediaParts("http://plex.lab.test", "t", `old-${i}`);
    assert.equal(mediaPartCacheSize(), before + 50);

    mock.timers.tick(7 * 60 * 60 * 1000); // past the 6 h lifetime
    await plex.getMediaParts("http://plex.lab.test", "t", "new");
    assert.equal(mediaPartCacheSize(), 1);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    mock.timers.reset();
  }
});
