import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { settingsPageIsLoading } from './settings-ready';

describe('settings page loading gate', () => {
  it('stays on the placeholders until both the settings and the video status are in', () => {
    assert.equal(settingsPageIsLoading({ settingsLoading: true, mediaStatusLoading: true }), true);
    assert.equal(settingsPageIsLoading({ settingsLoading: false, mediaStatusLoading: true }), true);
    assert.equal(settingsPageIsLoading({ settingsLoading: true, mediaStatusLoading: false }), true);
  });
  it('shows the cards once both are loaded', () => {
    assert.equal(settingsPageIsLoading({ settingsLoading: false, mediaStatusLoading: false }), false);
  });
});
