import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSupplementsForCollection,
  mergeStorySupplements,
} from './franchise-story-supplements';

describe('mergeStorySupplements', () => {
  it('inserts Rogue One and Solo between Episode III and IV', () => {
    const ordered = [
      {
        position: 0,
        label: 'Star Wars: Episode III - Revenge of the Sith',
        tmdbId: 1895,
        titlePattern: 'star wars episode iii revenge of the sith',
        releaseDateMs: Date.parse('2005-05-19'),
      },
      {
        position: 1,
        label: 'Star Wars',
        tmdbId: 11,
        titlePattern: 'star wars',
        releaseDateMs: Date.parse('1977-05-25'),
      },
    ];
    const merged = mergeStorySupplements(ordered, getSupplementsForCollection(10), 'CHRONOLOGICAL');
    assert.equal(merged.length, 4);
    assert.equal(merged[1].label.includes('Rogue One'), true);
    assert.equal(merged[2].label.includes('Solo'), true);
    assert.equal(merged[3].label, 'Star Wars');
  });
});
