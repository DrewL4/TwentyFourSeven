import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  gpuHealth,
  noteCpuConfiguredTranscode,
  noteGpuEncodeOk,
  reportGpuStepDown,
  resetCpuConfiguredWarnForTests,
  resetGpuHealthForTests,
  softwareFallbackPolicy,
} from "./encoder-policy";

function sink() {
  const warn: string[] = [];
  const error: string[] = [];
  return { warn: (m: string) => warn.push(m), error: (m: string) => error.push(m), out: { warn, error } };
}

beforeEach(() => {
  resetGpuHealthForTests();
  resetCpuConfiguredWarnForTests();
});
afterEach(() => {
  delete process.env.TFS_SOFTWARE_FALLBACK;
});

describe("GPU is never left silently", () => {
  it("falling to libx264 logs an error, counts it and marks the GPU degraded", () => {
    const log = sink();
    assert.equal(reportGpuStepDown(48, "cpu-decode", "software", "CUDA_ERROR_NO_DEVICE", log), true);
    assert.equal(log.out.error.length, 1);
    assert.match(log.out.error[0], /\[GPU\].*CUDA_ERROR_NO_DEVICE.*FALLING BACK TO CPU libx264/);
    assert.equal(gpuHealth().state, "degraded");
    assert.equal(gpuHealth().cpuFallbacks, 1);
  });
  it("hardware -> cpu-decode keeps the GPU encoder and warns", () => {
    const log = sink();
    reportGpuStepDown(48, "hardware", "cpu-decode", "cuvid decode failed", log);
    assert.equal(log.out.error.length, 0);
    assert.match(log.out.warn[0], /GPU encode/);
    assert.equal(gpuHealth().cpuFallbacks, 0);
  });
  it("TFS_SOFTWARE_FALLBACK=never refuses the CPU encode", () => {
    process.env.TFS_SOFTWARE_FALLBACK = "never";
    assert.equal(softwareFallbackPolicy(), "never");
    const log = sink();
    assert.equal(reportGpuStepDown(48, "cpu-decode", "software", "no device", log), false);
    assert.match(log.out.error[0], /CPU encode is disabled/);
    assert.equal(gpuHealth().cpuFallbacks, 0);
  });
  it("a working GPU encode marks it ok", () => {
    noteGpuEncodeOk();
    assert.equal(gpuHealth().state, "ok");
  });
  it("a transcode configured for the CPU is called out (once a minute)", () => {
    const log = sink();
    noteCpuConfiguredTranscode(5, "libx264", log, 1_000_000);
    noteCpuConfiguredTranscode(5, "libx264", log, 1_000_500);
    noteCpuConfiguredTranscode(5, "h264_nvenc", log, 2_000_000);
    assert.equal(log.out.warn.length, 1);
    assert.match(log.out.warn[0], /h264_nvenc/);
    assert.equal(gpuHealth().cpuConfiguredTranscodes, 2);
  });
});
