/** Names and NFO files → titles, years and episode numbers. No network. */

export const VIDEO_EXTENSIONS = new Set([
  ".mkv", ".mp4", ".m4v", ".mov", ".avi", ".ts", ".m2ts", ".mts", ".wmv", ".webm", ".mpg", ".mpeg", ".flv", ".ogv",
]);
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const SKIP_DIRS = /^(extras?|trailers?|samples?|featurettes?|behind the scenes|deleted scenes|interviews|scenes|shorts|other|\.[^/]*|@eadir|#recycle|\$recycle\.bin|lost\+found)$/i;

export function isSkippedDir(name: string): boolean {
  return SKIP_DIRS.test(name.trim());
}

export function isSampleFile(name: string): boolean {
  return /(^|[ ._-])(sample|trailer)([ ._-]|$)/i.test(name.replace(/\.[^.]+$/, ""));
}

function clean(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Big Buck Bunny (2008)" / "Big.Buck.Bunny.2008.1080p" → title + year. */
export function parseMovieName(name: string): { title: string; year: number | null } {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, "");
  const paren = base.match(/^(.*?)[\s._-]*\((\d{4})\)/);
  if (paren && paren[1].trim()) {
    return { title: clean(paren[1]), year: Number(paren[2]) };
  }
  const dotted = base.match(/^(.*?)[\s._-]+((?:19|20)\d{2})(?:[\s._-]|$)/);
  if (dotted && dotted[1].trim()) {
    return { title: clean(dotted[1]), year: Number(dotted[2]) };
  }
  return { title: clean(base.replace(/[\s._-]+(1080p|720p|2160p|4k|bluray|web-?dl|hdtv|x26[45]|hevc).*$/i, "")), year: null };
}

/** "S01E02", "1x02", "Season 1/02 - Title" → season/episode + leftover title. */
export function parseEpisodeName(
  fileName: string,
  seasonDir?: string | null,
): { season: number; episode: number; title: string | null } | null {
  const base = fileName.replace(/\.[a-z0-9]{2,4}$/i, "");
  let m = base.match(/[Ss](\d{1,3})[ ._-]?[Ee](\d{1,4})(?:[-Ee]+\d{1,4})*(.*)$/);
  if (!m) m = base.match(/(?:^|[ ._-])(\d{1,2})x(\d{1,3})(.*)$/);
  if (m) {
    const rest = clean(m[3].replace(/^[\s._-]+/, ""));
    return { season: Number(m[1]), episode: Number(m[2]), title: rest || null };
  }
  const seasonMatch = seasonDir?.match(/^(?:season|series|s)[\s._-]*(\d{1,3})$/i);
  const ep = base.match(/^(?:e|ep|episode)?[\s._-]*(\d{1,3})(?:[\s._-]+(.*))?$/i);
  if (seasonMatch && ep) {
    return { season: Number(seasonMatch[1]), episode: Number(ep[1]), title: ep[2] ? clean(ep[2]) : null };
  }
  return null;
}

export function isSeasonDir(name: string): boolean {
  return /^(season|series|s)[\s._-]*\d{1,3}$/i.test(name.trim()) || /^specials$/i.test(name.trim());
}

export type NfoInfo = {
  title?: string;
  year?: number;
  plot?: string;
  studio?: string;
  mpaa?: string;
  genres: string[];
  actors: string[];
  directors: string[];
  season?: number;
  episode?: number;
  tmdbId?: number;
  imdbId?: string;
};

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  const v = m ? decodeXml(m[1]) : "";
  return v || undefined;
}

function tags(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const v = decodeXml(m[1]);
    if (v && !v.includes("<")) out.push(v);
  }
  return out;
}

/** Kodi-style movie.nfo / tvshow.nfo / episode .nfo (the format Radarr, Sonarr and ESPG write). */
export function parseNfo(xml: string): NfoInfo {
  const text = xml.slice(0, 256 * 1024);
  const actorBlocks = text.match(/<actor>[\s\S]*?<\/actor>/gi) || [];
  const year = Number(tag(text, "year") || (tag(text, "premiered") || "").slice(0, 4));
  const tmdb = Number(tag(text, "tmdbid") || text.match(/<uniqueid[^>]*type="tmdb"[^>]*>(\d+)</i)?.[1]);
  const imdb = tag(text, "imdbid") || text.match(/<uniqueid[^>]*type="imdb"[^>]*>(tt\d+)</i)?.[1];
  const season = Number(tag(text, "season"));
  const episode = Number(tag(text, "episode"));
  return {
    title: tag(text, "title"),
    year: Number.isFinite(year) && year > 1800 ? year : undefined,
    plot: tag(text, "plot") || tag(text, "outline"),
    studio: tag(text, "studio"),
    mpaa: tag(text, "mpaa"),
    genres: tags(text, "genre"),
    actors: actorBlocks.map((b) => tag(b, "name")).filter((v): v is string => !!v),
    directors: tags(text, "director"),
    season: Number.isFinite(season) && tag(text, "season") ? season : undefined,
    episode: Number.isFinite(episode) && tag(text, "episode") ? episode : undefined,
    tmdbId: Number.isFinite(tmdb) && tmdb > 0 ? tmdb : undefined,
    imdbId: imdb && /^tt\d+$/.test(imdb) ? imdb : undefined,
  };
}

/** Pick poster / backdrop images among a folder's files (names only). */
export function pickArtwork(
  files: string[],
  videoBase?: string,
): { poster?: string; backdrop?: string } {
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  const find = (names: string[]) => {
    for (const n of names) {
      for (const ext of IMAGE_EXTENSIONS) {
        const hit = lower.get(`${n}${ext}`.toLowerCase());
        if (hit) return hit;
      }
    }
    return undefined;
  };
  const vb = videoBase ? [`${videoBase}-poster`, `${videoBase}`] : [];
  return {
    poster: find([...vb, "poster", "folder", "cover", "movie", "show"]),
    backdrop: find([...(videoBase ? [`${videoBase}-fanart`] : []), "fanart", "backdrop", "background", "art"]),
  };
}
