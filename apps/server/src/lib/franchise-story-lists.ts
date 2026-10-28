import { normalizeTitle } from './title-normalize';

/**
 * Hand-written story orders, authored for this app (not copied from any third-party list).
 * Each item is one step in the story. Movies are always part of a franchise that uses the list.
 * TV items (a whole show, one season, or an episode range) only appear when the franchise has
 * "Include TV shows" turned on. TMDB ids are looked up by title and year when the franchise is
 * synced, so nothing here depends on a number that could be wrong.
 *
 * Edit freely: a hand edit on a franchise survives later syncs.
 */

export type StoryItem =
  | { t: 'movie'; title: string; year: number }
  | { t: 'tv'; title: string; year: number; released: string }
  | { t: 'season'; title: string; year: number; season: number; released: string }
  | { t: 'eps'; title: string; year: number; season: number; from: number; to: number; released: string };

export type StoryList = {
  key: string;
  name: string;
  /** TMDB collection ids whose movies use this list as their story order. */
  collectionIds: number[];
  /** Slugs seeded by older versions of the app, mapped to this list. */
  legacySlugs: string[];
  items: StoryItem[];
};

const m = (title: string, year: number): StoryItem => ({ t: 'movie', title, year });
const tv = (title: string, year: number, released: string): StoryItem => ({ t: 'tv', title, year, released });
const season = (title: string, year: number, s: number, released: string): StoryItem => ({
  t: 'season', title, year, season: s, released,
});

export const MCU_STORY_LIST: StoryList = {
  key: 'mcu',
  name: 'Marvel Cinematic Universe (story order, with tie-in shows)',
  collectionIds: [86311],
  legacySlugs: ['mcu-chronological', 'mcu', 'marvel-cinematic-universe'],
  items: [
    m('Captain America: The First Avenger', 2011),
    season('Agent Carter', 2015, 1, '2015-01-06'),
    season('Agent Carter', 2015, 2, '2016-01-19'),
    m('Captain Marvel', 2019),
    m('Iron Man', 2008),
    m('Iron Man 2', 2010),
    m('The Incredible Hulk', 2008),
    m('Thor', 2011),
    m('The Avengers', 2012),
    m('Thor: The Dark World', 2013),
    m('Iron Man 3', 2013),
    m('Captain America: The Winter Soldier', 2014),
    m('Guardians of the Galaxy', 2014),
    m('Guardians of the Galaxy Vol. 2', 2017),
    m('Avengers: Age of Ultron', 2015),
    m('Ant-Man', 2015),
    m('Captain America: Civil War', 2016),
    m('Black Widow', 2021),
    m('Black Panther', 2018),
    m('Spider-Man: Homecoming', 2017),
    m('Doctor Strange', 2016),
    m('Thor: Ragnarok', 2017),
    m('Ant-Man and the Wasp', 2018),
    m('Avengers: Infinity War', 2018),
    m('Avengers: Endgame', 2019),
    season('Loki', 2021, 1, '2021-06-09'),
    season('What If...?', 2021, 1, '2021-08-11'),
    tv('WandaVision', 2021, '2021-01-15'),
    tv('The Falcon and the Winter Soldier', 2021, '2021-03-19'),
    m('Spider-Man: Far From Home', 2019),
    m('Shang-Chi and the Legend of the Ten Rings', 2021),
    m('Eternals', 2021),
    tv('Hawkeye', 2021, '2021-11-24'),
    m('Spider-Man: No Way Home', 2021),
    tv('Moon Knight', 2022, '2022-03-30'),
    m('Doctor Strange in the Multiverse of Madness', 2022),
    tv('Ms. Marvel', 2022, '2022-06-08'),
    m('Thor: Love and Thunder', 2022),
    tv('She-Hulk: Attorney at Law', 2022, '2022-08-18'),
    m('Werewolf by Night', 2022),
    m('Black Panther: Wakanda Forever', 2022),
    m('The Guardians of the Galaxy Holiday Special', 2022),
    m('Guardians of the Galaxy Vol. 3', 2023),
    tv('Secret Invasion', 2023, '2023-06-21'),
    season('Loki', 2021, 2, '2023-10-05'),
    m('Ant-Man and the Wasp: Quantumania', 2023),
    m('The Marvels', 2023),
    tv('Echo', 2024, '2024-01-09'),
    m('Deadpool & Wolverine', 2024),
    tv('Agatha All Along', 2024, '2024-09-18'),
    m('Captain America: Brave New World', 2025),
    m('Thunderbolts*', 2025),
    season('Daredevil: Born Again', 2025, 1, '2025-03-04'),
    tv('Ironheart', 2025, '2025-06-24'),
    m('The Fantastic Four: First Steps', 2025),
  ],
};

export const MIDDLE_EARTH_STORY_LIST: StoryList = {
  key: 'middle-earth',
  name: 'Middle-earth (The Hobbit and The Lord of the Rings)',
  collectionIds: [119, 121938],
  legacySlugs: ['middle-earth', 'lord-of-the-rings', 'lotr'],
  items: [
    tv('The Lord of the Rings: The Rings of Power', 2022, '2022-09-01'),
    m('The Lord of the Rings: The War of the Rohirrim', 2024),
    m('The Hobbit: An Unexpected Journey', 2012),
    m('The Hobbit: The Desolation of Smaug', 2013),
    m('The Hobbit: The Battle of the Five Armies', 2014),
    m('The Lord of the Rings: The Fellowship of the Ring', 2001),
    m('The Lord of the Rings: The Two Towers', 2002),
    m('The Lord of the Rings: The Return of the King', 2003),
  ],
};

export const STAR_WARS_STORY_LIST: StoryList = {
  key: 'star-wars',
  name: 'Star Wars (story order)',
  collectionIds: [10],
  legacySlugs: ['star-wars-saga', 'star-wars'],
  items: [
    m('Star Wars: Episode I - The Phantom Menace', 1999),
    m('Star Wars: Episode II - Attack of the Clones', 2002),
    tv('Star Wars: The Clone Wars', 2008, '2008-10-03'),
    m('Star Wars: Episode III - Revenge of the Sith', 2005),
    tv('Star Wars: The Bad Batch', 2021, '2021-05-04'),
    m('Solo: A Star Wars Story', 2018),
    tv('Obi-Wan Kenobi', 2022, '2022-05-27'),
    tv('Star Wars Rebels', 2014, '2014-10-03'),
    season('Andor', 2022, 1, '2022-09-21'),
    season('Andor', 2022, 2, '2025-04-22'),
    m('Rogue One: A Star Wars Story', 2016),
    m('Star Wars: Episode IV - A New Hope', 1977),
    m('Star Wars: Episode V - The Empire Strikes Back', 1980),
    m('Star Wars: Episode VI - Return of the Jedi', 1983),
    season('The Mandalorian', 2019, 1, '2019-11-12'),
    season('The Mandalorian', 2019, 2, '2020-10-30'),
    tv('The Book of Boba Fett', 2021, '2021-12-29'),
    season('The Mandalorian', 2019, 3, '2023-03-01'),
    tv('Ahsoka', 2023, '2023-08-23'),
    m('Star Wars: Episode VII - The Force Awakens', 2015),
    m('Star Wars: Episode VIII - The Last Jedi', 2017),
    m('Star Wars: Episode IX - The Rise of Skywalker', 2019),
    tv('Star Wars: Skeleton Crew', 2024, '2024-12-02'),
  ],
};

export const STORY_LISTS: StoryList[] = [MCU_STORY_LIST, MIDDLE_EARTH_STORY_LIST, STAR_WARS_STORY_LIST];

export function getStoryList(key: string | null | undefined): StoryList | null {
  if (!key) return null;
  return STORY_LISTS.find((l) => l.key === key) ?? null;
}

/** The list to borrow a story order from for a franchise that was not given one explicitly. */
export function findStoryListForSource(src: {
  slug?: string | null;
  tmdbCollectionId?: number | null;
}): StoryList | null {
  if (src.tmdbCollectionId != null) {
    const byCollection = STORY_LISTS.find((l) => l.collectionIds.includes(src.tmdbCollectionId!));
    if (byCollection) return byCollection;
  }
  if (src.slug) {
    const bySlug = STORY_LISTS.find((l) => l.legacySlugs.includes(src.slug!));
    if (bySlug) return bySlug;
  }
  return null;
}

/** Plain title and year of a story item, for matching against TMDB or library rows. */
export function storyItemTitleKey(item: StoryItem): string {
  return `${normalizeTitle(item.title)}|${item.year}`;
}

function looseTitle(title: string): string {
  return normalizeTitle(title).replace(/\bepisode (?:[ivx]+|\d+)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Does this title (with optional release year) belong to this story item?
 * Same words (ignoring "Episode IV" style labels), or one name inside the other when the year
 * is known and within one year (TMDB calls the 1977 film just "Star Wars").
 */
export function titleMatchesStoryItem(title: string, year: number | null | undefined, item: StoryItem): boolean {
  const a = looseTitle(title);
  const b = looseTitle(item.title);
  if (!a || !b) return false;
  const yearOk = year == null || Math.abs(year - item.year) <= 1;
  if (a === b) return yearOk;
  if (year == null || !yearOk) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 9 && long.includes(short);
}
