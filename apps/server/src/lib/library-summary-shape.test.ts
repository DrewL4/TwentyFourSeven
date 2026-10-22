import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { libraryMovieListSelect, libraryShowListSelect } from "./library-queries";

/** Mirrors library.stats response */
function toStatsRow(counts: {
  showCount: number;
  movieCount: number;
  episodeCount: number;
  libraryCount: number;
  serverCount: number;
  collectionCount: number;
}) {
  return {
    showCount: counts.showCount,
    movieCount: counts.movieCount,
    episodeCount: counts.episodeCount,
    libraryCount: counts.libraryCount,
    serverCount: counts.serverCount,
    collectionCount: counts.collectionCount,
    totalVideos: counts.showCount + counts.movieCount,
  };
}

/** Mirrors servers.listForLibrary library row */
function toLibraryRow(lib: {
  id: string;
  name: string;
  type: string;
  _count: { shows: number; movies: number };
}) {
  return {
    id: lib.id,
    name: lib.name,
    type: lib.type,
    showCount: lib._count.shows,
    movieCount: lib._count.movies,
  };
}

describe("library.stats shape", () => {
  it("exposes counts without nested media rows", () => {
    const row = toStatsRow({
      showCount: 309,
      movieCount: 1093,
      episodeCount: 12000,
      libraryCount: 2,
      serverCount: 1,
      collectionCount: 47,
    });
    assert.equal(row.totalVideos, 1402);
    assert.equal(row.showCount, 309);
    assert.equal(row.episodeCount, 12000);
    assert.equal(row.collectionCount, 47);
    assert.equal("shows" in row, false);
  });
});

describe("servers.listForLibrary shape", () => {
  it("uses _count for library media totals", () => {
    const row = toLibraryRow({
      id: "lib-1",
      name: "Movies",
      type: "MOVIE",
      _count: { shows: 0, movies: 500 },
    });
    assert.equal(row.showCount, 0);
    assert.equal(row.movieCount, 500);
    assert.equal("shows" in row, false);
  });
});

describe("library list select shapes", () => {
  it("show list select includes episode count not episodes array", () => {
    assert.equal(libraryShowListSelect._count.select.episodes, true);
    assert.equal("episodes" in libraryShowListSelect, false);
    assert.equal(libraryShowListSelect.poster, true);
    assert.equal("summary" in libraryShowListSelect, false);
  });

  it("movie list select is slim", () => {
    assert.equal(libraryMovieListSelect.poster, true);
    assert.equal("summary" in libraryMovieListSelect, false);
  });

  it("movie list select includes duration so Add Content can show the length", () => {
    assert.equal(libraryMovieListSelect.duration, true);
  });
});

describe("Add Content smart-filter selects", () => {
  it("add the filter fields but no summaries or heavy relations", async () => {
    const { libraryMovieFilterSelect, libraryShowFilterSelect, buildMovieWhere } = await import("./library-queries");
    for (const select of [libraryMovieFilterSelect, libraryShowFilterSelect] as Record<string, unknown>[]) {
      for (const key of ["genres", "actors", "directors", "studio", "contentRating", "poster", "title", "year"]) {
        assert.equal(select[key], true, key);
      }
      assert.equal(select.summary, undefined);
      assert.equal(select.episodes, undefined);
    }
    // the plain browse lists stay slim
    assert.equal((libraryMovieListSelect as Record<string, unknown>).genres, undefined);
    assert.equal((libraryShowListSelect as Record<string, unknown>).actors, undefined);
    // search can match summaries on the server
    assert.deepEqual(buildMovieWhere({ search: "rabbit", searchSummary: true }).OR, [
      { title: { contains: "rabbit" } },
      { summary: { contains: "rabbit" } },
    ]);
    assert.deepEqual(buildMovieWhere({ search: "rabbit" }).title, { contains: "rabbit" });
  });
});
