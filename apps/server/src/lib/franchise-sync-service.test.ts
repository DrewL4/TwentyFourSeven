import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeCollectionOrphans } from './franchise-sync-service';

describe('mergeCollectionOrphans', () => {
  it('inserts unknown collection movies by release date', () => {
    const ordered = [
      {
        position: 0,
        label: 'Iron Man (2008)',
        tmdbId: 1726,
        titlePattern: 'iron man 2008',
        releaseDateMs: Date.parse('2008-05-02'),
      },
      {
        position: 1,
        label: 'The Avengers (2012)',
        tmdbId: 24428,
        titlePattern: 'the avengers 2012',
        releaseDateMs: Date.parse('2012-05-04'),
      },
    ];

    const merged = mergeCollectionOrphans(ordered, [
      { id: 1726, title: 'Iron Man', release_date: '2008-05-02' },
      { id: 99999, title: 'New Marvel Film', release_date: '2010-05-01' },
      { id: 24428, title: 'The Avengers', release_date: '2012-05-04' },
    ]);

    assert.equal(merged.length, 3);
    assert.equal(merged[0].tmdbId, 1726);
    assert.equal(merged[1].tmdbId, 99999);
    assert.equal(merged[2].tmdbId, 24428);
  });
});
