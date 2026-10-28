import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLivePictureFrozen, type LivePlaybackSample } from './live-freeze';

const base: LivePlaybackSample = { paused: false, ended: false, currentTime: 90.88, previousTime: 90.88, readyState: 2, bufferedAhead: 6 };

describe('isLivePictureFrozen', () => {
  it('frozen: playhead still, data buffered ahead (the 640x272 -> 640x268 handoff)', () => {
    assert.equal(isLivePictureFrozen(base), true);
  });
  it('not frozen while the playhead moves', () => {
    assert.equal(isLivePictureFrozen({ ...base, currentTime: 91.9 }), false);
  });
  it('not frozen when the network is slow (nothing buffered ahead)', () => {
    assert.equal(isLivePictureFrozen({ ...base, bufferedAhead: 0.3 }), false);
  });
  it('not frozen when paused, ended, or playing normally (readyState 4)', () => {
    assert.equal(isLivePictureFrozen({ ...base, paused: true }), false);
    assert.equal(isLivePictureFrozen({ ...base, ended: true }), false);
    assert.equal(isLivePictureFrozen({ ...base, readyState: 4 }), false);
  });
  it('not frozen before playback has started', () => {
    assert.equal(isLivePictureFrozen({ ...base, currentTime: 0, previousTime: 0 }), false);
  });
});
