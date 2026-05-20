/** Channel row from `channels.listSummary` */
export type ChannelSummary = {
  id: string;
  number: number;
  name: string;
  icon?: string | null;
  groupTitle?: string | null;
  stealth: boolean;
  catchupEnabled: boolean;
  catchupWindowHours: number;
  programCount: number;
  channelShowCount: number;
  channelMovieCount: number;
  currentProgram?: unknown | null;
  nextProgram?: unknown | null;
};

export type ChannelLineupShow = {
  id: string;
  showId: string;
  order: number;
  weight: number;
  shuffle: boolean;
  shuffleOrder: string;
  blockShuffle: boolean;
  blockShuffleSize: number;
  respectOrder: boolean;
  show: {
    id: string;
    title: string;
    poster: string | null;
    year: number | null;
    _count: { episodes: number };
  };
};

export type ChannelLineupMovie = {
  id: string;
  movieId: string;
  order: number;
  weight: number;
  shuffle: boolean;
  movie: {
    id: string;
    title: string;
    poster: string | null;
    year: number | null;
    duration: number | null;
  };
};

/** Response from `channels.getLineup` */
export type ChannelLineup = {
  id: string;
  number: number;
  name: string;
  icon: string | null;
  stealth: boolean;
  groupTitle: string | null;
  defaultEpisodeOrder: string;
  respectEpisodeOrder: boolean;
  blockShuffle: boolean;
  blockShuffleSize: number;
  autoSortMethod: string | null;
  autoFilterEnabled: boolean;
  filterGenres: string | null;
  filterActors: string | null;
  filterDirectors: string | null;
  filterStudios: string | null;
  filterCollections: string | null;
  filterYearStart: number | null;
  filterYearEnd: number | null;
  filterRating: string | null;
  filterType: string;
  catchupEnabled: boolean;
  catchupWindowHours: number;
  channelShows: ChannelLineupShow[];
  channelMovies: ChannelLineupMovie[];
};

export type ChannelShowEpisode = {
  id: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  duration: number | null;
  thumb: string | null;
};
