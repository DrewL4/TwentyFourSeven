import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dedupeLibraryRows } from './library-dedupe';

describe('dedupeLibraryRows', () => {
  it('keeps one row per title and year, preferring a TMDB id', () => {
    const rows = [
      { id: 'a', title: 'Cosmos Laundromat', year: 2015, tmdbId: null, poster: '/p' },
      { id: 'b', title: 'Cosmos Laundromat', year: 2015, tmdbId: 358332, poster: null },
      { id: 'c', title: 'Elephants Dream', year: 2006, tmdbId: null, poster: null },
    ];
    const out = dedupeLibraryRows(rows);
    assert.deepEqual(out.map((r) => r.id), ['b', 'c']);
  });
  it('keeps remakes with different years', () => {
    const out = dedupeLibraryRows([
      { title: 'Total Recall', year: 1990 },
      { title: 'Total Recall', year: 2012 },
    ]);
    assert.equal(out.length, 2);
  });
  it('ignores case and punctuation in titles; with equal scores keeps the first', () => {
    const out = dedupeLibraryRows([
      { id: 1, title: 'The General', year: 1926 },
      { id: 2, title: 'the general', year: 1926 },
    ]);
    assert.deepEqual(out.map((r) => r.id), [1]);
  });
});
