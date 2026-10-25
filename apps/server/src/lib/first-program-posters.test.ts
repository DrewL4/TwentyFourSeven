import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Equivalence on a throwaway SQLite file with the real schema: the batched lookup
// must give every channel the same poster the old per-channel findFirst did.
const dir = mkdtempSync(path.join(tmpdir(), "tfs-posters-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
let prisma: typeof import("./prisma").prisma;
let firstProgramPosters: typeof import("./first-program-posters").firstProgramPosters;

before(async () => {
  execFileSync("npx", ["prisma", "db", "push", "--schema", "./prisma/schema", "--skip-generate"], {
    cwd: path.resolve(__dirname, "../.."),
    env: process.env,
    stdio: "ignore",
  });
  ({ prisma } = await import("./prisma"));
  ({ firstProgramPosters } = await import("./first-program-posters"));
});
after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

async function oldPoster(channelId: string) {
  const program = await prisma.program.findFirst({
    where: { channelId },
    orderBy: { startTime: "asc" },
    include: { episode: { include: { show: true } }, movie: true },
  });
  return program?.episode?.show?.poster || program?.movie?.poster || null;
}

test("batched first-programme posters match per-channel findFirst (450 channels, 3 chunks)", async () => {
  const server = await prisma.mediaServer.create({ data: { name: "P", url: "http://plex", type: "PLEX" } });
  const lib = await prisma.mediaLibrary.create({ data: { serverId: server.id, key: "1", name: "L", type: "MOVIE" } });
  const withPoster = await prisma.mediaShow.create({ data: { libraryId: lib.id, title: "S1", ratingKey: "s1", poster: "http://plex/s1.jpg" } });
  const noPoster = await prisma.mediaShow.create({ data: { libraryId: lib.id, title: "S2", ratingKey: "s2" } });
  const ep = (showId: string, n: number) =>
    prisma.mediaEpisode.create({ data: { showId, title: `E${n}`, duration: 60_000, seasonNumber: 1, episodeNumber: n, ratingKey: `e${showId}${n}` } });
  const epA = await ep(withPoster.id, 1);
  const epB = await ep(noPoster.id, 1);
  const mvA = await prisma.mediaMovie.create({ data: { libraryId: lib.id, title: "M1", ratingKey: "m1", duration: 60_000, poster: "/images/local/m1.jpg" } });
  const mvB = await prisma.mediaMovie.create({ data: { libraryId: lib.id, title: "M2", ratingKey: "m2", duration: 60_000 } });

  const t0 = Date.UTC(2026, 9, 25);
  const ids: string[] = [];
  const programs: { channelId: string; episodeId?: string; movieId?: string; startTime: Date; duration: number }[] = [];
  for (let n = 0; n < 450; n++) {
    const ch = await prisma.channel.create({ data: { number: n + 1, name: `C${n}` } });
    ids.push(ch.id);
    const kind = n % 6; // 0 show poster first, 1 movie poster first, 2 show w/o poster first,
    //                     3 movie w/o poster first, 4 no programmes, 5 later programme has a poster
    if (kind === 4) continue;
    const first = [{ episodeId: epA.id }, { movieId: mvA.id }, { episodeId: epB.id }, { movieId: mvB.id }, null, { movieId: mvB.id }][kind]!;
    // Insert out of time order so the first row inserted is not the earliest.
    programs.push({ channelId: ch.id, episodeId: epA.id, startTime: new Date(t0 + (n + 2) * 3_600_000), duration: 3_600_000 });
    programs.push({ channelId: ch.id, ...first, startTime: new Date(t0 + n * 60_000), duration: 3_600_000 });
    if (kind === 5) programs.push({ channelId: ch.id, movieId: mvA.id, startTime: new Date(t0 + (n + 1) * 3_600_000), duration: 3_600_000 });
  }
  await prisma.program.createMany({ data: programs });

  const batched = await firstProgramPosters(ids, prisma);
  const expected = new Map<string, string | null>();
  for (const id of ids) expected.set(id, await oldPoster(id));
  for (const id of ids) assert.equal(batched.get(id) ?? null, expected.get(id), `channel ${id}`);
  const values = [...expected.values()];
  assert.ok(values.includes("http://plex/s1.jpg") && values.includes("/images/local/m1.jpg") && values.includes(null));
  assert.equal((await firstProgramPosters([], prisma)).size, 0);
});
