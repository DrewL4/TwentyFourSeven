import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePlexGuids } from './plex-guid';

describe('parsePlexGuids', () => {
  it('extracts TMDB and IMDB ids from Plex Guid array', () => {
    const result = parsePlexGuids([
      { id: 'com.plexapp.agents.imdb://tt0371746?lang=en' },
      { id: 'com.plexapp.agents.themoviedb://1726?lang=en' },
    ]);
    assert.equal(result.tmdbId, 1726);
    assert.equal(result.imdbId, 'tt0371746');
  });
});
