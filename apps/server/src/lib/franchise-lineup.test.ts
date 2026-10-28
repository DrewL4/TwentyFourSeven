import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFranchiseLineup, episodesForEntry } from './franchise-lineup';

const ep = (s: number, e: number) => ({ seasonNumber: s, episodeNumber: e, duration: 1800 });
const episodes = [ep(0, 1), ep(1, 2), ep(1, 1), ep(2, 1), ep(2, 2)];
const show = { title: 'Loki', episodes };
const none = { seasonNumber: null, episodeStart: null, episodeEnd: null };

describe('episodesForEntry', () => {
  it('returns a season in order', () => {
    const got = episodesForEntry(episodes, { kind: 'SEASON', seasonNumber: 1, episodeStart: null, episodeEnd: null });
    assert.deepEqual(got.map((e) => e.episodeNumber), [1, 2]);
  });
  it('returns an episode range', () => {
    const got = episodesForEntry(episodes, { kind: 'EPISODES', seasonNumber: 2, episodeStart: 2, episodeEnd: 5 });
    assert.deepEqual(got.map((e) => `${e.seasonNumber}x${e.episodeNumber}`), ['2x2']);
  });
  it('returns a whole show without specials', () => {
    const got = episodesForEntry(episodes, { kind: 'SHOW', ...none });
    assert.deepEqual(got.map((e) => `${e.seasonNumber}x${e.episodeNumber}`), ['1x1', '1x2', '2x1', '2x2']);
  });
});

describe('buildFranchiseLineup', () => {
  const movieA = { id: 'a', duration: 7200 };
  const movieB = { id: 'b', duration: 6000 };

  it('puts episodes between movies in entry order', () => {
    const lineup = buildFranchiseLineup([
      { kind: 'MOVIE', movie: movieA, show: null, ...none },
      { kind: 'SEASON', movie: null, show, seasonNumber: 1, episodeStart: null, episodeEnd: null },
      { kind: 'MOVIE', movie: movieB, show: null, ...none },
    ])!;
    assert.deepEqual(lineup.map((i) => i.type), ['movie', 'episode', 'episode', 'movie']);
    const first = lineup[1];
    assert.equal(first.type === 'episode' && first.showTitle, 'Loki');
    assert.equal(lineup[0].duration, 7200);
  });

  it('skips entries that are not in the library', () => {
    const lineup = buildFranchiseLineup([
      { kind: 'MOVIE', movie: null, show: null, ...none },
      { kind: 'SHOW', movie: null, show: null, ...none },
      { kind: 'MOVIE', movie: movieB, show: null, ...none },
      { kind: 'SEASON', movie: null, show, seasonNumber: 2, episodeStart: null, episodeEnd: null },
    ])!;
    assert.deepEqual(lineup.map((i) => i.type), ['movie', 'episode', 'episode']);
  });

  it('returns null for a movie-only franchise so the normal movie scheduling is untouched', () => {
    assert.equal(buildFranchiseLineup([{ kind: 'MOVIE', movie: movieA, show: null, ...none }]), null);
    assert.equal(buildFranchiseLineup([]), null);
  });
});
