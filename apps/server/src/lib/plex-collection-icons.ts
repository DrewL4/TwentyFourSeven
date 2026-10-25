/**
 * Collection artwork lookup for a playlist build.
 *
 * Each Plex library's collection list is fetched at most once per resolver and shared
 * by every channel, so building the playlist costs one request per library instead of
 * one per library per channel.
 */
export type PlexLibraryRef = { url: string; token: string; key: string };
type Directory = { title?: string; thumb?: string };

export function createCollectionIconResolver(opts: {
  listLibraries: () => Promise<PlexLibraryRef[]>;
  /** Turn a collection thumb into the link to emit; null keeps looking. */
  toLink: (thumb: string, serverUrl: string) => string | null;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let libraries: Promise<PlexLibraryRef[]> | null = null;
  const collections = new Map<string, Promise<Directory[] | null>>();

  const libraryCollections = (lib: PlexLibraryRef) => {
    const cacheKey = `${lib.url}\u0000${lib.key}`;
    let pending = collections.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        try {
          const res = await fetchImpl(`${lib.url}/library/sections/${lib.key}/collections`, {
            headers: { Accept: 'application/json', 'X-Plex-Token': lib.token },
          });
          if (!res.ok) return null;
          const data = await res.json();
          return data?.MediaContainer?.Directory || [];
        } catch {
          return null;
        }
      })();
      collections.set(cacheKey, pending);
    }
    return pending;
  };

  return async (collectionNames: string[]): Promise<string | null> => {
    if (!collectionNames || collectionNames.length === 0) return null;
    try {
      libraries ??= opts.listLibraries();
      for (const lib of await libraries) {
        for (const d of (await libraryCollections(lib)) || []) {
          if (d.title && collectionNames.includes(d.title) && d.thumb) {
            let link: string | null = null;
            try {
              link = opts.toLink(d.thumb, lib.url);
            } catch {}
            if (link) return link;
          }
        }
      }
    } catch {}
    return null;
  };
}
