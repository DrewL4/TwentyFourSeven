export type UniverseKey = 'mcu' | 'star-wars';

function normalizeTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Minimal starter lists; can be extended without code changes.
const MCU_TIMELINE: string[] = [
  'captain america the first avenger (2011)',
  'captain marvel (2019)',
  'iron man (2008)',
  'iron man 2 (2010)',
  'thor (2011)',
  'the avengers (2012)',
  'iron man 3 (2013)',
  'thor the dark world (2013)',
  'captain america the winter soldier (2014)',
  'guardians of the galaxy (2014)',
  'guardians of the galaxy vol 2 (2017)',
  'avengers age of ultron (2015)',
  'ant man (2015)',
  'captain america civil war (2016)',
  'black widow (2021)',
  'black panther (2018)',
  'spider man homecoming (2017)',
  'doctor strange (2016)',
  'thor ragnarok (2017)',
  'ant man and the wasp (2018)',
  'avengers infinity war (2018)',
  'avengers endgame (2019)',
  'spider man far from home (2019)'
];

const STAR_WARS_TIMELINE: string[] = [
  'star wars episode i the phantom menace (1999)',
  'star wars episode ii attack of the clones (2002)',
  'star wars the clone wars (2008)',
  'star wars episode iii revenge of the sith (2005)',
  'solo a star wars story (2018)',
  'rogue one a star wars story (2016)',
  'star wars episode iv a new hope (1977)',
  'star wars episode v the empire strikes back (1980)',
  'star wars episode vi return of the jedi (1983)',
  'the mandalorian',
  'star wars episode vii the force awakens (2015)',
  'star wars episode viii the last jedi (2017)',
  'star wars episode ix the rise of skywalker (2019)'
];

const UNIVERSE_TO_LIST: Record<UniverseKey, string[]> = {
  'mcu': MCU_TIMELINE.map(normalizeTitle),
  'star-wars': STAR_WARS_TIMELINE.map(normalizeTitle)
};

export function getUniverseTimeline(universe: UniverseKey): string[] {
  return UNIVERSE_TO_LIST[universe];
}

export function findUniverseIndex(universe: UniverseKey, title: string, year?: number | null): number {
  const norm = normalizeTitle(`${title}${year ? ` (${year})` : ''}`);
  const list = getUniverseTimeline(universe);
  // Direct match first
  let idx = list.indexOf(norm);
  if (idx !== -1) return idx;

  // Try without year
  const normNoYear = normalizeTitle(title);
  idx = list.findIndex(item => item === normNoYear);
  if (idx !== -1) return idx;

  // Substring fallback (conservative)
  idx = list.findIndex(item => item.includes(normNoYear));
  return idx; // -1 if not found
}
