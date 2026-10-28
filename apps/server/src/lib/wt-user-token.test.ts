import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openWatchTowerToken, sealWatchTowerToken } from './wt-user-token';

describe('wt-user-token', () => {
  it('round-trips and does not store the token in the clear', () => {
    const sealed = sealWatchTowerToken('abc123token', 'secret-one');
    assert.ok(!sealed.includes('abc123token'));
    assert.equal(openWatchTowerToken(sealed, 'secret-one'), 'abc123token');
  });
  it('gives a different sealed value each time', () => {
    assert.notEqual(sealWatchTowerToken('t', 's'), sealWatchTowerToken('t', 's'));
  });
  it('returns null for the wrong secret, tampering, junk, and missing values', () => {
    const sealed = sealWatchTowerToken('tok', 'secret-one');
    assert.equal(openWatchTowerToken(sealed, 'secret-two'), null);
    const parts = sealed.split('.');
    parts[3] = Buffer.from('x'.repeat(3)).toString('base64url');
    assert.equal(openWatchTowerToken(parts.join('.'), 'secret-one'), null);
    assert.equal(openWatchTowerToken('nonsense', 'secret-one'), null);
    assert.equal(openWatchTowerToken(null, 'secret-one'), null);
  });
  it('refuses to seal with a missing or placeholder secret', () => {
    assert.throws(() => sealWatchTowerToken('t', ''));
    assert.throws(() => sealWatchTowerToken('t', 'auto-generated'));
  });
});
