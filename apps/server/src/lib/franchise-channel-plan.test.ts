import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { franchiseChannelName, nextFreeChannelNumber } from './franchise-channel-plan';

describe('franchise channel plan', () => {
  it('starts at 100 and skips taken numbers', () => {
    assert.equal(nextFreeChannelNumber([]), 100);
    assert.equal(nextFreeChannelNumber([1, 2, 100, 101, 103]), 102);
    assert.equal(nextFreeChannelNumber([100], 5), 5);
  });
  it('cleans collection suffixes from names', () => {
    assert.equal(franchiseChannelName('Star Wars Collection'), 'Star Wars');
    assert.equal(franchiseChannelName('Marvel Cinematic Universe'), 'Marvel Cinematic Universe');
    assert.equal(franchiseChannelName('Collection'), 'Collection');
  });
});
