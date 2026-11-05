import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCopyFfmpegArgs, buildLiveFfmpegArgs, DV_STRIP_BSF, type FfmpegLiveSettings } from "./ffmpeg-live-args";

const nvencSettings: FfmpegLiveSettings = {
  enableTranscoding: true,
  targetResolution: "original",
  videoBitrate: "6000k",
  videoCodec: "h264_nvenc",
  audioCodec: "aac",
  outputFormat: "mpegts",
};

const opt = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("direct play (copy) args", () => {
  it("copies the video with no encoder, no filter and no GPU", () => {
    const args = buildCopyFfmpegArgs("http://plex/file", 3600, { copyAudio: true });
    assert.equal(opt(args, "-c:v"), "copy");
    assert.equal(opt(args, "-c:a"), "copy");
    for (const banned of ["-vf", "-filter_complex", "-hwaccel", "libx264", "h264_nvenc", "hevc_nvenc", "-preset", "-b:v"]) {
      assert.ok(!args.includes(banned), `${banned} must not be in a pass-through`);
    }
  });
  it("seeks before the input so the stream starts on the keyframe at or before the seek point", () => {
    const args = buildCopyFfmpegArgs("http://plex/file", 1234, {});
    assert.ok(args.indexOf("-ss") < args.indexOf("-i"));
    assert.equal(opt(args, "-ss"), "1234");
    assert.ok(!args.includes("-noaccurate_seek"));
  });
  it("stripDolbyVision drops RPU and enhancement-layer NAL units", () => {
    const args = buildCopyFfmpegArgs("http://plex/file", 0, { stripDolbyVision: true });
    assert.equal(opt(args, "-bsf:v"), DV_STRIP_BSF);
    assert.equal(DV_STRIP_BSF, "filter_units=remove_types=62|63");
    assert.ok(!buildCopyFfmpegArgs("http://plex/file", 0, {}).includes("-bsf:v"));
  });
  it("buildLiveFfmpegArgs copy=true copies even for a browser client", () => {
    const args = buildLiveFfmpegArgs("http://plex/file", 0, nvencSettings, { mode: "hardware", copy: true, browser: true });
    assert.equal(opt(args, "-c:v"), "copy");
  });
});

describe("transcode args are GPU args", () => {
  it("hardware mode: NVDEC + NVENC, never libx264", () => {
    const args = buildLiveFfmpegArgs("http://plex/file", 0, nvencSettings, { mode: "hardware" });
    assert.equal(opt(args, "-c:v"), "h264_nvenc");
    assert.ok(args.includes("cuda"));
    assert.ok(!args.includes("libx264"));
  });
  it("cpu-decode mode (first step down) still encodes on NVENC", () => {
    const args = buildLiveFfmpegArgs("http://plex/file", 0, nvencSettings, { mode: "cpu-decode" });
    assert.equal(opt(args, "-c:v"), "h264_nvenc");
    assert.ok(!args.includes("libx264"));
  });
  it("browser transcode uses NVENC H.264 too", () => {
    const args = buildLiveFfmpegArgs("http://plex/file", 0, { ...nvencSettings, videoCodec: "hevc_nvenc" }, { mode: "hardware", browser: true });
    assert.equal(opt(args, "-c:v"), "h264_nvenc");
  });
  it("libx264 only appears in software mode (the last, logged resort)", () => {
    const args = buildLiveFfmpegArgs("http://plex/file", 0, nvencSettings, { mode: "software" });
    assert.equal(opt(args, "-c:v"), "libx264");
  });
});
