import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { androidTvCaps, browserCaps, genericCaps, knownPlayerCaps, legacyCopyCaps, forcedTranscodeCaps, parseCapsDeclaration } from "./client-caps";
import { decidePlayback, passThroughAnyway } from "./playback-decision";
import type { RemoteVideoInfo } from "./local-media/playback";

const h264: RemoteVideoInfo = { videoCodec: "h264", videoProfile: "high", bitDepth: 8, colorTrc: "bt709", height: 1080, bitrateKbps: 8000, audioCodec: "aac", audioChannels: 2 };
const hevc8: RemoteVideoInfo = { ...h264, videoCodec: "hevc", videoProfile: "main", height: 2160, bitrateKbps: 15000 };
const hevc10sdr: RemoteVideoInfo = { ...hevc8, videoProfile: "main 10", bitDepth: 10 };
const hdr10: RemoteVideoInfo = { ...hevc10sdr, colorTrc: "smpte2084", bitrateKbps: 30000 };
const hlg: RemoteVideoInfo = { ...hevc10sdr, colorTrc: "arib-std-b67" };
const dv8: RemoteVideoInfo = { ...hdr10, dolbyVision: true, dolbyVisionProfile: 8 };
const dv5: RemoteVideoInfo = { ...hdr10, dolbyVision: true, dolbyVisionProfile: 5, colorTrc: "smpte2084" };
const remux80: RemoteVideoInfo = { ...hdr10, bitrateKbps: 80000 };
const av1: RemoteVideoInfo = { ...h264, videoCodec: "av1" };
const mpeg2: RemoteVideoInfo = { ...h264, videoCodec: "mpeg2video", bitrateKbps: 6000, audioCodec: "mp2" };
const h264hi10: RemoteVideoInfo = { ...h264, videoProfile: "high 10", bitDepth: 10 };

const tv = androidTvCaps();
const browser = browserCaps();
const player = knownPlayerCaps();
const generic = genericCaps();
const legacy = legacyCopyCaps();
const forced = forcedTranscodeCaps(tv);

const action = (caps: Parameters<typeof decidePlayback>[0], v: RemoteVideoInfo | undefined) => decidePlayback(caps, v).action;

describe("decidePlayback: Android TV (MWS-TV)", () => {
  it("plays everything it can decode as-is", () => {
    for (const v of [h264, hevc8, hevc10sdr, hdr10, hlg, mpeg2]) assert.equal(action(tv, v), "copy", JSON.stringify(v));
  });
  it("copies HDR10 untouched, and says why", () => {
    const d = decidePlayback(tv, hdr10);
    assert.equal(d.action, "copy");
    assert.match(d.reason, /HDR/);
  });
  it("Dolby Vision profile 8: passes the HDR10 base layer, strips the DV layers", () => {
    const d = decidePlayback(tv, dv8);
    assert.equal(d.action, "copy");
    assert.equal(d.stripDolbyVision, true);
  });
  it("Dolby Vision profile 5 has no base layer: transcode", () => {
    assert.equal(decidePlayback(tv, dv5).action, "transcode");
  });
  it("a 80 Mbps remux is above the ceiling: transcode", () => {
    const d = decidePlayback(tv, remux80);
    assert.equal(d.action, "transcode");
    assert.match(d.reason, /80 Mbps/);
  });
  it("AV1 can't ride in MPEG-TS: transcode", () => {
    assert.equal(action(tv, av1), "transcode");
  });
  it("audio passes through only when it is already stereo AAC", () => {
    assert.equal(decidePlayback(tv, h264).copyAudio, true);
    assert.equal(decidePlayback(tv, { ...h264, audioChannels: 6 }).copyAudio, false);
    assert.equal(decidePlayback(tv, mpeg2).copyAudio, false);
  });
  it("copy=0 retry always transcodes", () => {
    assert.equal(decidePlayback(forced, h264).action, "transcode");
    assert.match(decidePlayback(forced, h264).reason, /copy=0/);
  });
  it("an HDR-less TV transcodes HDR (and DV 8) but copies SDR 10-bit", () => {
    const sdrTv = { ...tv, hdr: false };
    assert.equal(action(sdrTv, hdr10), "transcode");
    assert.equal(action(sdrTv, dv8), "transcode");
    assert.equal(action(sdrTv, hevc10sdr), "copy");
  });
  it("a TV that decodes Dolby Vision keeps the layers", () => {
    const dvTv = { ...tv, dv: true };
    const d = decidePlayback(dvTv, dv5);
    assert.equal(d.action, "copy");
    assert.equal(d.stripDolbyVision, false);
    assert.equal(decidePlayback(dvTv, dv8).stripDolbyVision, false);
  });
});

describe("decidePlayback: browser", () => {
  it("H.264 8-bit SDR plays directly", () => {
    assert.equal(action(browser, h264), "copy");
    assert.equal(action(browser, mpeg2), "transcode");
  });
  it("everything else is a GPU transcode", () => {
    for (const v of [hevc8, hevc10sdr, hdr10, dv8, av1, h264hi10]) assert.equal(action(browser, v), "transcode", JSON.stringify(v));
  });
  it("unknown source format: can't be trusted, transcode", () => {
    assert.equal(action(browser, undefined), "transcode");
  });
});

describe("decidePlayback: generic IPTV clients", () => {
  it("known players take HEVC 10-bit SDR but get HDR tone-mapped", () => {
    assert.equal(action(player, hevc10sdr), "copy");
    assert.equal(action(player, hdr10), "transcode");
    assert.equal(action(player, dv8), "transcode");
  });
  it("an unknown client is safe: H.264 / HEVC 8-bit copy; 10-bit and HDR transcode", () => {
    assert.equal(action(generic, h264), "copy");
    assert.equal(action(generic, hevc8), "copy");
    assert.equal(action(generic, hevc10sdr), "transcode");
    assert.equal(action(generic, hdr10), "transcode");
    assert.equal(action(generic, undefined), "transcode");
  });
  it("copy=1 from an unknown app: same as before (8-bit, SDR, <=25 Mbps); unknown source is copied", () => {
    assert.equal(action(legacy, hevc8), "copy");
    assert.equal(action(legacy, hevc10sdr), "transcode");
    assert.equal(action(legacy, { ...h264, bitrateKbps: 30000 }), "transcode");
    assert.equal(action(legacy, undefined), "copy");
  });
});

describe("decidePlayback: declared caps", () => {
  it("transcodes only what the declaration leaves out", () => {
    const c = parseCapsDeclaration("h264,hevc,hevc10,maxh=1080,maxkbps=20000")!;
    assert.equal(action(c, hevc10sdr), "transcode"); // 2160p > 1080p
    assert.equal(action(c, { ...hevc10sdr, height: 1080, bitrateKbps: 12000 }), "copy");
    assert.equal(action(c, { ...hevc10sdr, height: 1080, colorTrc: "smpte2084" }), "transcode"); // no hdr declared
  });
});

describe("decidePlayback: server limits", () => {
  it("transcoding disabled in settings: always passes through", () => {
    assert.equal(decidePlayback(browser, hdr10, { transcodingEnabled: false }).action, "copy");
    assert.equal(decidePlayback(forced, h264, { transcodingEnabled: false }).action, "copy");
  });
  it("transcode slots full: pass through anyway, unless MPEG-TS can't carry the codec", () => {
    assert.equal(passThroughAnyway(hdr10, "slots full").action, "copy");
    assert.equal(passThroughAnyway(av1, "slots full").action, "transcode");
  });
});
