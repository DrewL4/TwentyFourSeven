import { prisma } from './prisma';
import { LEGACY_TIMELINE_SORT_ALIASES } from './franchise-legacy-sort';
import { normalizeTitle } from './title-normalize';
import { bestEntryPositionForMovie } from './franchise-title-match';

export type SortableChannelItem = {
  id: string;
  type: 'movie' | 'show';
  title: string;
  year?: number | null;
  duration?: number;
  movieId?: string;
  tmdbId?: number | null;
};

export type FranchiseEntryMatch = {
  position: number;
  movieId: string | null;
  tmdbId: number | null;
  titlePattern: string | null;
  label: string | null;
};

export type FranchiseSortPreviewItem = {
  channelItemId: string;
  type: 'movie' | 'show';
  title: string;
  year: number | null;
  matched: boolean;
  franchisePosition: number | null;
};

/**
 * Resolve timeline:<slug> or legacy timeline-mcu / timeline-star-wars to a franchise slug.
 */
export function parseFranchiseSlugFromSortMethod(sortMethod: string): string | null {
  const trimmed = sortMethod?.trim();
  if (!trimmed) return null;

  if (LEGACY_TIMELINE_SORT_ALIASES[trimmed]) {
    return LEGACY_TIMELINE_SORT_ALIASES[trimmed];
  }

  if (trimmed.startsWith('timeline:')) {
    return trimmed.slice('timeline:'.length);
  }

  return null;
}

export function isFranchiseTimelineSortMethod(sortMethod: string): boolean {
  return parseFranchiseSlugFromSortMethod(sortMethod) !== null;
}

export function franchiseSortMethodForSlug(slug: string): string {
  return `timeline:${slug}`;
}

/**
 * Find watch-order index for a movie (-1 if not in franchise list).
 */
export function resolveFranchisePosition(
  item: Pick<SortableChannelItem, 'movieId' | 'tmdbId' | 'title' | 'year'>,
  entries: FranchiseEntryMatch[],
): number {
  if (item.movieId) {
    const byMovie = entries.find((e) => e.movieId === item.movieId);
    if (byMovie) return byMovie.position;
  }

  if (item.tmdbId != null) {
    const byTmdb = entries.find((e) => e.tmdbId === item.tmdbId);
    if (byTmdb) return byTmdb.position;
  }

  return bestEntryPositionForMovie(
    { title: item.title, year: item.year, tmdbId: item.tmdbId, movieId: item.movieId },
    entries,
  );
}

export async function loadFranchiseEntries(
  franchiseSlug: string,
): Promise<FranchiseEntryMatch[]> {
  const franchise = await prisma.franchise.findUnique({
    where: { slug: franchiseSlug },
    include: {
      entries: { orderBy: { position: 'asc' } },
    },
  });
  if (!franchise) return [];

  return franchise.entries.map((e) => ({
    position: e.position,
    movieId: e.movieId,
    tmdbId: e.tmdbId,
    titlePattern: e.titlePattern,
    label: e.label,
  }));
}

/**
 * Sort channel lineup: franchise-matched movies first (by position), then shows, then unmatched movies by year.
 */
export function sortChannelContentByFranchise(
  items: SortableChannelItem[],
  entries: FranchiseEntryMatch[],
): SortableChannelItem[] {
  const movies = items.filter((i) => i.type === 'movie');
  const shows = items.filter((i) => i.type === 'show');

  const sortedMovies = [...movies].sort((a, b) => {
    const ai = resolveFranchisePosition(a, entries);
    const bi = resolveFranchisePosition(b, entries);
    if (ai === -1 && bi === -1) return (a.year || 0) - (b.year || 0);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const sortedShows = [...shows].sort((a, b) => a.title.localeCompare(b.title));

  return [...sortedMovies, ...sortedShows];
}

export async function previewFranchiseSortForChannel(
  channelId: string,
  franchiseSlug: string,
): Promise<{
  franchise: { slug: string; name: string } | null;
  matched: FranchiseSortPreviewItem[];
  unmatched: FranchiseSortPreviewItem[];
}> {
  const franchise = await prisma.franchise.findUnique({
    where: { slug: franchiseSlug },
    select: { slug: true, name: true },
  });
  const entries = await loadFranchiseEntries(franchiseSlug);

  const [channelMovies, channelShows] = await Promise.all([
    prisma.channelMovie.findMany({
      where: { channelId },
      include: { movie: { select: { id: true, title: true, year: true, tmdbId: true } } },
    }),
    prisma.channelShow.findMany({
      where: { channelId },
      include: { show: { select: { id: true, title: true, year: true } } },
    }),
  ]);

  const items: SortableChannelItem[] = [
    ...channelMovies.map((cm) => ({
      id: cm.id,
      type: 'movie' as const,
      title: cm.movie.title,
      year: cm.movie.year,
      movieId: cm.movie.id,
      tmdbId: cm.movie.tmdbId,
    })),
    ...channelShows.map((cs) => ({
      id: cs.id,
      type: 'show' as const,
      title: cs.show.title,
      year: cs.show.year,
    })),
  ];

  const preview: FranchiseSortPreviewItem[] = items.map((item) => {
    const pos =
      item.type === 'movie'
        ? resolveFranchisePosition(item, entries)
        : -1;
    return {
      channelItemId: item.id,
      type: item.type,
      title: item.title,
      year: item.year ?? null,
      matched: pos !== -1,
      franchisePosition: pos !== -1 ? pos : null,
    };
  });

  const matched = preview.filter((p) => p.matched);
  const unmatched = preview.filter((p) => !p.matched);

  return {
    franchise: franchise ? { slug: franchise.slug, name: franchise.name } : null,
    matched,
    unmatched,
  };
}

export async function applyFranchiseSortToChannel(
  channelId: string,
  franchiseSlug: string,
): Promise<{
  sortedCount: number;
  matchedMovieCount: number;
  unmatchedMovieCount: number;
  autoSortMethod: string;
}> {
  const entries = await loadFranchiseEntries(franchiseSlug);
  if (entries.length === 0) {
    throw new Error(`Franchise not found or has no entries: ${franchiseSlug}`);
  }

  const [channelMovies, channelShows] = await Promise.all([
    prisma.channelMovie.findMany({
      where: { channelId },
      include: { movie: true },
    }),
    prisma.channelShow.findMany({
      where: { channelId },
      include: { show: true },
    }),
  ]);

  const allContent: SortableChannelItem[] = [
    ...channelMovies.map((cm) => ({
      id: cm.id,
      type: 'movie' as const,
      title: cm.movie.title,
      year: cm.movie.year,
      duration: cm.movie.duration || 0,
      movieId: cm.movie.id,
      tmdbId: cm.movie.tmdbId,
    })),
    ...channelShows.map((cs) => ({
      id: cs.id,
      type: 'show' as const,
      title: cs.show.title,
      year: cs.show.year,
      duration: 0,
    })),
  ];

  const sorted = sortChannelContentByFranchise(allContent, entries);

  let matchedMovieCount = 0;
  let unmatchedMovieCount = 0;
  for (const item of sorted) {
    if (item.type !== 'movie') continue;
    const pos = resolveFranchisePosition(item, entries);
    if (pos === -1) unmatchedMovieCount += 1;
    else matchedMovieCount += 1;
  }

  await prisma.$transaction(
    sorted.map((item, index) => {
      if (item.type === 'movie') {
        return prisma.channelMovie.update({
          where: { id: item.id },
          data: { order: index },
        });
      }
      return prisma.channelShow.update({
        where: { id: item.id },
        data: { order: index },
      });
    }),
  );

  const autoSortMethod = franchiseSortMethodForSlug(franchiseSlug);
  await prisma.channel.update({
    where: { id: channelId },
    data: { autoSortMethod },
  });

  return {
    sortedCount: sorted.length,
    matchedMovieCount,
    unmatchedMovieCount,
    autoSortMethod,
  };
}
