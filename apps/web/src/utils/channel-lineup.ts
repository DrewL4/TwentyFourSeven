import type { ChannelLineup } from "@/types/channels";

export type LineupItem =
  | {
      type: "show";
      id: string;
      channelShowId: string;
      showId: string;
      title: string;
      poster: string | null;
      year: number | null;
      episodeCount: number;
      order: number;
    }
  | {
      type: "movie";
      id: string;
      channelMovieId: string;
      movieId: string;
      title: string;
      poster: string | null;
      year: number | null;
      duration: number | null;
      order: number;
    };

export function buildLineupItems(lineup: ChannelLineup | null | undefined): LineupItem[] {
  if (!lineup) return [];

  const shows: LineupItem[] = (lineup.channelShows ?? []).map((cs) => ({
    type: "show" as const,
    id: cs.id,
    channelShowId: cs.id,
    showId: cs.showId,
    title: cs.show.title,
    poster: cs.show.poster,
    year: cs.show.year,
    episodeCount: cs.show._count.episodes,
    order: cs.order,
  }));

  const movies: LineupItem[] = (lineup.channelMovies ?? []).map((cm) => ({
    type: "movie" as const,
    id: cm.id,
    channelMovieId: cm.id,
    movieId: cm.movieId,
    title: cm.movie.title,
    poster: cm.movie.poster,
    year: cm.movie.year,
    duration: cm.movie.duration,
    order: cm.order,
  }));

  return [...shows, ...movies].sort((a, b) => a.order - b.order);
}

export function lineupItemCount(lineup: ChannelLineup | null | undefined): number {
  if (!lineup) return 0;
  return (lineup.channelShows?.length ?? 0) + (lineup.channelMovies?.length ?? 0);
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "--:--";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}
