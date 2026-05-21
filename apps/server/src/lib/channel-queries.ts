import { prisma } from "./prisma";
import { getCurrentAndNextProgramsPerChannel } from "./program-queries";

/** Lightweight channel list for sidebars and dashboards (no nested episode trees). */
export async function buildChannelsListSummary() {
  const now = new Date();

  const channels = await prisma.channel.findMany({
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      name: true,
      icon: true,
      groupTitle: true,
      stealth: true,
      catchupEnabled: true,
      catchupWindowHours: true,
      _count: {
        select: {
          programs: true,
          channelShows: true,
          channelMovies: true,
        },
      },
    },
  });

  if (channels.length === 0) {
    return [];
  }

  const channelIds = channels.map((c) => c.id);
  const { currentByChannel, nextByChannel } =
    await getCurrentAndNextProgramsPerChannel(channelIds, now);

  return channels.map((c) => ({
    id: c.id,
    number: c.number,
    name: c.name,
    icon: c.icon,
    groupTitle: c.groupTitle,
    stealth: c.stealth,
    catchupEnabled: c.catchupEnabled,
    catchupWindowHours: c.catchupWindowHours,
    programCount: c._count.programs,
    channelShowCount: c._count.channelShows,
    channelMovieCount: c._count.channelMovies,
    currentProgram: currentByChannel.get(c.id) ?? null,
    nextProgram: nextByChannel.get(c.id) ?? null,
  }));
}

const channelLineupScalars = {
  id: true,
  number: true,
  name: true,
  icon: true,
  stealth: true,
  groupTitle: true,
  defaultEpisodeOrder: true,
  respectEpisodeOrder: true,
  blockShuffle: true,
  blockShuffleSize: true,
  autoSortMethod: true,
  franchiseId: true,
  autoFilterEnabled: true,
  filterGenres: true,
  filterActors: true,
  filterDirectors: true,
  filterStudios: true,
  filterCollections: true,
  filterYearStart: true,
  filterYearEnd: true,
  filterRating: true,
  filterType: true,
  catchupEnabled: true,
  catchupWindowHours: true,
} as const;

/** Slim channel lineup for the Channels page (no episode trees). */
export async function getChannelLineup(channelId: string) {
  return prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      ...channelLineupScalars,
      channelShows: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          showId: true,
          order: true,
          weight: true,
          shuffle: true,
          shuffleOrder: true,
          blockShuffle: true,
          blockShuffleSize: true,
          respectOrder: true,
          show: {
            select: {
              id: true,
              title: true,
              poster: true,
              year: true,
              _count: { select: { episodes: true } },
            },
          },
        },
      },
      channelMovies: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          movieId: true,
          order: true,
          weight: true,
          shuffle: true,
          movie: {
            select: {
              id: true,
              title: true,
              poster: true,
              year: true,
              duration: true,
            },
          },
        },
      },
    },
  });
}

/** Episodes for one show on a channel (lazy load on expand). */
export async function getChannelShowEpisodes(channelId: string, showId: string) {
  const channelShow = await prisma.channelShow.findUnique({
    where: { channelId_showId: { channelId, showId } },
    select: { id: true },
  });

  if (!channelShow) {
    return [];
  }

  return prisma.mediaEpisode.findMany({
    where: { showId },
    orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
    select: {
      id: true,
      title: true,
      seasonNumber: true,
      episodeNumber: true,
      duration: true,
      thumb: true,
    },
  });
}
