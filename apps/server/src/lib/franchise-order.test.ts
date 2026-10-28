import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entryKeyFor, entryLabelFor, mergeFranchiseOrder, orderEntries } from './franchise-order';

type E = { name: string; storyIndex: number | null; releaseDate: string | null };
const e = (name: string, storyIndex: number | null, releaseDate: string | null): E => ({ name, storyIndex, releaseDate });

const names = (list: E[]) => list.map((x) => x.name);

describe('orderEntries', () => {
  const items = [
    e('Last', 2, '2020-01-01'),
    e('First', 0, '2015-01-01'),
    e('Middle', 1, '2010-01-01'),
    e('Extra', null, '2012-06-01'),
  ];

  it('release order sorts by date and ignores the story', () => {
    assert.deepEqual(names(orderEntries(items, 'RELEASE')), ['Middle', 'Extra', 'First', 'Last']);
  });

  it('story order follows the story and puts unknown entries last by release date', () => {
    assert.deepEqual(names(orderEntries(items, 'CHRONOLOGICAL')), ['First', 'Middle', 'Last', 'Extra']);
  });

  it('recommended keeps the story order and slots unknown entries in by release date', () => {
    // Extra (2012) goes after the last story entry released on or before it (Middle, 2010).
    assert.deepEqual(names(orderEntries(items, 'RECOMMENDED')), ['First', 'Middle', 'Extra', 'Last']);
    const more = [e('A', 0, '2000-01-01'), e('B', 1, '2010-01-01'), e('Mid', null, '2005-01-01'), e('Late', null, '2030-01-01')];
    assert.deepEqual(names(orderEntries(more, 'RECOMMENDED')), ['A', 'Mid', 'B', 'Late']);
  });

  it('with no story data every mode is release order', () => {
    const plain = [e('B', null, '2011-01-01'), e('A', null, '2001-01-01')];
    for (const mode of ['RELEASE', 'CHRONOLOGICAL', 'RECOMMENDED'] as const) {
      assert.deepEqual(names(orderEntries(plain, mode)), ['A', 'B']);
    }
  });

  it('puts entries with no date after dated ones and does not change the input', () => {
    const input = [e('NoDate', null, null), e('Dated', null, '2001-01-01')];
    assert.deepEqual(names(orderEntries(input, 'RELEASE')), ['Dated', 'NoDate']);
    assert.deepEqual(names(input), ['NoDate', 'Dated']);
  });
});

describe('entry keys', () => {
  it('uses the TMDB id when known and the title when not', () => {
    assert.equal(entryKeyFor({ kind: 'MOVIE', tmdbId: 24428, title: 'The Avengers', year: 2012 }), 'movie:24428');
    assert.equal(entryKeyFor({ kind: 'MOVIE', tmdbId: null, title: 'The Avengers!', year: 2012 }), 'movie:~the avengers|2012');
    assert.equal(
      entryKeyFor({ kind: 'SEASON', tmdbId: 5, title: 'Loki', year: 2021, seasonNumber: 2 }),
      'tv:5:s2',
    );
    assert.equal(
      entryKeyFor({ kind: 'EPISODES', tmdbId: 5, title: 'Loki', year: 2021, seasonNumber: 1, episodeStart: 1, episodeEnd: 3 }),
      'tv:5:s1e1-3',
    );
  });

  it('labels seasons and ranges', () => {
    assert.equal(entryLabelFor({ kind: 'SEASON', title: 'Loki', seasonNumber: 2, episodeStart: null, episodeEnd: null }), 'Loki - Season 2');
    assert.equal(
      entryLabelFor({ kind: 'EPISODES', title: 'Loki', seasonNumber: 1, episodeStart: 1, episodeEnd: 3 }),
      'Loki - S1 E1-3',
    );
  });
});

describe('mergeFranchiseOrder', () => {
  type Row = { id: string; entryKey: string | null; position: number; manual: boolean; excluded: boolean };
  const row = (id: string, key: string | null, position: number, extra: Partial<Row> = {}): Row => ({
    id,
    entryKey: key,
    position,
    manual: false,
    excluded: false,
    ...extra,
  });
  const f = (k: string) => ({ entryKey: k });
  const flat = (plan: ReturnType<typeof mergeFranchiseOrder<Row, { entryKey: string }>>) =>
    plan.order.map((o) => ('row' in o ? o.row.id : `new:${o.fresh.entryKey}`));

  it('matches by key, creates new entries and removes ones that left the source', () => {
    const plan = mergeFranchiseOrder([row('a', 'm:1', 0), row('b', 'm:2', 1), row('gone', 'm:9', 2)], [f('m:1'), f('m:3'), f('m:2')], {
      customOrder: false,
    });
    assert.deepEqual(plan.remove.map((r) => r.id), ['gone']);
    assert.deepEqual(plan.create.map((c) => c.entryKey), ['m:3']);
    assert.deepEqual(plan.update.map((u) => u.row.id).sort(), ['a', 'b']);
    assert.deepEqual(flat(plan), ['a', 'new:m:3', 'b']);
  });

  it('never removes an entry someone added by hand, and keeps it after its neighbour', () => {
    const plan = mergeFranchiseOrder(
      [row('a', 'm:1', 0), row('mine', 'm:77', 1, { manual: true }), row('b', 'm:2', 2)],
      [f('m:2'), f('m:1')],
      { customOrder: false },
    );
    assert.equal(plan.remove.length, 0);
    assert.deepEqual(flat(plan), ['b', 'a', 'mine']);
  });

  it('never brings back an entry someone removed (excluded)', () => {
    const plan = mergeFranchiseOrder([row('a', 'm:1', 0), row('hidden', 'm:2', 1, { excluded: true })], [f('m:1'), f('m:2')], {
      customOrder: false,
    });
    assert.equal(plan.create.length, 0);
    assert.equal(plan.remove.length, 0);
    assert.deepEqual(flat(plan), ['a', 'hidden']);
  });

  it('keeps a hand-made order and slots new entries after their predecessor', () => {
    const plan = mergeFranchiseOrder(
      [row('a', 'm:1', 0), row('c', 'm:3', 1), row('b', 'm:2', 2)],
      [f('m:1'), f('m:2'), f('m:4'), f('m:3')],
      { customOrder: true },
    );
    assert.deepEqual(flat(plan), ['a', 'c', 'b', 'new:m:4']);
  });

  it('a second merge with the same fresh list changes nothing', () => {
    const first = mergeFranchiseOrder([], [f('m:1'), f('m:2')], { customOrder: false });
    const saved = first.order.map((o, i) => row(`r${i}`, 'fresh' in o ? o.fresh.entryKey : null, i));
    const second = mergeFranchiseOrder(saved, [f('m:1'), f('m:2')], { customOrder: false });
    assert.equal(second.create.length, 0);
    assert.equal(second.remove.length, 0);
    assert.deepEqual(flat(second), ['r0', 'r1']);
  });

  it('drops rows with no key that were not added by hand, and duplicate keys', () => {
    const plan = mergeFranchiseOrder([row('x', null, 0), row('a', 'm:1', 1), row('a2', 'm:1', 2)], [f('m:1')], { customOrder: false });
    assert.deepEqual(plan.remove.map((r) => r.id).sort(), ['a2', 'x']);
  });
});
