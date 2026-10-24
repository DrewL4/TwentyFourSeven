import test from "node:test";
import assert from "node:assert/strict";
import { createBuildOnce } from "./xmltv-build-once";

function harness() {
  let gen = 0;
  let builds = 0;
  const releases: Array<() => void> = [];
  const rebuild = createBuildOnce(
    () => {
      builds += 1;
      return new Promise<void>((r) => releases.push(r));
    },
    () => gen,
  );
  const tick = () => new Promise((r) => setImmediate(r));
  return { rebuild, tick, release: (i: number) => releases[i](), builds: () => builds, bump: () => { gen += 1; } };
}

test("concurrent cache misses share one build", async () => {
  const h = harness();
  const all = Promise.all([h.rebuild(false), h.rebuild(false), h.rebuild(false)]);
  assert.equal(h.builds(), 1);
  h.release(0);
  await all;
  assert.equal(h.builds(), 1);
});

test("bypass during a build gets one fresh follow-up build, shared by later bypasses", async () => {
  const h = harness();
  const first = h.rebuild(false);
  const b1 = h.rebuild(true);
  const b2 = h.rebuild(true);
  assert.equal(h.builds(), 1);
  h.release(0);
  await first;
  await h.tick();
  assert.equal(h.builds(), 2);
  h.release(1);
  await Promise.all([b1, b2]);
  assert.equal(h.builds(), 2);
});

test("a miss after invalidation does not join the build that started before it", async () => {
  const h = harness();
  const first = h.rebuild(false);
  h.bump();
  const after = h.rebuild(false);
  h.release(0);
  await first;
  await h.tick();
  assert.equal(h.builds(), 2);
  h.release(1);
  await after;
});

test("a failed build rejects its waiters and the next miss builds again", async () => {
  let n = 0;
  const rebuild = createBuildOnce(async () => { n += 1; if (n === 1) throw new Error("db down"); }, () => 0);
  await assert.rejects(Promise.all([rebuild(false), rebuild(false)]), /db down/);
  await rebuild(false);
  assert.equal(n, 2);
});
