import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLiveFfmpegArgs } from "./ffmpeg-live-args";
import { copyRemuxBlocker, describeRemoteVideo } from "./local-media/playback";
import { plexVideoInfo } from "./plex";

// Shape of Plex's /library/metadata/<id> JSON for a 4K UHD remux.
const uhdRemux = {
  videoCodec: "hevc",
  videoProfile: "main 10",
  height: 2160,
  bitrate: 62_000,
  audioCodec: "truehd",
  audioChannels: 8,
  videoDynamicRange: "HDR",
  Part: [{
    key: "/library/parts/1/file.mkv",
    Stream: [
      { streamType: 1, codec: "hevc", bitDepth: 10, colorTrc: "smpte2084", DOVIPresent: true },
      { streamType: 2, codec: "truehd", channels: 8 },
      { streamType: 3, codec: "pgs" },
    ],
  }],
};
const hd = {
  videoCodec: "h264", videoProfile: "high", height: 1080, bitrate: 9_000, audioCodec: "ac3", audioChannels: 6,
  Part: [{ Stream: [{ streamType: 1, codec: "h264", bitDepth: 8 }] }],
};

test("reads codec facts from Plex metadata", () => {
  const info = plexVideoInfo(uhdRemux)!;
  assert.equal(info.videoCodec, "hevc");
  assert.equal(info.bitDepth, 10);
  assert.equal(info.colorTrc, "smpte2084");
  assert.equal(info.dolbyVision, true);
  assert.equal(info.bitrateKbps, 62_000);
  assert.equal(describeRemoteVideo(info), "hevc main 10 10-bit smpte2084 dv 2160p 62mbps truehd 8ch");
  assert.equal(plexVideoInfo(undefined), undefined);
});

test("copy=1 is transcoded for video a TV player can't take as-is", () => {
  assert.equal(copyRemuxBlocker(plexVideoInfo(uhdRemux)), "Dolby Vision video");
  assert.equal(copyRemuxBlocker({ videoCodec: "hevc", bitDepth: 10 }), "10-bit video");
  assert.equal(copyRemuxBlocker({ videoCodec: "hevc", videoProfile: "main 10" }), "10-bit video");
  assert.equal(copyRemuxBlocker({ videoCodec: "hevc", bitDepth: 8, colorTrc: "arib-std-b67" }), "HDR video");
  assert.equal(copyRemuxBlocker({ videoCodec: "h264", bitDepth: 8, bitrateKbps: 40_000 }), "40 Mbps is too high to pass through");
  assert.match(copyRemuxBlocker({ videoCodec: "vc1" })!, /vc1/);
});

test("copy=1 is honoured for ordinary HD and when Plex says nothing", () => {
  assert.equal(copyRemuxBlocker(plexVideoInfo(hd)), null);
  assert.equal(copyRemuxBlocker({ videoCodec: "hevc", videoProfile: "main", bitDepth: 8, bitrateKbps: 8_000 }), null);
  assert.equal(copyRemuxBlocker(undefined), null);
  assert.equal(copyRemuxBlocker({}), null);
  assert.equal(copyRemuxBlocker({ videoCodec: "h264", bitrateKbps: 40_000 }, 0), null, "0 turns the bitrate check off");
});

test("transcodes take only the main video and audio, in 8-bit, with 2 s keyframes", () => {
  const sw = buildLiveFfmpegArgs("http://plex/file.mkv", 30, { enableTranscoding: true, videoCodec: "libx264" }, { mode: "software" });
  const map = sw.slice(sw.indexOf("-map"), sw.indexOf("-map") + 6);
  assert.deepEqual(map, ["-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn"]);
  assert.ok(sw.indexOf("-map") > sw.indexOf("-i"));
  assert.equal(sw[sw.indexOf("-vf") + 1], "format=yuv420p|nv12");
  assert.equal(sw[sw.indexOf("-g") + 1], "60");

  const nvenc = buildLiveFfmpegArgs("http://plex/file.mkv", 30, { enableTranscoding: true, videoCodec: "h264_nvenc" }, { mode: "hardware" });
  assert.equal(nvenc[nvenc.indexOf("-vf") + 1], "format=yuv420p|nv12", "10-bit frames are made 8-bit before h264_nvenc");

  const gpu = buildLiveFfmpegArgs("http://plex/file.mkv", 30, { enableTranscoding: true, videoCodec: "h264_nvenc" }, { mode: "hardware" }, { gpuFrames: true });
  assert.equal(gpu[gpu.indexOf("-vf") + 1], "scale_cuda=format=nv12");

  const own = buildLiveFfmpegArgs("http://plex/file.mkv", 30, { enableTranscoding: true, videoCodec: "libx264", outputOptions: "-map 0:1 -map 0:2 -g 24" }, { mode: "software" });
  assert.equal(own.filter((a) => a === "0:v:0").length, 0, "user's own -map wins");
  assert.equal(own.filter((a) => a === "-g").length, 1, "user's own -g wins");
});

test("Dolby Vision profile from Plex (DOVIProfile)", () => {
  const p5 = { videoCodec: "hevc", Part: [{ Stream: [{ streamType: 1, codec: "hevc", bitDepth: 10, DOVIPresent: true, DOVIProfile: 5 }] }] };
  assert.equal(plexVideoInfo(p5)!.dolbyVisionProfile, 5);
  assert.equal(plexVideoInfo(hd)!.dolbyVisionProfile, null);
});
