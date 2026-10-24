import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLiveFfmpegArgs, type FfmpegLiveSettings } from "./ffmpeg-live-args";
import { hdrTransfer, planHdrToneMap, SDR_BT709_OUTPUT_ARGS, toneMapFilter } from "./hdr-tone-map";

const nvenc: FfmpegLiveSettings = {
  enableTranscoding: true,
  targetResolution: "original",
  videoBitrate: "3000k",
  videoCodec: "h264_nvenc",
  audioCodec: "aac",
  outputFormat: "mpegts",
};
const x264: FfmpegLiveSettings = { ...nvenc, videoCodec: "libx264", targetResolution: "1280x720" };

function vf(args: string[]): string | undefined {
  const i = args.indexOf("-vf");
  return i >= 0 ? args[i + 1] : undefined;
}
function opt(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe("hdrTransfer", () => {
  it("knows PQ and HLG, nothing else", () => {
    assert.equal(hdrTransfer({ colorTrc: "smpte2084" }), "smpte2084");
    assert.equal(hdrTransfer({ colorTrc: "arib-std-b67" }), "arib-std-b67");
    assert.equal(hdrTransfer({ colorTrc: "bt709" }), null);
    assert.equal(hdrTransfer({ colorTrc: null }), null);
    assert.equal(hdrTransfer(undefined), null);
  });
});

describe("planHdrToneMap", () => {
  it("tone-maps HDR10 when the filters exist", () => {
    const plan = planHdrToneMap({ colorTrc: "smpte2084", bitDepth: 10 }, true);
    assert.deepEqual(plan.toneMap, { transfer: "smpte2084" });
    assert.equal(plan.log?.level, "info");
  });

  it("falls back to the plain 8-bit conversion and says so when the filters are missing", () => {
    const plan = planHdrToneMap({ colorTrc: "arib-std-b67" }, false);
    assert.equal(plan.toneMap, null);
    assert.equal(plan.log?.level, "warn");
    assert.match(plan.log!.message, /unavailable/);
  });

  it("warns on Dolby Vision profile 5 and does not apply an HDR10 tone map to it", () => {
    const plan = planHdrToneMap({ colorTrc: "smpte2084", dolbyVision: true, dolbyVisionProfile: 5 }, true);
    assert.equal(plan.toneMap, null);
    assert.equal(plan.log?.level, "warn");
    assert.match(plan.log!.message, /profile 5.*libplacebo/);
  });

  it("Dolby Vision 8.1 has an HDR10 base layer: tone-mapped", () => {
    const plan = planHdrToneMap({ colorTrc: "smpte2084", dolbyVision: true, dolbyVisionProfile: 8 }, true);
    assert.deepEqual(plan.toneMap, { transfer: "smpte2084" });
  });

  it("SDR: nothing to do, nothing logged", () => {
    assert.deepEqual(planHdrToneMap({ colorTrc: "bt709", bitDepth: 8 }, true), { toneMap: null });
  });
});

describe("tone map in the live FFmpeg args", () => {
  const toneMap = { transfer: "smpte2084" as const };

  it("NVENC: CPU tone map on system-memory frames, bt709 tags, no smpte2084/bt2020 on the output", () => {
    const args = buildLiveFfmpegArgs("http://plex/f", 0, nvenc, { mode: "hardware", toneMap });
    assert.equal(opt(args, "-hwaccel"), "cuda");
    assert.equal(args.includes("-hwaccel_output_format"), false);
    assert.equal(vf(args), toneMapFilter(toneMap));
    assert.match(vf(args)!, /tin=smpte2084.*tonemap=tonemap=hable.*zscale=t=bt709:m=bt709:r=tv,format=yuv420p$/);
    assert.equal(opt(args, "-color_primaries"), "bt709");
    assert.equal(opt(args, "-color_trc"), "bt709");
    assert.equal(opt(args, "-colorspace"), "bt709");
    const out = args.slice(args.indexOf("-i") + 2).join(" ");
    assert.equal(/2084|bt2020/.test(out.replace(vf(args)!, "")), false);
  });

  it("NVENC_GPU_FRAMES is turned off for a tone-mapped stream (the filters need system memory)", () => {
    const args = buildLiveFfmpegArgs("http://plex/f", 0, nvenc, { mode: "hardware", toneMap }, { gpuFrames: true });
    assert.equal(args.includes("-hwaccel_output_format"), false);
    assert.equal(/scale_cuda/.test(vf(args)!), false);
    const sdr = buildLiveFfmpegArgs("http://plex/f", 0, nvenc, { mode: "hardware" }, { gpuFrames: true });
    assert.match(vf(sdr)!, /scale_cuda/);
  });

  it("software: scales inside the first zscale, HLG input", () => {
    const args = buildLiveFfmpegArgs("http://plex/f", 0, x264, { mode: "software", toneMap: { transfer: "arib-std-b67" } });
    assert.match(vf(args)!, /^zscale=w=1280:h=720:tin=arib-std-b67:/);
    assert.equal(/(^|,)scale=/.test(vf(args)!), false);
    for (let i = 0; i < SDR_BT709_OUTPUT_ARGS.length; i += 2) {
      assert.equal(opt(args, SDR_BT709_OUTPUT_ARGS[i]), SDR_BT709_OUTPUT_ARGS[i + 1]);
    }
  });

  it("no tone map: unchanged 8-bit conversion and no colour tags", () => {
    const args = buildLiveFfmpegArgs("http://plex/f", 0, x264, { mode: "software" });
    assert.equal(vf(args), "scale=1280x720,format=yuv420p|nv12");
    assert.equal(args.includes("-color_trc"), false);
  });

  it("QSV/VAAPI, copy and browser+CUDA ignore it", () => {
    const qsv = buildLiveFfmpegArgs("http://plex/f", 0, { ...nvenc, videoCodec: "h264_qsv" }, { mode: "hardware", toneMap });
    assert.equal(args2str(qsv).includes("zscale"), false);
    const copy = buildLiveFfmpegArgs("http://plex/f", 0, nvenc, { mode: "hardware", copy: true, toneMap });
    assert.equal(args2str(copy).includes("zscale"), false);
    const browserCuda = buildLiveFfmpegArgs("http://plex/f", 0, nvenc, { mode: "hardware", browser: true, toneMap });
    assert.equal(args2str(browserCuda).includes("zscale"), false);
    const browserCpu = buildLiveFfmpegArgs("http://plex/f", 0, nvenc, { mode: "cpu-decode", browser: true, toneMap });
    assert.equal(args2str(browserCpu).includes("zscale"), true);
  });
});

function args2str(a: string[]): string {
  return a.join(" ");
}
