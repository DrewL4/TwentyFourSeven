import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLineupItems } from "./channel-lineup";
import type { ChannelLineup } from "../types/channels";

describe("buildLineupItems", () => {
  it("merges shows and movies sorted by order", () => {
    const lineup: ChannelLineup = {
      id: "ch-1",
      number: 1,
      name: "Test",
      icon: null,
      stealth: false,
      groupTitle: null,
      defaultEpisodeOrder: "sequential",
      respectEpisodeOrder: true,
      blockShuffle: false,
      blockShuffleSize: 1,
      autoSortMethod: null,
      autoFilterEnabled: false,
      filterGenres: null,
      filterActors: null,
      filterDirectors: null,
      filterStudios: null,
      filterCollections: null,
      filterYearStart: null,
      filterYearEnd: null,
      filterRating: null,
      filterType: "both",
      catchupEnabled: true,
      catchupWindowHours: 24,
      channelShows: [
        {
          id: "cs-2",
          showId: "show-b",
          order: 2,
          weight: 1,
          shuffle: false,
          shuffleOrder: "next",
          blockShuffle: false,
          blockShuffleSize: 1,
          respectOrder: true,
          show: {
            id: "show-b",
            title: "B Show",
            poster: null,
            year: 2020,
            _count: { episodes: 5 },
          },
        },
      ],
      channelMovies: [
        {
          id: "cm-1",
          movieId: "movie-a",
          order: 1,
          weight: 1,
          shuffle: false,
          movie: {
            id: "movie-a",
            title: "A Movie",
            poster: null,
            year: 2019,
            duration: 7200000,
          },
        },
      ],
    };

    const items = buildLineupItems(lineup);
    assert.equal(items.length, 2);
    assert.equal(items[0].type, "movie");
    assert.equal(items[1].type, "show");
  });
});
