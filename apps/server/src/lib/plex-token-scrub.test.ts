import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubPlexTokens, toBrowserSafeUrl } from "./plex-token-scrub";

const TOKEN = "fake-token-for-tests";
const ORIGIN = "http://plex.lab.test:32400";

test("Plex poster URLs become /images/plex links without the token", () => {
  const out = toBrowserSafeUrl(`${ORIGIN}/library/metadata/16/thumb/1792679297?X-Plex-Token=${TOKEN}`);
  assert.equal(
    out,
    `/images/plex?origin=${encodeURIComponent(ORIGIN)}&path=${encodeURIComponent("/library/metadata/16/thumb/1792679297")}`,
  );
});

test("non-artwork URLs keep their shape but lose the token", () => {
  assert.equal(
    toBrowserSafeUrl(`${ORIGIN}/library/parts/1/file.mkv?X-Plex-Token=${TOKEN}&download=1`),
    `${ORIGIN}/library/parts/1/file.mkv?download=1`,
  );
  assert.equal(toBrowserSafeUrl(`${ORIGIN}/video?a=1&X-Plex-Token=${TOKEN}`), `${ORIGIN}/video?a=1`);
  assert.equal(toBrowserSafeUrl("Paste the X-Plex-Token value"), "Paste the X-Plex-Token value");
  assert.equal(toBrowserSafeUrl("https://cdn.example/logo.png"), "https://cdn.example/logo.png");
});

test("nested API data is scrubbed everywhere and nothing else changes", () => {
  const when = new Date("2026-10-22T12:00:00Z");
  const input = {
    channels: [
      {
        id: "c1",
        icon: null,
        startTime: when,
        currentProgram: {
          episode: { thumb: `${ORIGIN}/library/metadata/20/thumb/1?X-Plex-Token=${TOKEN}` },
          show: { poster: `${ORIGIN}/library/metadata/16/thumb/1?X-Plex-Token=${TOKEN}`, genres: '["Comedy"]' },
        },
      },
    ],
    movies: [{ poster: `${ORIGIN}/library/metadata/1/thumb/1?X-Plex-Token=${TOKEN}`, backdrop: `${ORIGIN}/library/metadata/1/art/1?X-Plex-Token=${TOKEN}` }],
    count: 2,
  };
  const out = scrubPlexTokens(input);
  assert.ok(!JSON.stringify(out).includes(TOKEN));
  assert.ok(!/X-Plex-Token/i.test(JSON.stringify(out)));
  assert.equal(out.count, 2);
  assert.equal(out.channels[0].startTime, when);
  assert.equal(out.channels[0].currentProgram.show.genres, '["Comedy"]');
  assert.ok(out.movies[0].backdrop.startsWith("/images/plex?"));
  // input is not mutated
  assert.ok(input.movies[0].poster.includes(TOKEN));
});

test("data without tokens is returned as the same object", () => {
  const data = { a: [1, "x", { b: null }], d: new Date() };
  assert.equal(scrubPlexTokens(data), data);
  const cyclic: Record<string, unknown> = { name: "loop" };
  cyclic.self = cyclic;
  assert.equal(scrubPlexTokens(cyclic), cyclic);
});
