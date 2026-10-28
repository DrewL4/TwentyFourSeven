import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MCU_STORY_LIST,
  STORY_LISTS,
  findStoryListForSource,
  getStoryList,
  titleMatchesStoryItem,
  type StoryItem,
} from './franchise-story-lists';

const movie = (title: string, year: number): StoryItem => ({ t: 'movie', title, year });

describe('story lists', () => {
  it('have unique keys and no repeated steps', () => {
    assert.equal(new Set(STORY_LISTS.map((l) => l.key)).size, STORY_LISTS.length);
    for (const list of STORY_LISTS) {
      const seen = new Set<string>();
      for (const item of list.items) {
        const key = `${item.t}|${item.title}|${'season' in item ? item.season : ''}|${'from' in item ? item.from : ''}`;
        assert.ok(!seen.has(key), `${list.key} repeats ${key}`);
        seen.add(key);
        assert.ok(item.year >= 1960 && item.year <= 2030, `${list.key}: ${item.title} has year ${item.year}`);
      }
    }
  });

  it('cover what was asked for: MCU with tie-in shows, Middle-earth, Star Wars', () => {
    assert.ok(getStoryList('mcu')!.items.some((i) => i.t === 'season' && i.title === 'Loki'));
    assert.ok(getStoryList('mcu')!.items.some((i) => i.t === 'movie' && i.title === 'Avengers: Endgame'));
    assert.ok(getStoryList('middle-earth')!.items.some((i) => i.title === 'The Hobbit: An Unexpected Journey'));
    assert.ok(getStoryList('middle-earth')!.items.some((i) => i.title === 'The Lord of the Rings: The Return of the King'));
    assert.ok(getStoryList('star-wars')!.items.some((i) => i.t === 'tv' && i.title === 'Star Wars: The Clone Wars'));
  });

  it('start the MCU where the story starts', () => {
    assert.equal(MCU_STORY_LIST.items[0].title, 'Captain America: The First Avenger');
  });

  it('map older built-in franchises and collections to a list', () => {
    assert.equal(findStoryListForSource({ slug: 'mcu-chronological' })?.key, 'mcu');
    assert.equal(findStoryListForSource({ slug: 'star-wars-saga' })?.key, 'star-wars');
    assert.equal(findStoryListForSource({ tmdbCollectionId: 119 })?.key, 'middle-earth');
    assert.equal(findStoryListForSource({ slug: 'my-own' }), null);
  });

  it('match TMDB titles that differ only by Episode labels or the 1977 film name', () => {
    const lastJedi = movie('Star Wars: Episode VIII - The Last Jedi', 2017);
    assert.ok(titleMatchesStoryItem('Star Wars: The Last Jedi', 2017, lastJedi));
    const newHope = movie('Star Wars: Episode IV - A New Hope', 1977);
    assert.ok(titleMatchesStoryItem('Star Wars', 1977, newHope));
    assert.ok(!titleMatchesStoryItem('Star Wars', 2015, newHope));
  });

  it('does not confuse a film with its sequel', () => {
    const ironMan = movie('Iron Man', 2008);
    assert.ok(!titleMatchesStoryItem('Iron Man 2', 2010, ironMan));
    assert.ok(titleMatchesStoryItem('Iron Man', 2008, ironMan));
    assert.ok(!titleMatchesStoryItem('Thor: The Dark World', 2013, movie('Thor', 2011)));
  });
});
