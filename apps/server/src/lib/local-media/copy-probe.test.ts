import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalCopyProbe, videoInfoFromFfprobe, videoInfoFromLocalProbe } from "./copy-probe";
import { copyRemuxBlocker } from "./playback";

const hdr10 = {
  streams: [
    { codec_type: "video", codec_name: "hevc", profile: "Main 10", pix_fmt: "yuv420p10le", color_transfer: "smpte2084", height: 2160 },
    { codec_type: "audio", codec_name: "eac3", channels: 6 },
  ],
  format: { bit_rate: "48000000" },
};
const sdr = {
  streams: [{ codec_type: "video", codec_name: "h264", profile: "High", pix_fmt: "yuv420p", bits_per_raw_sample: "8", color_transfer: "bt709", height: 1080, bit_rate: "6000000" }],
};

test("local 10-bit HDR file: copy=1 is refused (transcode instead)", () => {
  const info = videoInfoFromFfprobe(hdr10);
  assert.equal(info?.bitDepth, 10);
  assert.equal(info?.bitrateKbps, 48000);
  assert.equal(copyRemuxBlocker(info), "10-bit video");
});

test("local Dolby Vision, 8-bit HDR and very high bitrate files are refused; plain 8-bit H.264 copies", () => {
  const dv = { streams: [{ codec_type: "video", codec_name: "hevc", pix_fmt: "yuv420p", side_data_list: [{ side_data_type: "DOVI configuration record" }] }] };
  assert.equal(copyRemuxBlocker(videoInfoFromFfprobe(dv)), "Dolby Vision video");
  const hlg8 = { streams: [{ codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", color_transfer: "arib-std-b67" }] };
  assert.equal(copyRemuxBlocker(videoInfoFromFfprobe(hlg8)), "HDR video");
  const big = { streams: [{ codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p" }], format: { bit_rate: "60000000" } };
  assert.match(copyRemuxBlocker(videoInfoFromFfprobe(big)) ?? "", /60 Mbps/);
  assert.equal(copyRemuxBlocker(videoInfoFromFfprobe(sdr)), null);
  const vp9 = { streams: [{ codec_type: "video", codec_name: "vp9", pix_fmt: "yuv420p" }] };
  assert.match(copyRemuxBlocker(videoInfoFromFfprobe(vp9)) ?? "", /vp9/);
});

test("the library scan's stored probe already catches 10-bit without ffprobe", () => {
  assert.equal(copyRemuxBlocker(videoInfoFromLocalProbe({ videoCodec: "hevc", pixFmt: "yuv420p10le" })), "10-bit video");
  assert.equal(copyRemuxBlocker(videoInfoFromLocalProbe({ videoCodec: "h264", pixFmt: "yuv420p" })), null);
  assert.equal(videoInfoFromLocalProbe({ videoCodec: "hevc", pixFmt: "p010le" })?.bitDepth, 10);
  assert.equal(videoInfoFromLocalProbe(null), undefined);
});

test("ffprobe runs once per file and again only when the file changes", async () => {
  let mtime = 1000;
  let calls = 0;
  const p = createLocalCopyProbe({
    probe: async () => { calls++; return hdr10; },
    stat: async () => ({ size: 10, mtimeMs: mtime }),
    max: 10,
  });
  const [a, b] = await Promise.all([p.videoInfo("/m/a.mkv"), p.videoInfo("/m/a.mkv")]);
  await p.videoInfo("/m/a.mkv");
  assert.equal(calls, 1);
  assert.equal(a?.bitDepth, 10);
  assert.deepEqual(a, b);
  mtime = 2000;
  await p.videoInfo("/m/a.mkv");
  assert.equal(calls, 2);
});

test("a failed ffprobe falls back to the stored probe and is retried next play", async () => {
  let calls = 0;
  const p = createLocalCopyProbe({
    probe: async () => { calls++; throw new Error("timeout"); },
    stat: async () => ({ size: 10, mtimeMs: 1 }),
    max: 10,
  });
  const info = await p.videoInfo("/m/b.mkv", { videoCodec: "hevc", pixFmt: "yuv420p10le" });
  assert.equal(copyRemuxBlocker(info), "10-bit video");
  await p.videoInfo("/m/b.mkv");
  assert.equal(calls, 2);
  const missing = createLocalCopyProbe({ probe: async () => hdr10, stat: async () => { throw new Error("ENOENT"); }, max: 10 });
  assert.equal(await missing.videoInfo("/gone.mkv"), undefined);
});

test("the cache is bounded", async () => {
  let calls = 0;
  const p = createLocalCopyProbe({ probe: async () => { calls++; return sdr; }, stat: async () => ({ size: 1, mtimeMs: 1 }), max: 2 });
  for (const f of ["/1", "/2", "/3", "/1"]) await p.videoInfo(f);
  assert.equal(calls, 4);
});
