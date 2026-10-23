import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeFileMatcher } from "./reconcile";

test("matcher: same path, same file under another root, or a unique name+size", () => {
  const match = makeFileMatcher([
    { id: "bbb", relPath: "Big Buck Bunny (2008)/bbb.mp4", size: 100 },
    { id: "cos", relPath: "Cosmos/cosmos.mp4", size: 200 },
    { id: "dup1", relPath: "A/clip.mp4", size: 5 },
    { id: "dup2", relPath: "B/clip.mp4", size: 5 },
  ]);
  assert.equal(match({ relPath: "Big Buck Bunny (2008)/bbb.mp4", size: 100 })?.id, "bbb");
  assert.equal(match({ relPath: "Media/Movies/Cosmos/cosmos.mp4", size: 200 })?.id, "cos");
  assert.equal(match({ relPath: "elsewhere/cosmos.mp4", size: 200 })?.id, "cos");
  assert.equal(match({ relPath: "elsewhere/cosmos.mp4", size: 201 }), null, "different size is a different file");
  assert.equal(match({ relPath: "C/clip.mp4", size: 5 }), null, "ambiguous name+size never guesses");
  assert.equal(match({ relPath: "Nope/nope.mp4", size: 9 }), null);
});

// Database test on a throwaway SQLite file with the real schema.
const dir = mkdtempSync(path.join(tmpdir(), "tfs-reconcile-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
let prisma: typeof import("../prisma").prisma;
let reconcile: typeof import("./reconcile").reconcileLocalLibraries;
let buildMovieWhere: typeof import("../library-queries").buildMovieWhere;

before(async () => {
  execFileSync("npx", ["prisma", "db", "push", "--schema", "./prisma/schema", "--skip-generate"], {
    cwd: path.resolve(__dirname, "../../.."),
    env: process.env,
    stdio: "ignore",
  });
  ({ prisma } = await import("../prisma"));
  ({ reconcileLocalLibraries: reconcile } = await import("./reconcile"));
  ({ buildMovieWhere } = await import("../library-queries"));
});
after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

test("switching folders moves channels to the selected copy, drops unused copies, keeps the rest", async () => {
  const server = await prisma.mediaServer.create({ data: { name: "Local files", url: "local://files", type: "LOCAL" } });
  const lib = (key: string, type: "MOVIE" | "SHOW") => prisma.mediaLibrary.create({ data: { serverId: server.id, key, name: key, type } });
  const movie = async (libraryId: string, rel: string, title: string, size: number) => {
    await prisma.localMediaItem.create({ data: { libraryId, relPath: rel, kind: "movie", size } });
    return prisma.mediaMovie.create({ data: { libraryId, ratingKey: rel, title, duration: 60_000 } });
  };
  const oldMovies = await lib("/movies", "MOVIE");
  const oldTv = await lib("/tv", "SHOW");
  const newMovies = await lib("/media/Media/Movies", "MOVIE");
  const newTv = await lib("/media/Media/TV", "SHOW");
  const kept = await lib("/kids", "MOVIE");

  const oldBbb = await movie(oldMovies.id, "BBB/bbb.mp4", "Big Buck Bunny", 100);
  const oldCosmos = await movie(oldMovies.id, "Cosmos/cosmos.mp4", "Cosmos", 200);
  const orphan = await movie(oldMovies.id, "Gone/gone.mp4", "Only Old", 300);
  const newBbb = await movie(newMovies.id, "BBB/bbb.mp4", "Big Buck Bunny", 100);
  await movie(newMovies.id, "Cosmos/cosmos.mp4", "Cosmos", 200);
  const kidsMovie = await movie(kept.id, "Kid/kid.mp4", "Kid", 50);

  const show = async (libraryId: string) => {
    const s = await prisma.mediaShow.create({ data: { libraryId, ratingKey: "Hillbillies", title: "Hillbillies" } });
    await prisma.localMediaItem.create({ data: { libraryId, relPath: "Hillbillies", kind: "show" } });
    await prisma.localMediaItem.create({ data: { libraryId, relPath: "Hillbillies/S01E01.mp4", kind: "episode", size: 10 } });
    const e = await prisma.mediaEpisode.create({ data: { showId: s.id, ratingKey: "Hillbillies/S01E01.mp4", title: "Pilot", duration: 60_000, seasonNumber: 1, episodeNumber: 1 } });
    return { s, e };
  };
  const oldShow = await show(oldTv.id);
  const newShow = await show(newTv.id);

  const chA = await prisma.channel.create({ data: { number: 1, name: "A" } });
  const chB = await prisma.channel.create({ data: { number: 2, name: "B" } });
  await prisma.channelMovie.create({ data: { channelId: chA.id, movieId: oldBbb.id, order: 0 } });
  await prisma.channelMovie.create({ data: { channelId: chA.id, movieId: orphan.id, order: 1 } });
  await prisma.channelMovie.create({ data: { channelId: chA.id, movieId: kidsMovie.id, order: 2 } });
  await prisma.channelShow.create({ data: { channelId: chA.id, showId: oldShow.s.id, order: 3, lastPlayedEpisodeId: oldShow.e.id } });
  await prisma.channelMovie.create({ data: { channelId: chB.id, movieId: newBbb.id, order: 0 } });
  const p1 = await prisma.program.create({ data: { channelId: chA.id, movieId: oldBbb.id, startTime: new Date(), duration: 60_000 } });
  const p2 = await prisma.program.create({ data: { channelId: chA.id, episodeId: oldShow.e.id, startTime: new Date(Date.now() + 60_000), duration: 60_000 } });

  const report = await reconcile(server.id, ["/media/Media/Movies", "/media/Media/TV", "/kids"], ["/media/Media/Movies", "/media/Media/TV", "/kids"]);

  // Channel A now plays the selected copies, in the same order.
  const aMovies = await prisma.channelMovie.findMany({ where: { channelId: chA.id }, orderBy: { order: "asc" } });
  assert.deepEqual(aMovies.map((m) => m.movieId), [newBbb.id, orphan.id, kidsMovie.id]);
  const aShow = await prisma.channelShow.findFirstOrThrow({ where: { channelId: chA.id } });
  assert.equal(aShow.showId, newShow.s.id);
  assert.equal(aShow.lastPlayedEpisodeId, newShow.e.id, "episode memory follows");
  assert.equal((await prisma.program.findUniqueOrThrow({ where: { id: p1.id } })).movieId, newBbb.id);
  assert.equal((await prisma.program.findUniqueOrThrow({ where: { id: p2.id } })).episodeId, newShow.e.id);

  // Unused old copies are gone; the title only the old folder has stays for channel A.
  assert.equal(await prisma.mediaMovie.count({ where: { id: { in: [oldBbb.id, oldCosmos.id] } } }), 0);
  assert.equal(await prisma.mediaShow.count({ where: { id: oldShow.s.id } }), 0);
  assert.ok(await prisma.mediaMovie.findUnique({ where: { id: orphan.id } }));
  assert.deepEqual(report.unavailable, [{ path: "/movies", kind: "movies", titles: ["Only Old"] }]);
  assert.equal((await prisma.mediaLibrary.findUniqueOrThrow({ where: { id: oldMovies.id } })).available, false);
  assert.equal(await prisma.mediaLibrary.count({ where: { id: oldTv.id } }), 0, "an emptied old folder is removed");

  // Folders that stay selected keep their IDs.
  assert.ok(await prisma.mediaMovie.findUnique({ where: { id: kidsMovie.id } }));
  assert.equal((await prisma.mediaLibrary.findUniqueOrThrow({ where: { id: kept.id } })).available, true);

  // Add Content lists each title once.
  const titles = (await prisma.mediaMovie.findMany({ where: buildMovieWhere({ sourceType: "LOCAL" }), select: { title: true } })).map((m) => m.title).sort();
  assert.deepEqual(titles, ["Big Buck Bunny", "Cosmos", "Kid"]);

  // Running again changes nothing, and selecting /movies again brings it back.
  const again = await reconcile(server.id, ["/media/Media/Movies", "/media/Media/TV", "/kids"], ["/media/Media/Movies", "/media/Media/TV", "/kids"]);
  assert.equal(again.moved + again.dropped, 0);
  await reconcile(server.id, ["/movies", "/media/Media/Movies", "/media/Media/TV", "/kids"], ["/movies", "/media/Media/Movies", "/media/Media/TV", "/kids"]);
  assert.equal((await prisma.mediaLibrary.findUniqueOrThrow({ where: { id: oldMovies.id } })).available, true);
});

test("a channel that already has the selected copy keeps its old row (never removed silently)", async () => {
  const server = await prisma.mediaServer.findFirstOrThrow({ where: { type: "LOCAL" } });
  const old = await prisma.mediaLibrary.create({ data: { serverId: server.id, key: "/old2", name: "old2", type: "MOVIE" } });
  const cur = await prisma.mediaLibrary.findFirstOrThrow({ where: { key: "/media/Media/Movies" } });
  await prisma.localMediaItem.create({ data: { libraryId: old.id, relPath: "BBB/bbb.mp4", kind: "movie", size: 100 } });
  const dup = await prisma.mediaMovie.create({ data: { libraryId: old.id, ratingKey: "BBB/bbb.mp4", title: "Big Buck Bunny", duration: 60_000 } });
  const target = await prisma.mediaMovie.findFirstOrThrow({ where: { libraryId: cur.id, ratingKey: "BBB/bbb.mp4" } });
  const ch = await prisma.channel.create({ data: { number: 3, name: "C" } });
  await prisma.channelMovie.create({ data: { channelId: ch.id, movieId: target.id, order: 0 } });
  await prisma.channelMovie.create({ data: { channelId: ch.id, movieId: dup.id, order: 1 } });
  const report = await reconcile(server.id, ["/media/Media/Movies", "/media/Media/TV", "/kids", "/movies"], ["/media/Media/Movies", "/media/Media/TV", "/kids", "/movies"]);
  assert.equal(await prisma.channelMovie.count({ where: { channelId: ch.id } }), 2);
  assert.deepEqual(report.unavailable, [{ path: "/old2", kind: "movies", titles: ["Big Buck Bunny"] }]);
});
