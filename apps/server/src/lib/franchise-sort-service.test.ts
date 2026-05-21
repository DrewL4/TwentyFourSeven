import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseFranchiseSlugFromSortMethod,
  resolveFranchisePosition,
  sortChannelContentByFranchise,
} from './franchise-sort-service';

describe('franchise-sort-service', () => {
  it('parses timeline slug and legacy aliases', () => {
    assert.equal(
      parseFranchiseSlugFromSortMethod('timeline:mcu-chronological'),
      'mcu-chronological',
    );
    assert.equal(parseFranchiseSlugFromSortMethod('timeline-mcu'), 'mcu-chronological'); // legacy alias
    assert.equal(parseFranchiseSlugFromSortMethod('sort-title-asc'), null);
  });

  it('sorts movies by franchise position', () => {
    const entries = [
      { position: 0, movieId: null, tmdbId: null, titlePattern: 'iron man (2008)' },
      { position: 1, movieId: null, tmdbId: null, titlePattern: 'thor (2011)' },
    ];
    const items = [
      { id: 'a', type: 'movie' as const, title: 'Thor', year: 2011 },
      { id: 'b', type: 'movie' as const, title: 'Iron Man', year: 2008 },
    ];
    const sorted = sortChannelContentByFranchise(items, entries);
    assert.equal(sorted[0].title, 'Iron Man');
    assert.equal(sorted[1].title, 'Thor');
  });

  it('matches by tmdbId when available', () => {
    const entries = [
      { position: 0, movieId: null, tmdbId: 1726, titlePattern: null },
      { position: 1, movieId: null, tmdbId: 10195, titlePattern: null },
    ];
    assert.equal(
      resolveFranchisePosition(
        { movieId: 'x', tmdbId: 10195, title: 'Thor', year: 2011 },
        entries,
      ),
      1,
    );
  });
});
