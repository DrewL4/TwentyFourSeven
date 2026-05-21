/**
 * Parse Plex Guid[] agent strings into external IDs.
 * Examples:
 *   com.plexapp.agents.themoviedb://558?lang=en → tmdb 558
 *   com.plexapp.agents.imdb://tt0371746?lang=en → imdb tt0371746
 */
export function parsePlexGuids(
  guids: Array<{ id?: string } | string> | undefined | null,
): { tmdbId: number | null; imdbId: string | null } {
  let tmdbId: number | null = null;
  let imdbId: string | null = null;

  if (!guids || !Array.isArray(guids)) {
    return { tmdbId, imdbId };
  }

  for (const raw of guids) {
    const guid = typeof raw === 'string' ? raw : raw?.id;
    if (!guid || typeof guid !== 'string') continue;

    const tmdbMatch = guid.match(/themoviedb:\/\/(\d+)/i);
    if (tmdbMatch && !tmdbId) {
      tmdbId = parseInt(tmdbMatch[1], 10);
    }

    const imdbMatch = guid.match(/imdb:\/\/(tt\d+)/i);
    if (imdbMatch && !imdbId) {
      imdbId = imdbMatch[1];
    }
  }

  return { tmdbId, imdbId };
}
