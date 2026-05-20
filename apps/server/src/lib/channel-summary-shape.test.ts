import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { indexProgramsByChannel } from "./program-queries";

/** Mirrors listSummary row shape from buildChannelsListSummary */
function toSummaryRow(c: {
  id: string;
  number: number;
  name: string;
  _count: { programs: number; channelShows: number; channelMovies: number };
}) {
  return {
    id: c.id,
    number: c.number,
    name: c.name,
    programCount: c._count.programs,
    channelShowCount: c._count.channelShows,
    channelMovieCount: c._count.channelMovies,
    currentProgram: null as unknown,
    nextProgram: null as unknown,
  };
}

describe("channels.listSummary shape", () => {
  it("exposes counts without nested channelShows", () => {
    const row = toSummaryRow({
      id: "ch-1",
      number: 7,
      name: "Movies",
      _count: { programs: 10, channelShows: 3, channelMovies: 2 },
    });
    assert.equal(row.programCount, 10);
    assert.equal(row.channelShowCount, 3);
    assert.equal(row.channelMovieCount, 2);
    assert.equal(row.number, 7);
    assert.equal("channelShows" in row, false);
  });
});

describe("indexProgramsByChannel", () => {
  const base = {
    episode: null,
    movie: null,
    duration: 3600000,
    episodeId: null,
    movieId: null,
    catchupAvailable: true,
    catchupExpiry: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("keeps the latest startTime per channel when pick is max", () => {
    const programs = [
      {
        ...base,
        id: "p1",
        channelId: "ch-1",
        startTime: new Date("2026-01-01T10:00:00Z"),
      },
      {
        ...base,
        id: "p2",
        channelId: "ch-1",
        startTime: new Date("2026-01-01T11:00:00Z"),
      },
    ] as Parameters<typeof indexProgramsByChannel>[0];

    const map = indexProgramsByChannel(programs, "max");
    assert.equal(map.get("ch-1")?.id, "p2");
  });

  it("keeps the earliest startTime per channel when pick is min", () => {
    const programs = [
      {
        ...base,
        id: "p1",
        channelId: "ch-1",
        startTime: new Date("2026-01-01T12:00:00Z"),
      },
      {
        ...base,
        id: "p2",
        channelId: "ch-1",
        startTime: new Date("2026-01-01T11:00:00Z"),
      },
    ] as Parameters<typeof indexProgramsByChannel>[0];

    const map = indexProgramsByChannel(programs, "min");
    assert.equal(map.get("ch-1")?.id, "p2");
  });
});
