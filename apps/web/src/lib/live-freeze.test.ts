import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLivePictureFrozen, videoConfigChanged, type LiveVideoConfig, type LivePlaybackSample } from './live-freeze';

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

describe('videoConfigChanged', () => {
  const sintel: LiveVideoConfig = { width: 640, height: 272, videoCodec: 'avc1.64001f', sarNum: 1, sarDen: 1 };
  it('first report is only the baseline', () => {
    assert.equal(videoConfigChanged(null, sintel), false);
  });
  it('same picture again (for example after an audio change) is not a change', () => {
    assert.equal(videoConfigChanged(sintel, { ...sintel }), false);
  });
  it('detects a size change (640x272 -> 640x268)', () => {
    assert.equal(videoConfigChanged(sintel, { ...sintel, height: 268 }), true);
  });
  it('detects 640x360 -> 640x268 and 640x268 -> 480x270', () => {
    assert.equal(videoConfigChanged({ ...sintel, height: 360 }, { ...sintel, height: 268 }), true);
    assert.equal(videoConfigChanged({ ...sintel, height: 268 }, { ...sintel, width: 480, height: 270 }), true);
  });
  it('detects a codec profile/level or pixel aspect change at the same size', () => {
    assert.equal(videoConfigChanged(sintel, { ...sintel, videoCodec: 'avc1.4d401e' }), true);
    assert.equal(videoConfigChanged(sintel, { ...sintel, sarNum: 4, sarDen: 3 }), true);
  });
  it('ignores reports with no video size yet', () => {
    assert.equal(videoConfigChanged(sintel, { videoCodec: 'avc1.64001f' }), false);
  });
});
