import { prisma } from "../prisma";

/**
 * Switching where videos come from (local files <-> Plex) keeps every channel.
 * Each channel item is pointed at the same title in the new source, keeping its
 * order, weight, shuffle and episode memory. Upcoming guide entries follow.
 * Titles the new source does not have stay on the old source and are listed so
 * the user knows (they keep playing while that source is still reachable).
 */

export type SourceType = "LOCAL" | "PLEX";

export type SwitchReport = {
  source: SourceType;
  movedShows: number;
  movedMovies: number;
  movedPrograms: number;
  unmatched: Array<{ channel: string; title: string; kind: "show" | "movie" }>;
};

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Titled = { id: string; title: string; year: number | null };

/** Same title, and the same year when both sides know it (allowing a year off for release dates). */
export function findSameTitle<T extends Titled>(item: Titled, candidates: Map<string, T[]>): T | null {
  const list = candidates.get(normalizeTitle(item.title)) ?? [];
  if (list.length === 0) return null;
  if (item.year == null) return list[0];
  return (
    list.find((c) => c.year === item.year) ??
    list.find((c) => c.year != null && Math.abs(c.year - item.year!) <= 1) ??
    list.find((c) => c.year == null) ??
    null
  );
}

function byTitle<T extends Titled>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = normalizeTitle(r.title);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return map;
}

export async function switchMediaSource(target: SourceType): Promise<SwitchReport> {
  const report: SwitchReport = { source: target, movedShows: 0, movedMovies: 0, movedPrograms: 0, unmatched: [] };
  const inTarget = { library: { server: { type: target, active: true } } } as const;
  const notTarget = { library: { server: { type: { not: target } } } } as const;

  const [targetShows, targetMovies] = await Promise.all([
    prisma.mediaShow.findMany({ where: inTarget, select: { id: true, title: true, year: true } }),
    prisma.mediaMovie.findMany({ where: inTarget, select: { id: true, title: true, year: true, tmdbId: true, imdbId: true } }),
  ]);
  const showsByTitle = byTitle(targetShows);
  const moviesByTitle = byTitle(targetMovies);
  const moviesByTmdb = new Map(targetMovies.filter((m) => m.tmdbId).map((m) => [m.tmdbId!, m]));
  const moviesByImdb = new Map(targetMovies.filter((m) => m.imdbId).map((m) => [m.imdbId!, m]));

  const showMap = new Map<string, string>(); // old show id -> new show id
  const movieMap = new Map<string, string>();

  const channelShows = await prisma.channelShow.findMany({
    where: { show: notTarget },
    include: { show: { select: { id: true, title: true, year: true } }, channel: { select: { name: true } } },
  });
  for (const cs of channelShows) {
    const match = findSameTitle(cs.show, showsByTitle);
    if (!match) {
      report.unmatched.push({ channel: cs.channel.name, title: cs.show.title, kind: "show" });
      continue;
    }
    showMap.set(cs.show.id, match.id);
    const clash = await prisma.channelShow.findUnique({
      where: { channelId_showId: { channelId: cs.channelId, showId: match.id } },
    });
    if (clash) continue; // the channel already has it from the new source
    let lastPlayedEpisodeId: string | null = null;
    if (cs.lastPlayedEpisodeId) {
      const last = await prisma.mediaEpisode.findUnique({ where: { id: cs.lastPlayedEpisodeId } });
      if (last) {
        const same = await prisma.mediaEpisode.findFirst({
          where: { showId: match.id, seasonNumber: last.seasonNumber, episodeNumber: last.episodeNumber },
          select: { id: true },
        });
        lastPlayedEpisodeId = same?.id ?? null;
      }
    }
    await prisma.channelShow.update({ where: { id: cs.id }, data: { showId: match.id, lastPlayedEpisodeId } });
    report.movedShows++;
  }

  const channelMovies = await prisma.channelMovie.findMany({
    where: { movie: notTarget },
    include: {
      movie: { select: { id: true, title: true, year: true, tmdbId: true, imdbId: true } },
      channel: { select: { name: true } },
    },
  });
  for (const cm of channelMovies) {
    const m = cm.movie;
    const match =
      (m.tmdbId ? moviesByTmdb.get(m.tmdbId) : undefined) ??
      (m.imdbId ? moviesByImdb.get(m.imdbId) : undefined) ??
      findSameTitle(m, moviesByTitle);
    if (!match) {
      report.unmatched.push({ channel: cm.channel.name, title: m.title, kind: "movie" });
      continue;
    }
    movieMap.set(m.id, match.id);
    const clash = await prisma.channelMovie.findUnique({
      where: { channelId_movieId: { channelId: cm.channelId, movieId: match.id } },
    });
    if (clash) continue;
    await prisma.channelMovie.update({ where: { id: cm.id }, data: { movieId: match.id } });
    report.movedMovies++;
  }

  // Upcoming and current guide entries follow, so the guide does not change.
  const now = Date.now();
  const programs = await prisma.program.findMany({
    where: {
      startTime: { gte: new Date(now - 6 * 3600_000) },
      OR: [{ episode: { show: notTarget } }, { movie: notTarget }],
    },
    select: {
      id: true,
      startTime: true,
      duration: true,
      movieId: true,
      episode: { select: { showId: true, seasonNumber: true, episodeNumber: true } },
    },
  });
  const episodeCache = new Map<string, string | null>();
  for (const p of programs) {
    if (p.startTime.getTime() + p.duration < now) continue;
    if (p.movieId) {
      const to = movieMap.get(p.movieId);
      if (!to) continue;
      await prisma.program.update({ where: { id: p.id }, data: { movieId: to } });
      report.movedPrograms++;
    } else if (p.episode) {
      const toShow = showMap.get(p.episode.showId);
      if (!toShow) continue;
      const key = `${toShow}:${p.episode.seasonNumber}:${p.episode.episodeNumber}`;
      if (!episodeCache.has(key)) {
        const ep = await prisma.mediaEpisode.findFirst({
          where: { showId: toShow, seasonNumber: p.episode.seasonNumber, episodeNumber: p.episode.episodeNumber },
          select: { id: true },
        });
        episodeCache.set(key, ep?.id ?? null);
      }
      const to = episodeCache.get(key);
      if (!to) continue;
      await prisma.program.update({ where: { id: p.id }, data: { episodeId: to } });
      report.movedPrograms++;
    }
  }

  await prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", mediaSource: target },
    update: { mediaSource: target },
  });
  console.log(
    `[MediaSource] switched to ${target} shows=${report.movedShows} movies=${report.movedMovies} programs=${report.movedPrograms} unmatched=${report.unmatched.length}`,
  );
  return report;
}
