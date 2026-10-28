import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFranchiseCandidates, type TmdbPort, type TmdbRow } from './franchise-candidates';
import { getStoryList, type StoryList } from './franchise-story-lists';

const row = (id: number, title: string, date: string): TmdbRow => ({ id, title, releaseDate: date, posterPath: `/p${id}.jpg` });

function port(overrides: Partial<TmdbPort> = {}): TmdbPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    collectionParts: async () => [],
    keywordMovies: async () => [],
    keywordShows: async () => [],
    searchMovies: async (t) => (calls.push(`movie:${t}`), []),
    searchShows: async (t) => (calls.push(`tv:${t}`), []),
    ...overrides,
  };
}

const small: StoryList = {
  key: 'test',
  name: 'Test',
  collectionIds: [],
  legacySlugs: [],
  items: [
    { t: 'movie', title: 'Alpha', year: 2010 },
    { t: 'season', title: 'Beta Show', year: 2012, season: 2, released: '2012-02-02' },
    { t: 'movie', title: 'Gamma Returns', year: 2014 },
  ],
};

const base = { tmdbCollectionId: 1, tmdbKeywordId: null, includeShows: false, storyList: null, addListItems: false, knownIds: new Map<string, number>() };

describe('buildFranchiseCandidates', () => {
  it('lists the collection movies with TMDB ids and no TV by default', async () => {
    const p = port({ collectionParts: async () => [row(10, 'Alpha', '2010-01-01'), row(11, 'Gamma Returns', '2014-01-01')] });
    const out = await buildFranchiseCandidates(base, p);
    assert.deepEqual(out.map((c) => [c.kind, c.tmdbId, c.entryKey]), [
      ['MOVIE', 10, 'movie:10'],
      ['MOVIE', 11, 'movie:11'],
    ]);
  });

  it('applies the story order to collection movies and skips TV when TV is off', async () => {
    const p = port({ collectionParts: async () => [row(11, 'Gamma Returns', '2014-01-01'), row(10, 'Alpha', '2010-01-01')] });
    const out = await buildFranchiseCandidates({ ...base, storyList: small, addListItems: true }, p);
    const byId = new Map(out.map((c) => [c.tmdbId, c.storyIndex]));
    assert.equal(byId.get(10), 0);
    assert.equal(byId.get(11), 2);
    assert.ok(out.every((c) => c.kind === 'MOVIE'));
  });

  it('adds show seasons from the list only when TV is on, resolving the show through TMDB search', async () => {
    const p = port({
      collectionParts: async () => [row(10, 'Alpha', '2010-01-01'), row(11, 'Gamma Returns', '2014-01-01')],
      searchShows: async () => [row(500, 'Beta Show', '2012-01-01')],
    });
    const out = await buildFranchiseCandidates({ ...base, includeShows: true, storyList: small, addListItems: true }, p);
    const season = out.find((c) => c.kind === 'SEASON')!;
    assert.equal(season.tmdbId, 500);
    assert.equal(season.seasonNumber, 2);
    assert.equal(season.entryKey, 'tv:500:s2');
    assert.equal(season.label, 'Beta Show - Season 2');
    assert.equal(season.storyIndex, 1);
  });

  it('keeps an unresolved list movie as a title-keyed candidate when TMDB cannot find it', async () => {
    const out = await buildFranchiseCandidates({ ...base, tmdbCollectionId: null, storyList: small, addListItems: true }, port());
    const alpha = out.find((c) => c.label === 'Alpha')!;
    assert.equal(alpha.tmdbId, null);
    assert.match(alpha.entryKey, /^movie:~alpha\|2010$/);
  });

  it('does not add list items that are not in TMDB data when the list is only an order', async () => {
    const out = await buildFranchiseCandidates({ ...base, storyList: small, addListItems: false }, port({ collectionParts: async () => [row(10, 'Alpha', '2010-01-01')] }));
    assert.deepEqual(out.map((c) => c.label), ['Alpha']);
  });

  it('reuses ids a franchise already resolved instead of searching again', async () => {
    const p = port();
    const out = await buildFranchiseCandidates(
      { ...base, tmdbCollectionId: null, storyList: small, addListItems: true, knownIds: new Map([['movie:alpha', 10], ['movie:gamma returns', 11]]) },
      p,
    );
    assert.equal(p.calls.filter((c) => c.startsWith('movie:')).length, 0);
    assert.deepEqual(out.map((c) => c.tmdbId).sort(), [10, 11]);
  });

  it('adds keyword shows as whole-show entries only when TV is on', async () => {
    const p = port({ keywordMovies: async () => [row(1, 'Film', '2001-01-01')], keywordShows: async () => [row(9, 'Spin-off', '2005-05-05')] });
    const off = await buildFranchiseCandidates({ ...base, tmdbCollectionId: null, tmdbKeywordId: 7 }, p);
    assert.deepEqual(off.map((c) => c.kind), ['MOVIE']);
    const on = await buildFranchiseCandidates({ ...base, tmdbCollectionId: null, tmdbKeywordId: 7, includeShows: true }, p);
    assert.deepEqual(on.map((c) => c.kind).sort(), ['MOVIE', 'SHOW']);
  });

  it('a TMDB failure while resolving a list item does not fail the build', async () => {
    const p = port({ searchMovies: async () => { throw new Error('rate limited'); } });
    const out = await buildFranchiseCandidates({ ...base, tmdbCollectionId: null, storyList: small, addListItems: true }, p);
    assert.equal(out.filter((c) => c.kind === 'MOVIE').length, 2);
  });

  it('builds the full MCU list with its tie-in shows', async () => {
    const mcu = getStoryList('mcu')!;
    const p = port({ searchMovies: async (t, y) => [row(Math.abs(hash(t)), t, `${y}-06-01`)], searchShows: async (t, y) => [row(Math.abs(hash(t)) + 1, t, `${y}-06-01`)] });
    const off = await buildFranchiseCandidates({ ...base, tmdbCollectionId: null, storyList: mcu, addListItems: true }, p);
    assert.ok(off.length > 20 && off.every((c) => c.kind === 'MOVIE'));
    const on = await buildFranchiseCandidates({ ...base, tmdbCollectionId: null, storyList: mcu, addListItems: true, includeShows: true }, p);
    assert.ok(on.some((c) => c.kind === 'SEASON' && c.label.startsWith('Loki')));
    assert.ok(on.length > off.length);
    const keys = on.map((c) => c.entryKey);
    assert.equal(new Set(keys).size, keys.length, 'entry keys are unique');
  });
});

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h || 1;
}
