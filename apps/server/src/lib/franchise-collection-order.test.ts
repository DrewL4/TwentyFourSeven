import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferStoryEpisodeOrder, sortCollectionPartsForWatchOrder } from './franchise-collection-order';

describe('inferStoryEpisodeOrder', () => {
  it('orders Star Wars saga by episode not release year', () => {
    assert.equal(inferStoryEpisodeOrder('Star Wars', '1977-05-25'), 40);
    assert.equal(
      inferStoryEpisodeOrder('Star Wars: Episode I - The Phantom Menace', '1999-05-19'),
      10,
    );
    assert.equal(inferStoryEpisodeOrder('Star Wars: The Force Awakens', '2015-12-18'), 70);
    assert.equal(inferStoryEpisodeOrder('Rogue One: A Star Wars Story'), 35);
  });
});

describe('sortCollectionPartsForWatchOrder', () => {
  it('sorts chronologically for story watch order', () => {
    const parts = [
      { id: 1, title: 'Star Wars', release_date: '1977-05-25' },
      { id: 2, title: 'Star Wars: Episode I - The Phantom Menace', release_date: '1999-05-19' },
      { id: 3, title: 'The Empire Strikes Back', release_date: '1980-05-21' },
    ];
    const sorted = sortCollectionPartsForWatchOrder(parts, 'CHRONOLOGICAL');
    assert.equal(sorted[0].title.includes('Phantom Menace'), true);
    assert.equal(sorted[1].title, 'Star Wars');
    assert.equal(sorted[2].title, 'The Empire Strikes Back');
  });
});

