import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIdFrom, bundleIsStale, mayReload } from './stale-bundle';

describe('buildIdFrom', () => {
  it('reads the id from page HTML, where the quotes are escaped', () => {
    const html = '<script>self.__next_f.push([1,"{\\"b\\":\\"kV_WlUPQNcFdiKuGDHfgi\\",\\"p\\":\\"\\"}"])</script>';
    assert.equal(buildIdFrom(html), 'kV_WlUPQNcFdiKuGDHfgi');
  });
  it('reads the id from the running page data, where the quotes are plain', () => {
    assert.equal(buildIdFrom('0:{"b":"00LPMrzBa5J7iZIx1IhEN","p":""}'), '00LPMrzBa5J7iZIx1IhEN');
  });
  it('null when there is no id (error page, empty reply)', () => {
    assert.equal(buildIdFrom('<html>502 Bad Gateway</html>'), null);
    assert.equal(buildIdFrom(''), null);
  });
});

describe('bundleIsStale', () => {
  it('a different id is a new build', () => {
    assert.equal(bundleIsStale('old', 'new'), true);
  });
  it('same id is not stale', () => {
    assert.equal(bundleIsStale('same', 'same'), false);
  });
  it('an unknown id on either side is never treated as a new build', () => {
    assert.equal(bundleIsStale(null, 'new'), false);
    assert.equal(bundleIsStale('old', null), false);
    assert.equal(bundleIsStale(null, null), false);
  });
});

describe('mayReload', () => {
  it('allows the first reload and one a minute later, not sooner', () => {
    assert.equal(mayReload(null, 1000), true);
    assert.equal(mayReload(1000, 30_000), false);
    assert.equal(mayReload(1000, 61_000), true);
  });
});
