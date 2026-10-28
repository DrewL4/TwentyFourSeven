import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findLibraryMovieForEntry,
  findPreparedMovieForEntry,
  prepareLibrary,
  prepareEntry,
  prepareMovie,
  scorePrepared,
  scoreTitleMatch,
} from './franchise-title-match';

const movies = [
  { id: 'a', title: 'Iron Man', year: 2008, tmdbId: 1726 },
  { id: 'b', title: 'Iron Man 2', year: 2010, tmdbId: 10138 },
  { id: 'c', title: 'The Avengers', year: 2012, tmdbId: 24428 },
  { id: 'd', title: 'Avengers: Age of Ultron', year: 2015, tmdbId: null },
  { id: 'e', title: "Harry Potter and the Philosopher's Stone", year: 2001, tmdbId: 671 },
  { id: 'f', title: 'Thor: The Dark World', year: 2013, tmdbId: null },
  { id: 'g', title: 'Spider-Man: Homecoming', year: 2017, tmdbId: 315635 },
];
const entries = [
  { label: 'Iron Man', tmdbId: 1726 },
  { label: 'Iron Man 2', tmdbId: null },
  { label: 'The Avengers (2012)', tmdbId: null },
  { label: 'Age of Ultron', titlePattern: 'avengers age of ultron' },
  { label: "Harry Potter and the Sorcerer's Stone", tmdbId: 671 },
  { label: 'Thor The Dark World' },
  { label: 'Spider-Man Homecoming', movieId: 'g' },
  { label: 'Something Not In The Library', tmdbId: 5 },
  { label: '' },
];

describe('prepared title matching', () => {
  it('scores exactly like scoreTitleMatch for every movie / entry pair', () => {
    for (const m of movies) {
      const pm = prepareMovie(m);
      for (const e of entries) {
        assert.equal(scorePrepared(pm, prepareEntry(e)), scoreTitleMatch(m, e), `${m.title} vs ${e.label}`);
      }
    }
  });

  it('finds the same library movie as findLibraryMovieForEntry, including when some are already used', () => {
    const lib = prepareLibrary(movies);
    for (const e of entries) {
      assert.equal(findPreparedMovieForEntry(e, lib)?.id ?? null, findLibraryMovieForEntry(e, movies)?.id ?? null, e.label);
    }
    const used = new Set(['a']);
    assert.equal(findPreparedMovieForEntry({ label: 'Iron Man' }, lib, used)?.id ?? null, findLibraryMovieForEntry({ label: 'Iron Man' }, movies, used)?.id ?? null);
  });
});
