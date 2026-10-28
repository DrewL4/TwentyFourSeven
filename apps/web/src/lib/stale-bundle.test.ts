import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bundleIsStale, mayReload, scriptFiles } from './stale-bundle';

const html = (files: string[]) => `<html><head></head><body>${files.map((f) => `<script src="${f}" async=""></script>`).join('')}<script>self.__next_f=[]</script></body></html>`;

describe('scriptFiles', () => {
  it('lists /_next/static scripts, ignoring host, query and inline scripts', () => {
    const files = scriptFiles(html(['/_next/static/chunks/a-1.js', 'http://x:1/_next/static/chunks/b-2.js?dpl=9', '/other/x.js']));
    assert.deepEqual(files, ['/_next/static/chunks/a-1.js', '/_next/static/chunks/b-2.js']);
  });
});

describe('bundleIsStale', () => {
  const running = ['/_next/static/chunks/a-1.js', '/_next/static/chunks/b-2.js', '/_next/static/chunks/extra-9.js'];
  it('same build: not stale, even if the page loaded extra chunks since', () => {
    assert.equal(bundleIsStale(running, ['/_next/static/chunks/a-1.js', '/_next/static/chunks/b-2.js']), false);
  });
  it('a new hashed file: stale', () => {
    assert.equal(bundleIsStale(running, ['/_next/static/chunks/a-1.js', '/_next/static/chunks/b-3.js']), true);
  });
  it('empty or unparseable reply is never treated as a new build', () => {
    assert.equal(bundleIsStale(running, []), false);
  });
});

describe('mayReload', () => {
  it('allows the first reload and one a minute later, not sooner', () => {
    assert.equal(mayReload(null, 1000), true);
    assert.equal(mayReload(1000, 30_000), false);
    assert.equal(mayReload(1000, 61_000), true);
  });
});
