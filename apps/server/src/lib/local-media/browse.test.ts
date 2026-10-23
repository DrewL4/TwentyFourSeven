import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanPickedFolders, findVideoFolders, guessKind, isHiddenFolder, listFolder, resolveBrowsePath } from "./browse";
import { configuredLocalRoots } from "./paths";

/*
 * An Unraid-like layout: "media" stands for /mnt/user mapped to /media.
 *   media/Media/Movies/<Title (Year)>/<file>
 *   media/Media/TV/<Show>/Season 01/<S01E01>
 *   media/appdata/plex/...        (must never show)
 *   media/.Trash, media/isos      (hidden)
 *   media/escape -> outside       (symlink out: refused)
 *   media/Media/MoviesLink -> Media/Movies (symlink inside: allowed)
 */
const base = mkdtempSync(path.join(tmpdir(), "tfs-browse-"));
const media = path.join(base, "media");
const outside = path.join(base, "outside");
const touch = (p: string) => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "x".repeat(2048));
};
for (const m of ["Big Buck Bunny (2008)", "Sintel (2010)", "Tears of Steel (2012)"]) touch(path.join(media, "Media/Movies", m, `${m}.mkv`));
for (const e of ["S01E01", "S01E02", "S01E03"]) touch(path.join(media, "Media/TV/The Show/Season 01", `The Show - ${e}.mkv`));
touch(path.join(media, "Media/TV/Other Show/Other Show S02E01.mp4"));
touch(path.join(media, "appdata/plex/Library/cache/trailer (2001).mkv"));
touch(path.join(media, "isos/win.mkv"));
touch(path.join(media, ".Trash/old (1999).mkv"));
touch(path.join(media, "Documents/notes.txt"));
touch(path.join(outside, "secret (2001).mkv"));
symlinkSync(outside, path.join(media, "escape"));
symlinkSync(path.join(media, "Media/Movies"), path.join(media, "Media/MoviesLink"));
const roots = [media, path.join(base, "tv-not-mapped")];

describe("resolveBrowsePath refuses anything outside the media folders", () => {
  test("roots and visible folders resolve", () => {
    assert.equal(resolveBrowsePath(media, roots)?.path, media);
    assert.equal(resolveBrowsePath(`${media}/Media/Movies`, roots)?.path, `${media}/Media/Movies`);
    assert.equal(resolveBrowsePath(`${media}/Media/Movies/`, roots)?.path, `${media}/Media/Movies`);
    assert.ok(resolveBrowsePath(`${media}/Media/MoviesLink`, roots), "symlink that stays inside is fine");
  });
  for (const bad of [
    "",
    "/",
    "/app",
    "/proc/self",
    "/etc",
    "relative/path",
    "Media/Movies",
    `${media}/..`,
    `${media}/../outside`,
    `${media}/Media/../../outside`,
    `${media}/./Media`,
    `${media}//Media`,
    `${media}/Media\\..\\..`,
    `${media}/Media\0`,
    `${media}-other`,
    `${media}/escape`,
    `${media}/escape/`,
    `${media}/appdata`,
    `${media}/APPDATA/plex`,
    `${media}/isos`,
    `${media}/.Trash`,
    `${media}/Documents/notes.txt`,
    `${media}/does-not-exist`,
    outside,
  ]) {
    test(`refuses ${JSON.stringify(bad)}`, () => assert.equal(resolveBrowsePath(bad, roots), null));
  }
  test("non-strings are refused", () => {
    assert.equal(resolveBrowsePath(undefined, roots), null);
    assert.equal(resolveBrowsePath(["/media"], roots), null);
  });
  test("a root that is itself a link into a system folder is refused", () => {
    const sneaky = path.join(base, "sneaky-root");
    symlinkSync("/proc", sneaky);
    assert.equal(resolveBrowsePath(sneaky, [sneaky]), null);
  });
});

test("Unraid system shares and dot-folders are hidden", () => {
  for (const n of ["appdata", "system", "domains", "isos", ".Trash", "@eaDir", "#recycle", "lost+found"]) assert.ok(isHiddenFolder(n), n);
  for (const n of ["Media", "Movies", "TV", "Kids Shows"]) assert.equal(isHiddenFolder(n), false, n);
});

describe("guessKind", () => {
  test("episodes and season folders look like TV", () => {
    assert.equal(guessKind("Stuff", ["A/Season 01/01 - Pilot.mkv", "A/Season 01/02.mkv", "B/B S01E02.mkv"]), "shows");
  });
  test("'Title (Year)' looks like movies", () => {
    assert.equal(guessKind("Stuff", ["Alien (1979)/Alien (1979).mkv", "Heat.1995.1080p.mkv"]), "movies");
  });
  test("a mix is reported as a mix", () => {
    assert.equal(guessKind("Stuff", ["Alien (1979)/a.mkv", "Heat (1995)/h.mkv", "S/Season 1/S01E01.mkv", "S/Season 1/S01E02.mkv"]), "mixed");
  });
  test("random home videos get no guess; empty gets none", () => {
    assert.equal(guessKind("Phone", ["IMG_0001.mp4", "clip.mov"]), null);
    assert.equal(guessKind("Movies", []), null);
  });
});

describe("listFolder", () => {
  test("top level lists only mapped roots", async () => {
    const top = await listFolder(null, roots);
    assert.deepEqual(top?.entries.map((e) => e.path), [media]);
  });
  test("a whole share isn't called Movies when its TV episodes sit deeper than the quick look", async () => {
    const top = await listFolder(null, roots);
    assert.equal(top?.entries[0].guess, null);
  });
  test("hides system shares, dot-folders and links that leave the root", async () => {
    const l = await listFolder(media, roots);
    const names = l!.entries.map((e) => e.name);
    assert.deepEqual(names, ["Documents", "Media"]);
    assert.equal(l!.parent, "");
  });
  test("counts videos and guesses the kind of each folder", async () => {
    const l = await listFolder(`${media}/Media`, roots);
    const by = Object.fromEntries(l!.entries.map((e) => [e.name, e]));
    assert.equal(by.Movies.guess, "movies");
    assert.equal(by.Movies.videos, 3);
    assert.equal(by.TV.guess, "shows");
    assert.equal(by.TV.videos, 4);
    assert.ok(by.MoviesLink, "inside link is listed");
    assert.equal(l!.parent, media);
  });
  test("refuses to list outside", async () => {
    assert.equal(await listFolder(`${media}/escape`, roots), null);
    assert.equal(await listFolder("/app", roots), null);
    assert.equal(await listFolder(`${media}/appdata`, roots), null);
  });
  test("stops at the time limit instead of walking everything", async () => {
    const l = await listFolder(`${media}/Media`, roots, { timeMs: -1 });
    assert.ok(l!.entries.every((e) => e.videos === -1));
  });
});

describe("findVideoFolders", () => {
  test("finds Movies and TV inside a whole-server mapping, never appdata", async () => {
    const r = await findVideoFolders(roots);
    assert.deepEqual(
      r.suggestions.map((s) => [s.path, s.kind]),
      [
        [`${media}/Media/Movies`, "movies"],
        [`${media}/Media/TV`, "shows"],
      ],
    );
    assert.equal(r.finished, true);
  });
  test("a folder mapped straight to movies is suggested as itself", async () => {
    const r = await findVideoFolders([`${media}/Media/Movies`]);
    assert.deepEqual(r.suggestions.map((s) => s.path), [`${media}/Media/Movies`]);
  });
  test("the same folder mapped twice is suggested once", async () => {
    const r = await findVideoFolders([`${media}/Media/Movies`, media]);
    assert.deepEqual(r.suggestions.map((s) => s.path), [`${media}/Media/Movies`, `${media}/Media/TV`]);
  });
});

test("picked folders: outside ones are rejected, nested ones collapse", () => {
  const r = cleanPickedFolders([`${media}/Media/Movies`, `${media}/Media/Movies/Sintel (2010)`, `${media}/Media/TV`, `${media}/escape`, "/etc"], roots);
  assert.deepEqual(r.kept, [`${media}/Media/Movies`, `${media}/Media/TV`]);
  assert.deepEqual(r.rejected, [`${media}/escape`, "/etc"]);
});

test("a whole-server /media is not scanned until folders are picked", () => {
  const whole = mkdtempSync(path.join(tmpdir(), "whole-"));
  const m = path.join(whole, "media");
  mkdirSync(path.join(m, "appdata"), { recursive: true });
  mkdirSync(path.join(m, "Media"));
  assert.deepEqual(configuredLocalRoots("", {}, [m]), []);
  const split = path.join(whole, "split", "media");
  mkdirSync(path.join(split, "Movies"), { recursive: true });
  assert.deepEqual(configuredLocalRoots("", {}, [split]), [split]);
});
