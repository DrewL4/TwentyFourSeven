import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ffmpegSupportsReadrateInitialBurst,
  resetFfmpegCapabilitiesForTests,
  warmFfmpegCapabilities,
} from "./ffmpeg-capabilities";

const dir = mkdtempSync(join(tmpdir(), "tfs-ffcap-"));
function fakeFfmpeg(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}
const withFlag = fakeFfmpeg("new", 'echo "-readrate         <float>  read input at specified rate"; echo "-readrate_initial_burst <double> burst"');
const withoutFlag = fakeFfmpeg("old", 'echo "-readrate         <float>  read input at specified rate"');
const slow = fakeFfmpeg("slow", 'sleep 3; echo "-readrate_initial_burst <double>"');

beforeEach(() => {
  delete process.env.FFMPEG_READRATE_INITIAL_BURST;
  resetFfmpegCapabilitiesForTests();
});

test("detects the flag on FFmpeg 6.1+", async () => {
  assert.equal(await warmFfmpegCapabilities(withFlag), true);
  assert.equal(ffmpegSupportsReadrateInitialBurst(withFlag), true);
});

test("FFmpeg 5.1 without the flag answers false", async () => {
  assert.equal(await warmFfmpegCapabilities(withoutFlag), false);
  assert.equal(ffmpegSupportsReadrateInitialBurst(withoutFlag), false);
});

test("missing binary answers false and does not throw", async () => {
  assert.equal(await warmFfmpegCapabilities(join(dir, "nope")), false);
});

test("first play does not wait on a slow probe", async () => {
  const started = Date.now();
  assert.equal(ffmpegSupportsReadrateInitialBurst(slow), false);
  assert.ok(Date.now() - started < 200, `blocked for ${Date.now() - started} ms`);
  // The background probe still finishes and later plays use its answer.
  assert.equal(await warmFfmpegCapabilities(slow), true);
  assert.equal(ffmpegSupportsReadrateInitialBurst(slow), true);
});

test("a hung probe times out without blocking", async () => {
  const hung = fakeFfmpeg("hung", "exec sleep 30");
  const started = Date.now();
  assert.equal(await warmFfmpegCapabilities(hung, undefined, 300), false);
  assert.ok(Date.now() - started < 2000);
});

test("env override wins without spawning", async () => {
  process.env.FFMPEG_READRATE_INITIAL_BURST = "true";
  assert.equal(ffmpegSupportsReadrateInitialBurst(join(dir, "nope")), true);
  process.env.FFMPEG_READRATE_INITIAL_BURST = "false";
  assert.equal(await warmFfmpegCapabilities(withFlag), false);
});
