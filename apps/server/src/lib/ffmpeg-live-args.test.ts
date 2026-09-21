import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLiveFfmpegArgs,
  initialEncodeMode,
  nextLiveEncodeMode,
  nvencPreset,
  type FfmpegLiveSettings,
} from "./ffmpeg-live-args";

const unraidSettings: FfmpegLiveSettings = {
  enableTranscoding: true,
  targetResolution: "original",
  videoBitrate: "3000k",
  videoBufSize: "6000k",
  videoCodec: "hevc_nvenc",
  audioCodec: "aac",
  audioBitrate: "128k",
  audioChannels: 2,
  enableHardwareAccel: false,
  hardwareAccelType: "none",
  videoPreset: "medium",
  videoCrf: 23,
  threads: 0,
  maxMuxingQueueSize: 1024,
  outputFormat: "mpegts",
  logLevel: "error",
};

describe("nvenc live args", () => {
  it("maps the x264 medium preset to NVENC p4", () => {
    assert.equal(nvencPreset("medium"), "p4");
    assert.equal(nvencPreset("veryfast"), "p1");
    assert.equal(nvencPreset("p2"), "p2");
  });

  it("starts hardware encoders in hardware mode", () => {
    assert.equal(initialEncodeMode("hevc_nvenc"), "hardware");
    assert.equal(initialEncodeMode("libx264"), "software");
    assert.equal(nextLiveEncodeMode("hardware"), "cpu-decode");
    assert.equal(nextLiveEncodeMode("cpu-decode"), "software");
    assert.equal(nextLiveEncodeMode("software"), null);
  });

  it("uses NVENC with CUDA decode and does not pass libx264 -crf", () => {
    const args = buildLiveFfmpegArgs("http://plex/file", 12, unraidSettings, {
      mode: "hardware",
    });
    assert.ok(args.includes("cuda"));
    assert.equal(args[args.indexOf("-c:v") + 1], "hevc_nvenc");
    assert.equal(args[args.indexOf("-preset") + 1], "p4");
    assert.equal(args[args.indexOf("-tune") + 1], "ll");
    assert.equal(args.includes("-crf"), false);
    assert.equal(args[args.indexOf("-analyzeduration") + 1], "200000");
  });

  it("keeps NVENC encode when CUDA decode is unavailable", () => {
    const args = buildLiveFfmpegArgs("http://plex/file", 0, unraidSettings, {
      mode: "cpu-decode",
    });
    assert.equal(args.includes("-hwaccel"), false);
    assert.equal(args[args.indexOf("-c:v") + 1], "hevc_nvenc");
    assert.equal(args.includes("-crf"), false);
  });

  it("falls back to a cheap two-thread x264 encode", () => {
    const args = buildLiveFfmpegArgs("http://plex/file", 0, unraidSettings, {
      mode: "software",
      fallback: true,
    });
    assert.equal(args[args.indexOf("-c:v") + 1], "libx264");
    assert.equal(args[args.indexOf("-preset") + 1], "veryfast");
    assert.equal(args[args.indexOf("-tune") + 1], "zerolatency");
    assert.equal(args[args.indexOf("-threads") + 1], "2");
  });

  it("caps automatic libx264 threads when the user chose CPU encode", () => {
    const args = buildLiveFfmpegArgs(
      "http://plex/file",
      0,
      { ...unraidSettings, videoCodec: "libx264", videoPreset: "fast" },
      { mode: "software" },
    );
    assert.equal(args[args.indexOf("-c:v") + 1], "libx264");
    assert.equal(args[args.indexOf("-preset") + 1], "fast");
    assert.equal(args[args.indexOf("-threads") + 1], "2");
    assert.equal(args.includes("zerolatency"), false);
  });

  it("copy=1 remuxes without a video encoder even when transcoding is on", () => {
    const args = buildLiveFfmpegArgs("http://plex/file", 42, unraidSettings, {
      mode: "hardware",
      copy: true,
    });
    assert.equal(args[args.indexOf("-c") + 1], "copy");
    assert.equal(args.includes("-c:v"), false);
    assert.equal(args.includes("hevc_nvenc"), false);
    assert.equal(args.includes("libx264"), false);
    assert.equal(args.includes("-crf"), false);
    assert.ok(args.includes("+genpts+discardcorrupt+nobuffer+fastseek"));
    assert.equal(args[args.indexOf("-ss") + 1], "42");
  });
});
