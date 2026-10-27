import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canOpenPath, isAdminOnlyPath, isManagerPath, isStaffPath } from './admin-routes';

describe('page access by role', () => {
  const rows: Array<[string, boolean, boolean, boolean]> = [
    // path, USER, MANAGER, ADMIN
    ['/', true, true, true],
    ['/guide', true, true, true],
    ['/dashboard', true, true, true],
    ['/channels', false, true, true],
    ['/channels/abc', false, true, true],
    ['/library', false, true, true],
    ['/settings/franchises', false, true, true],
    ['/settings', false, false, true],
    ['/settings/plex', false, false, true],
    ['/settings/ffmpeg', false, false, true],
    ['/users', false, false, true],
    ['/viewers', false, false, true],
  ];
  for (const [p, user, manager, admin] of rows) {
    it(`${p}`, () => {
      assert.equal(canOpenPath('USER', p), user);
      assert.equal(canOpenPath('MANAGER', p), manager);
      assert.equal(canOpenPath('ADMIN', p), admin);
    });
  }
  it('classifies paths', () => {
    assert.equal(isManagerPath('/settings/franchises'), true);
    assert.equal(isAdminOnlyPath('/settings/franchises'), false);
    assert.equal(isAdminOnlyPath('/settings/plex'), true);
    assert.equal(isStaffPath('/guide'), false);
    assert.equal(isStaffPath('/channels'), true);
  });
});
