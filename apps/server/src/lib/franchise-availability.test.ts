import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entryAvailability, requestItemForEntry, showTitleFromLabel } from './franchise-availability';

const base = { seasonNumber: null, episodeStart: null, episodeEnd: null, movieId: null, showId: null };
const eps = [1, 2, 3].map((n) => ({ seasonNumber: 1, episodeNumber: n }));

describe('entryAvailability', () => {
  it('movies are available when linked to a library movie', () => {
    assert.equal(entryAvailability({ ...base, kind: 'MOVIE', movieId: 'm' }, undefined).available, true);
    assert.equal(entryAvailability({ ...base, kind: 'MOVIE' }, undefined).available, false);
  });
  it('seasons need at least one episode, ranges need all of them', () => {
    const season = { ...base, kind: 'SEASON', showId: 's', seasonNumber: 1 };
    assert.equal(entryAvailability(season, eps).available, true);
    assert.equal(entryAvailability({ ...season, seasonNumber: 2 }, eps).available, false);
    const range = { ...base, kind: 'EPISODES', showId: 's', seasonNumber: 1, episodeStart: 1, episodeEnd: 5 };
    assert.deepEqual(entryAvailability(range, eps), { available: false, have: 3, want: 5 });
    assert.equal(entryAvailability({ ...range, episodeEnd: 3 }, eps).available, true);
  });
  it('a show that is not in the library is missing', () => {
    assert.equal(entryAvailability({ ...base, kind: 'SHOW' }, undefined).available, false);
  });
});

describe('requestItemForEntry', () => {
  const e = { kind: 'MOVIE', label: 'Thor', tmdbId: 10195, seasonNumber: null, posterPath: '/t.jpg' };
  it('maps movies and shows', () => {
    assert.deepEqual(requestItemForEntry(e), { title: 'Thor', mediaType: 'movie', tmdbId: 10195, posterPath: '/t.jpg' });
    assert.equal(requestItemForEntry({ ...e, kind: 'SHOW', label: 'Loki', tmdbId: 84958 })?.mediaType, 'tv');
  });
  it('requests a season, or the season that holds an episode range', () => {
    const season = requestItemForEntry({ ...e, kind: 'SEASON', label: 'Loki - Season 2', tmdbId: 84958, seasonNumber: 2 });
    assert.deepEqual(season, { title: 'Loki', mediaType: 'season', tmdbId: 84958, seasonNumber: 2, posterPath: '/t.jpg' });
    const range = requestItemForEntry({ ...e, kind: 'EPISODES', label: 'Loki - S1 E1-3', tmdbId: 84958, seasonNumber: 1 });
    assert.equal(range?.title, 'Loki');
    assert.equal(range?.seasonNumber, 1);
  });
  it('returns null when TMDB has not been resolved', () => {
    assert.equal(requestItemForEntry({ ...e, tmdbId: null }), null);
    assert.equal(requestItemForEntry({ ...e, kind: 'SEASON', seasonNumber: null }), null);
  });
  it('extracts a show title from labels', () => {
    assert.equal(showTitleFromLabel('Agents of S.H.I.E.L.D. - Season 3'), 'Agents of S.H.I.E.L.D.');
    assert.equal(showTitleFromLabel('Daredevil - S1 E1-13'), 'Daredevil');
    assert.equal(showTitleFromLabel('Plain'), 'Plain');
  });
});
