import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  clearReleaseInfoCache,
  loadReleaseInfo,
  needsReleaseLookup,
  parseMovieRelease,
  parseTvRelease,
  releaseInfoCacheSize,
  releaseViewFor,
  type TmdbJsonFetch,
} from './tmdb-release-info';

const rd = (iso: string, ...dates: Array<[number, string]>) => ({
  iso_3166_1: iso,
  release_dates: dates.map(([type, release_date]) => ({ type, release_date: `${release_date}T00:00:00.000Z` })),
});

describe('parseMovieRelease', () => {
  it('prefers US theatrical (3) and digital (4) dates', () => {
    const m = parseMovieRelease({
      status: 'Post Production',
      release_date: '2027-05-01',
      release_dates: { results: [rd('GB', [3, '2027-04-30'], [4, '2027-06-01']), rd('US', [1, '2027-04-01'], [3, '2027-05-01'], [3, '2027-05-02'], [4, '2027-07-10'])] },
    });
    assert.equal(m.theatrical, '2027-05-01');
    assert.equal(m.digital, '2027-07-10');
    assert.equal(m.status, 'Post Production');
  });

  it('falls back to the earliest date anywhere, and to a limited release, when the US has none', () => {
    const m = parseMovieRelease({ release_dates: { results: [rd('FR', [3, '2027-03-02']), rd('DE', [3, '2027-03-01'], [4, '2027-05-05'])] } });
    assert.equal(m.theatrical, '2027-03-01');
    assert.equal(m.digital, '2027-05-05');
    const limited = parseMovieRelease({ release_dates: { results: [rd('US', [2, '2027-02-02'])] } });
    assert.equal(limited.theatrical, '2027-02-02');
    assert.equal(limited.digital, null);
  });

  it('copes with missing or empty release data', () => {
    const m = parseMovieRelease({});
    assert.deepEqual([m.theatrical, m.digital, m.releaseDate], [null, null, null]);
  });
});

describe('parseTvRelease', () => {
  it('reads the premiere, next episode and season premieres', () => {
    const t = parseTvRelease({
      status: 'Returning Series',
      first_air_date: '2020-01-01',
      next_episode_to_air: { air_date: '2027-02-03', season_number: 3, episode_number: 1 },
      seasons: [{ season_number: 0, air_date: null }, { season_number: 3, air_date: '2027-02-03' }],
    });
    assert.equal(t.nextEpisodeAirDate, '2027-02-03');
    assert.deepEqual(t.nextEpisode, { season: 3, episode: 1 });
    assert.equal(t.seasonAirDates[3], '2027-02-03');
    assert.equal(t.seasonAirDates[0], null);
  });
});

describe('releaseViewFor', () => {
  const today = '2026-10-28';
  const movie = { kind: 'MOVIE', seasonNumber: null, releaseDate: null };
  const info = (theatrical: string | null, digital: string | null, releaseDate: string | null = theatrical, status = 'Released') =>
    ({ kind: 'movie' as const, status, theatrical, digital, releaseDate });

  it('shows both dates for a movie that is not out yet', () => {
    const v = releaseViewFor(movie, info('2026-12-18', '2027-02-10'), null, today)!;
    assert.deepEqual([v.theatrical, v.theatricalOut, v.digital, v.digitalOut], ['2026-12-18', false, '2027-02-10', false]);
  });

  it('shows a coming digital date for a movie that is already in theaters, and nothing once both are out', () => {
    const v = releaseViewFor(movie, info('2026-10-01', '2026-12-01'), null, today)!;
    assert.deepEqual([v.theatricalOut, v.digital, v.digitalOut], [true, '2026-12-01', false]);
    assert.equal(releaseViewFor(movie, info('2026-01-01', '2026-03-01'), null, today), null);
  });

  it('uses the single primary date, then WatchTower dates, when TMDB has no breakdown', () => {
    assert.equal(releaseViewFor(movie, info(null, null, '2027-06-01'), null, today)!.coming, '2027-06-01');
    assert.equal(releaseViewFor({ ...movie, releaseDate: '2027-07-01' }, null, null, today)!.coming, '2027-07-01');
    assert.equal(releaseViewFor(movie, null, { theatrical: '2027-08-01', earliest: null }, today)!.theatrical, '2027-08-01');
  });

  it('says undated for an announced title with no date at all', () => {
    assert.equal(releaseViewFor(movie, info(null, null, null, 'In Production'), null, today)!.undated, true);
    assert.equal(releaseViewFor(movie, info(null, null, null, 'Released'), null, today), null);
  });

  it('handles shows: premiere ahead, next episode, season premiere, nothing', () => {
    const tv = (over: Partial<ReturnType<typeof parseTvRelease>> = {}) => ({ ...parseTvRelease({ status: 'Returning Series', first_air_date: '2020-01-01' }), ...over });
    assert.equal(releaseViewFor({ kind: 'SHOW', seasonNumber: null, releaseDate: null }, tv({ firstAirDate: '2027-01-01' }), null, today)!.coming, '2027-01-01');
    const next = releaseViewFor({ kind: 'SHOW', seasonNumber: null, releaseDate: null }, tv({ nextEpisodeAirDate: '2026-11-05' }), null, today)!;
    assert.deepEqual([next.coming, next.nextEpisode], [null, '2026-11-05']);
    assert.equal(releaseViewFor({ kind: 'SEASON', seasonNumber: 4, releaseDate: null }, tv({ seasonAirDates: { 4: '2027-03-03' } }), null, today)!.coming, '2027-03-03');
    assert.equal(releaseViewFor({ kind: 'SEASON', seasonNumber: 1, releaseDate: null }, tv({ seasonAirDates: { 1: '2020-01-01' } }), null, today), null);
  });
});

describe('needsReleaseLookup', () => {
  it('skips old movies and missing ids, always checks shows', () => {
    const today = '2026-10-28';
    assert.equal(needsReleaseLookup({ kind: 'MOVIE', tmdbId: 1, releaseDate: '2008-05-02' }, today), false);
    assert.equal(needsReleaseLookup({ kind: 'MOVIE', tmdbId: 1, releaseDate: '2026-09-01' }, today), true);
    assert.equal(needsReleaseLookup({ kind: 'MOVIE', tmdbId: 1, releaseDate: null }, today), true);
    assert.equal(needsReleaseLookup({ kind: 'MOVIE', tmdbId: null, releaseDate: null }, today), false);
    assert.equal(needsReleaseLookup({ kind: 'SHOW', tmdbId: 1, releaseDate: '2010-01-01' }, today), true);
  });
});

describe('loadReleaseInfo', () => {
  beforeEach(() => clearReleaseInfoCache());

  it('fetches each title once, shares in-flight calls, and keeps concurrency bounded', async () => {
    let live = 0;
    let peak = 0;
    const paths: string[] = [];
    const get: TmdbJsonFetch = async <T,>(path: string) => {
      paths.push(path);
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return { status: 'Released', release_date: '2027-01-01' } as T;
    };
    const titles = Array.from({ length: 12 }, (_, i) => ({ kind: 'movie' as const, tmdbId: i + 1 }));
    const [a, b] = await Promise.all([loadReleaseInfo(titles, get, { concurrency: 3 }), loadReleaseInfo(titles, get, { concurrency: 3 })]);
    assert.equal(a.size, 12);
    assert.equal(b.size, 12);
    assert.equal(paths.length, 12);
    assert.ok(peak <= 6, `peak ${peak}`);
    assert.ok(paths[0].includes('append_to_response=release_dates'));
    await loadReleaseInfo(titles, get);
    assert.equal(paths.length, 12);
  });

  it('caps one view at maxTitles and drops titles TMDB cannot answer', async () => {
    const get: TmdbJsonFetch = async <T,>(path: string) => {
      if (path.includes('/7')) throw new Error('404');
      return { status: 'Released' } as T;
    };
    const titles = Array.from({ length: 10 }, (_, i) => ({ kind: 'movie' as const, tmdbId: i + 1 }));
    const out = await loadReleaseInfo(titles, get, { maxTitles: 8 });
    assert.equal(out.size, 7);
    assert.ok(!out.has('movie:7'));
  });

  it('keeps the cache bounded', async () => {
    const get: TmdbJsonFetch = async <T,>() => ({ status: 'Released' }) as T;
    for (let start = 0; start < 900; start += 40) {
      await loadReleaseInfo(Array.from({ length: 40 }, (_, i) => ({ kind: 'movie' as const, tmdbId: start + i + 1 })), get);
    }
    assert.ok(releaseInfoCacheSize() <= 600, `size ${releaseInfoCacheSize()}`);
  });
});
