import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ffmpegCanToneMap,
  ffmpegSupportsReadrateInitialBurst,
  parseFilterNames,
  warmFfmpegToneMap,
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
  delete process.env.FFMPEG_TONEMAP;
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

const filtersList = [
  "Filters:",
  "  T.. = Timeline support",
  " ... tonemap           V->V       Conversion to/from different dynamic ranges.",
  " .SC zscale            V->V       Apply resizing, colorspace and bit depth conversion.",
  " ... scale_cuda        V->V       GPU accelerated video resizer",
].map((l) => `echo "${l}"`).join("; ");
const withToneMap = fakeFfmpeg("tm", filtersList);
const withoutZscale = fakeFfmpeg("nozs", 'echo " ... tonemap           V->V       Conversion"');

test("tone map: detected when zscale and tonemap are both listed", async () => {
  assert.equal(ffmpegCanToneMap(withToneMap), false); // not probed yet: never blocks
  assert.equal(await warmFfmpegToneMap(withToneMap), true);
  assert.equal(ffmpegCanToneMap(withToneMap), true);
});

test("tone map: missing zscale means no tone map", async () => {
  assert.equal(await warmFfmpegToneMap(withoutZscale), false);
  assert.equal(ffmpegCanToneMap(withoutZscale), false);
});

test("tone map: a missing ffmpeg resolves false instead of throwing", async () => {
  assert.equal(await warmFfmpegToneMap(join(dir, "nope")), false);
});

test("tone map: FFMPEG_TONEMAP overrides the probe", async () => {
  process.env.FFMPEG_TONEMAP = "false";
  assert.equal(await warmFfmpegToneMap(withToneMap), false);
  assert.equal(ffmpegCanToneMap(withToneMap), false);
  delete process.env.FFMPEG_TONEMAP;
});

test("parseFilterNames reads the flag column format", () => {
  const names = parseFilterNames(" .SC zscale            V->V       x\n TSC scale    V->V   y\nnot a filter line");
  assert.deepEqual([...names].sort(), ["scale", "zscale"]);
});
