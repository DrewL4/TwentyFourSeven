import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canOpenPath, type NavRole } from './admin-routes';
import { FRANCHISES_BLURB, FRANCHISES_LABEL, FRANCHISES_PATH, mobileLinksFor, sidebarLinksFor } from './nav-links';

const labels = (role: NavRole, f: typeof sidebarLinksFor) => f(role).map((l) => l.label);

describe('sidebar links by role', () => {
  it('Manager: Home, TV Guide, Channels, Library, Franchises, Users', () => {
    assert.deepEqual(labels('MANAGER', sidebarLinksFor), ['Home', 'TV Guide', 'Channels', 'Library', 'Franchises', 'Users']);
  });
  it('Admin and Owner: everything a Manager has plus Viewers, Settings', () => {
    assert.deepEqual(labels('ADMIN', sidebarLinksFor), [
      'Home', 'TV Guide', 'Channels', 'Library', 'Franchises', 'Users', 'Viewers', 'Settings',
    ]);
  });
  it('regular user: Home, TV Guide and Franchises', () => {
    assert.deepEqual(labels('USER', sidebarLinksFor), ['Home', 'TV Guide', 'Franchises']);
  });
  it('an Admin sees every link a Manager sees (sidebar and phone bar)', () => {
    for (const f of [sidebarLinksFor, mobileLinksFor]) {
      const admin = new Set(f('ADMIN').map((l) => l.to));
      for (const l of f('MANAGER')) assert.ok(admin.has(l.to), `Admin is missing ${l.to}`);
    }
  });
  it('every link a role is shown is a page that role may open', () => {
    for (const role of ['USER', 'MANAGER', 'ADMIN'] as const) {
      for (const f of [sidebarLinksFor, mobileLinksFor]) {
        for (const l of f(role)) assert.equal(canOpenPath(role, l.to), true, `${role} -> ${l.to}`);
      }
    }
  });
});

describe('phone bar by role', () => {
  it('regular user gets Franchises too', () => {
    assert.deepEqual(labels('USER', mobileLinksFor), ['Home', 'Guide', 'Franchises']);
  });
  it('Manager gets Franchises, no Settings', () => {
    assert.deepEqual(labels('MANAGER', mobileLinksFor), ['Home', 'Guide', 'Channels', 'Library', 'Franchises']);
  });
  it('Admin gets Franchises and Settings', () => {
    assert.deepEqual(labels('ADMIN', mobileLinksFor), ['Home', 'Guide', 'Channels', 'Library', 'Franchises', 'Settings']);
  });
});

describe('franchise naming', () => {
  it('uses one plain name and no jargon', () => {
    assert.equal(FRANCHISES_LABEL, 'Franchises');
    assert.equal(FRANCHISES_PATH, '/franchises');
    assert.ok(!/tmdb|timeline/i.test(FRANCHISES_BLURB));
    const sidebar = sidebarLinksFor('ADMIN').find((l) => l.to === FRANCHISES_PATH);
    assert.equal(sidebar?.label, FRANCHISES_LABEL);
  });
});
