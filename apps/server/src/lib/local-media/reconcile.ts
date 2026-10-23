import path from "node:path";
import { prisma } from "../prisma";

/**
 * Folder switches. Each local folder is its own library, keyed by its path in
 * the container. When the admin picks different folders (say /movies and /tv
 * become /media/Media/Movies and /media/Media/TV), the new folders get new
 * libraries and the old ones would linger: Add Content then lists every title
 * twice, and channels keep pointing at copies that may no longer be reachable.
 *
 * After a scan, every library whose folder is no longer selected is handled here:
 * - Titles that are also in a selected folder (same file, found by path or by
 *   name and size) move to that copy: channel lineups, guide entries, episode
 *   memory and franchise entries all follow. The old copy is then dropped.
 * - Titles no channel uses are dropped.
 * - Titles a channel still uses but that exist nowhere else are kept as they
 *   are, hidden from Add Content, and listed in Settings. Nothing in a lineup
 *   is ever removed here.
 * Libraries of folders that are still selected are never touched, so their IDs
 * stay the same.
 */

export type Candidate = { id: string; relPath: string; size: number };

const sizesAgree = (a: number, b: number) => a <= 0 || b <= 0 || a === b;
const nameSizeKey = (relPath: string, size: number) => `${path.posix.basename(relPath).toLowerCase()}|${size}`;

/** Finds the same file among `candidates`: same path, the same path seen from another root, or one file with that name and size. */
export function makeFileMatcher(candidates: Candidate[]): (item: { relPath: string; size: number }) => Candidate | null {
  const byRel = new Map<string, Candidate>();
  const byNameSize = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (!byRel.has(c.relPath)) byRel.set(c.relPath, c);
    if (c.size > 0) {
      const k = nameSizeKey(c.relPath, c.size);
      byNameSize.set(k, [...(byNameSize.get(k) ?? []), c]);
    }
  }
  return (item) => {
    const exact = byRel.get(item.relPath);
    if (exact) return exact;
    const nested = candidates.filter(
      (c) =>
        (c.relPath.endsWith(`/${item.relPath}`) || item.relPath.endsWith(`/${c.relPath}`)) &&
        sizesAgree(c.size, item.size),
    );
    if (nested.length === 1) return nested[0];
    if (item.size > 0) {
      const same = byNameSize.get(nameSizeKey(item.relPath, item.size)) ?? [];
      if (same.length === 1) return same[0];
    }
    return null;
  };
}

export type UnavailableFolder = { path: string; kind: "movies" | "shows"; titles: string[] };
export type ReconcileReport = { moved: number; dropped: number; unavailable: UnavailableFolder[] };

async function sizesFor(libraryIds: string[]): Promise<Map<string, number>> {
  if (libraryIds.length === 0) return new Map();
  const rows = await prisma.localMediaItem.findMany({
    where: { libraryId: { in: libraryIds } },
    select: { libraryId: true, relPath: true, size: true },
  });
  return new Map(rows.map((r) => [`${r.libraryId}|${r.relPath}`, r.size]));
}

/**
 * @param selectedRoots folders that are selected now (missing or not); their libraries stay as they are.
 * @param readableRoots selected folders that were scanned fine; only these can take over titles.
 */
export async function reconcileLocalLibraries(
  serverId: string,
  selectedRoots: string[],
  readableRoots: string[],
): Promise<ReconcileReport> {
  const report: ReconcileReport = { moved: 0, dropped: 0, unavailable: [] };
  const libraries = await prisma.mediaLibrary.findMany({ where: { serverId } });
  const selected = new Set(selectedRoots);
  const readable = new Set(readableRoots);

  await prisma.mediaLibrary.updateMany({
    where: { serverId, key: { in: selectedRoots }, available: false },
    data: { available: true },
  });
  const stale = libraries.filter((l) => !selected.has(l.key));
  if (stale.length === 0) return report;

  const targets = libraries.filter((l) => readable.has(l.key));
  const sizes = await sizesFor([...targets, ...stale].map((l) => l.id));
  const sizeOf = (libraryId: string, relPath: string) => sizes.get(`${libraryId}|${relPath}`) ?? 0;

  const movieTargets = targets.filter((l) => l.type === "MOVIE").map((l) => l.id);
  const showTargets = targets.filter((l) => l.type === "SHOW").map((l) => l.id);
  const matchMovie = makeFileMatcher(
    (await prisma.mediaMovie.findMany({ where: { libraryId: { in: movieTargets } }, select: { id: true, ratingKey: true, libraryId: true } })).map(
      (m) => ({ id: m.id, relPath: m.ratingKey, size: sizeOf(m.libraryId, m.ratingKey) }),
    ),
  );
  const targetShows = await prisma.mediaShow.findMany({ where: { libraryId: { in: showTargets } }, select: { id: true, ratingKey: true, libraryId: true } });
  const showLibrary = new Map(targetShows.map((s) => [s.id, s.libraryId]));
  const matchShow = makeFileMatcher(targetShows.map((s) => ({ id: s.id, relPath: s.ratingKey, size: 0 })));

  for (const lib of stale) {
    if (lib.available) await prisma.mediaLibrary.update({ where: { id: lib.id }, data: { available: false } });
    const kept: string[] = [];

    if (lib.type === "MOVIE") {
      const movies = await prisma.mediaMovie.findMany({ where: { libraryId: lib.id }, select: { id: true, title: true, ratingKey: true } });
      for (const m of movies) {
        const target = matchMovie({ relPath: m.ratingKey, size: sizeOf(lib.id, m.ratingKey) });
        if (target) {
          for (const cm of await prisma.channelMovie.findMany({ where: { movieId: m.id } })) {
            const clash = await prisma.channelMovie.findUnique({ where: { channelId_movieId: { channelId: cm.channelId, movieId: target.id } } });
            if (clash) continue; // the channel already has the selected copy; leave this row, it is reported below
            await prisma.channelMovie.update({ where: { id: cm.id }, data: { movieId: target.id } });
            report.moved++;
          }
          await prisma.program.updateMany({ where: { movieId: m.id }, data: { movieId: target.id } });
          await prisma.franchiseEntry.updateMany({ where: { movieId: m.id }, data: { movieId: target.id } });
        }
        const [inChannels, inGuide, inFranchises] = await Promise.all([
          prisma.channelMovie.count({ where: { movieId: m.id } }),
          prisma.program.count({ where: { movieId: m.id } }),
          prisma.franchiseEntry.count({ where: { movieId: m.id } }),
        ]);
        if (inChannels + inGuide + inFranchises === 0) {
          await prisma.mediaMovie.delete({ where: { id: m.id } });
          await prisma.localMediaItem.deleteMany({ where: { libraryId: lib.id, relPath: m.ratingKey } });
          report.dropped++;
        } else {
          kept.push(m.title);
        }
      }
    } else {
      const shows = await prisma.mediaShow.findMany({
        where: { libraryId: lib.id },
        select: { id: true, title: true, ratingKey: true, episodes: { select: { id: true, ratingKey: true, seasonNumber: true, episodeNumber: true } } },
      });
      for (const s of shows) {
        const target = matchShow({ relPath: s.ratingKey, size: 0 });
        if (target) {
          const targetEps = await prisma.mediaEpisode.findMany({ where: { showId: target.id }, select: { id: true, ratingKey: true, seasonNumber: true, episodeNumber: true } });
          const matchEp = makeFileMatcher(targetEps.map((e) => ({ id: e.id, relPath: e.ratingKey, size: sizeOf(showLibrary.get(target.id) ?? "", e.ratingKey) })));
          const epMap = new Map<string, string>();
          for (const e of s.episodes) {
            const to =
              matchEp({ relPath: e.ratingKey, size: sizeOf(lib.id, e.ratingKey) })?.id ??
              targetEps.find((t) => t.seasonNumber === e.seasonNumber && t.episodeNumber === e.episodeNumber)?.id;
            if (to) epMap.set(e.id, to);
          }
          for (const cs of await prisma.channelShow.findMany({ where: { showId: s.id } })) {
            const clash = await prisma.channelShow.findUnique({ where: { channelId_showId: { channelId: cs.channelId, showId: target.id } } });
            if (clash) continue;
            const lastPlayedEpisodeId = cs.lastPlayedEpisodeId ? epMap.get(cs.lastPlayedEpisodeId) ?? null : null;
            await prisma.channelShow.update({ where: { id: cs.id }, data: { showId: target.id, lastPlayedEpisodeId } });
            report.moved++;
          }
          for (const [from, to] of epMap) {
            await prisma.program.updateMany({ where: { episodeId: from }, data: { episodeId: to } });
          }
        }
        const [inChannels, inGuide] = await Promise.all([
          prisma.channelShow.count({ where: { showId: s.id } }),
          prisma.program.count({ where: { episode: { showId: s.id } } }),
        ]);
        if (inChannels + inGuide === 0) {
          await prisma.mediaShow.delete({ where: { id: s.id } });
          await prisma.localMediaItem.deleteMany({
            where: { libraryId: lib.id, OR: [{ relPath: s.ratingKey }, { relPath: { startsWith: `${s.ratingKey}/` } }] },
          });
          report.dropped++;
        } else {
          kept.push(s.title);
        }
      }
    }

    if (kept.length) {
      report.unavailable.push({ path: lib.key, kind: lib.type === "MOVIE" ? "movies" : "shows", titles: kept });
    } else {
      const left = await prisma.mediaLibrary.findUnique({ where: { id: lib.id }, select: { _count: { select: { movies: true, shows: true } } } });
      if (left && left._count.movies + left._count.shows === 0) {
        await prisma.localMediaItem.deleteMany({ where: { libraryId: lib.id } });
        await prisma.mediaLibrary.delete({ where: { id: lib.id } });
      }
    }
  }

  console.log(
    `[LocalMedia] folders no longer selected: moved=${report.moved} dropped=${report.dropped} kept-in-channels=${report.unavailable.reduce((a, f) => a + f.titles.length, 0)}`,
  );
  return report;
}
