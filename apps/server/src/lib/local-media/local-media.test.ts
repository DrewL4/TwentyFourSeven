import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { configuredLocalRoots, resolveInsideRoot } from "./paths";
import { isSkippedDir, parseEpisodeName, parseMovieName, parseNfo, pickArtwork } from "./parse";
import { chooseLocalPlayback } from "./playback";
import { describeLocalStatus } from "./status-text";
import { findSameTitle, normalizeTitle } from "./source-switch";

const base = mkdtempSync(path.join(tmpdir(), "tfs-local-"));
const root = path.join(base, "movies");
mkdirSync(path.join(root, "Big Buck Bunny (2008)"), { recursive: true });
writeFileSync(path.join(root, "Big Buck Bunny (2008)", "bbb.mkv"), "x");
writeFileSync(path.join(base, "secret.txt"), "nope");
symlinkSync(path.join(base, "secret.txt"), path.join(root, "escape.mkv"));

test("files resolve only inside their folder", () => {
  assert.ok(resolveInsideRoot(root, "Big Buck Bunny (2008)/bbb.mkv")?.endsWith("bbb.mkv"));
  for (const bad of [
    "../secret.txt",
    "Big Buck Bunny (2008)/../../secret.txt",
    decodeURIComponent("%2e%2e/secret.txt"),
    decodeURIComponent("%2e%2e%2fsecret.txt"),
    "..%2fsecret.txt",
    "/etc/passwd",
    path.join(base, "secret.txt"),
    "Big Buck Bunny (2008)\\..\\..\\secret.txt",
    "bbb.mkv\0.txt",
    "./Big Buck Bunny (2008)/bbb.mkv",
    "escape.mkv",
    "Big Buck Bunny (2008)",
    "",
  ]) {
    assert.equal(resolveInsideRoot(root, bad), null, JSON.stringify(bad));
  }
});

test("folders come from settings, then LOCAL_MEDIA_PATHS; relative paths ignored", () => {
  assert.deepEqual(configuredLocalRoots("/a, /b/ ;relative", {}), ["/a", "/b"]);
  assert.deepEqual(configuredLocalRoots("", { LOCAL_MEDIA_PATHS: "/x" }), ["/x"]);
});

test("empty or missing usual mount points are skipped, so no false 'no videos' warning", () => {
  const base = mkdtempSync(path.join(tmpdir(), "roots-"));
  const full = path.join(base, "movies");
  const empty = path.join(base, "media");
  mkdirSync(full);
  mkdirSync(empty);
  writeFileSync(path.join(full, "A (2000).mkv"), "x");
  assert.deepEqual(configuredLocalRoots("", {}, [full, empty, path.join(base, "tv")]), [full]);
  // A folder the person typed in is kept even when empty, so they get a clear warning about it.
  assert.deepEqual(configuredLocalRoots(empty, {}), [empty]);
});

test("movie and episode names", () => {
  assert.deepEqual(parseMovieName("Big Buck Bunny (2008).mkv"), { title: "Big Buck Bunny", year: 2008 });
  assert.deepEqual(parseMovieName("Tears.of.Steel.2012.1080p.mkv"), { title: "Tears of Steel", year: 2012 });
  assert.equal(parseEpisodeName("Show.S02E05.Title.mkv")?.episode, 5);
  assert.equal(parseEpisodeName("Show.S02E05.Title.mkv")?.season, 2);
  assert.deepEqual(parseEpisodeName("3x07.mkv")?.season, 3);
  assert.equal(parseEpisodeName("04 - Pilot.mkv", "Season 1")?.episode, 4);
  assert.equal(parseEpisodeName("random.mkv"), null);
  assert.equal(isSkippedDir("Extras"), true);
  assert.equal(isSkippedDir("Season 1"), false);
});

test("Kodi NFO and artwork", () => {
  const nfo = parseNfo(`<movie><title>Sintel</title><year>2010</year><plot>A girl &amp; a dragon</plot><genre>Animation</genre><uniqueid type="tmdb">45745</uniqueid></movie>`);
  assert.equal(nfo.title, "Sintel");
  assert.equal(nfo.year, 2010);
  assert.equal(nfo.plot, "A girl & a dragon");
  assert.deepEqual(nfo.genres, ["Animation"]);
  assert.equal(nfo.tmdbId, 45745);
  assert.deepEqual(pickArtwork(["Poster.JPG", "fanart.jpg", "x.mkv"]), { poster: "Poster.JPG", backdrop: "fanart.jpg" });
});

test("copy when compatible, convert otherwise", () => {
  assert.deepEqual(chooseLocalPlayback({ videoCodec: "h264", audioCodec: "aac", audioChannels: 2, pixFmt: "yuv420p" }, { browser: true }).copyAudio, true);
  assert.equal(chooseLocalPlayback({ videoCodec: "h264", audioCodec: "ac3", audioChannels: 6 }, { browser: false }).copyAudio, false);
  assert.equal(chooseLocalPlayback({ videoCodec: "hevc", audioCodec: "aac" }, { browser: false }).copyVideo, true);
  assert.equal(chooseLocalPlayback({ videoCodec: "hevc", audioCodec: "aac" }, { browser: true }).copyVideo, false);
  assert.equal(chooseLocalPlayback({ videoCodec: "h264", pixFmt: "yuv420p10le" }, { browser: true }).copyVideo, false);
  assert.equal(chooseLocalPlayback({ videoCodec: "mpeg4" }, { browser: false }).copyVideo, false);
  assert.equal(chooseLocalPlayback(null, { browser: false }).copyVideo, false);
});

describe("describeLocalStatus", () => {
  const base = { running: false, startedAt: "x", finishedAt: "y", lastError: null, probed: 0, skippedUnchanged: 0, removed: 0 };
  test("counts in plain words", () => {
    const s = describeLocalStatus(
      { ...base, folders: [
        { path: "/movies", ok: true, kind: "movies", movies: 1234, shows: 0, episodes: 0 },
        { path: "/tv", ok: true, kind: "shows", movies: 0, shows: 456, episodes: 9000 },
      ] },
      { enabled: true },
    );
    assert.equal(s.message, "Found 1,234 movies and 456 shows in /movies and /tv");
    assert.equal(s.tone, "ok");
  });
  test("missing folder gives a fix", () => {
    const s = describeLocalStatus(
      { ...base, folders: [
        { path: "/movies", ok: true, kind: "movies", movies: 1, shows: 0, episodes: 0 },
        { path: "/tv", ok: false, kind: null, movies: 0, shows: 0, episodes: 0, problem: "missing" },
      ] },
      { enabled: true },
    );
    assert.equal(s.message, "Found 1 movie in /movies");
    assert.equal(s.tone, "problem");
    assert.match(s.fixes[0], /can't open \/tv/);
  });
  test("nothing mapped", () => {
    const s = describeLocalStatus({ ...base, folders: [] }, { enabled: true });
    assert.equal(s.tone, "problem");
    assert.match(s.fixes[0], /map your movies folder to \/movies/);
  });
});

describe("source switch title matching", () => {
  test("normalizes and prefers the same year", () => {
    assert.equal(normalizeTitle("The Matrix: Reloaded"), "matrix reloaded");
    const map = new Map([["big buck bunny", [{ id: "a", title: "Big Buck Bunny", year: 2008 }, { id: "b", title: "Big Buck Bunny", year: 2014 }]]]);
    assert.equal(findSameTitle({ id: "x", title: "big buck bunny!", year: 2014 }, map)?.id, "b");
    assert.equal(findSameTitle({ id: "x", title: "Big Buck Bunny", year: 1990 }, map), null);
    assert.equal(findSameTitle({ id: "x", title: "Unknown", year: null }, map), null);
  });
});

test("system folders are never media folders", () => {
  assert.deepEqual(configuredLocalRoots("/, /etc, /proc/1, /app, /movies", {}), ["/movies"]);
});
