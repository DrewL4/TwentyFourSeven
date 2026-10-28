import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { buildCopyFfmpegArgs, buildLiveFfmpegArgs } from "./ffmpeg-live-args";
import { TsTimeline } from "./ts-timeline";

/** One TS packet holding the start of a PES packet with a PTS (and optional DTS). */
function pesPacket(pid: number, streamId: number, pts: number, dts?: number): Buffer {
  const pkt = Buffer.alloc(188, 0xff);
  pkt[0] = 0x47;
  pkt[1] = 0x40 | ((pid >> 8) & 0x1f);
  pkt[2] = pid & 0xff;
  pkt[3] = 0x10; // payload only
  const stamp = (prefix: number, v: number) => {
    const b = Buffer.alloc(5);
    b[0] = (prefix << 4) | ((Math.floor(v / 2 ** 30) & 0x7) << 1) | 1;
    const mid = Math.floor(v / 2 ** 15) & 0x7fff;
    b[1] = mid >> 7;
    b[2] = ((mid & 0x7f) << 1) | 1;
    const lo = v % 2 ** 15;
    b[3] = lo >> 7;
    b[4] = ((lo & 0x7f) << 1) | 1;
    return b;
  };
  const hasDts = dts !== undefined;
  const header = [0, 0, 1, streamId, 0, 0, 0x80, hasDts ? 0xc0 : 0x80, hasDts ? 10 : 5];
  const body = hasDts ? Buffer.concat([stamp(3, pts), stamp(1, dts)]) : stamp(2, pts);
  Buffer.from([...header]).copy(pkt, 4);
  body.copy(pkt, 4 + header.length);
  return pkt;
}

const sec = (s: number) => Math.round(s * 90_000);

describe("TsTimeline reads the end of what FFmpeg wrote", () => {
  it("has no offset before any media", () => {
    assert.equal(new TsTimeline().nextOffsetSeconds(), null);
  });

  it("tracks the largest PTS/DTS across video and audio", () => {
    const t = new TsTimeline();
    t.push(
      Buffer.concat([
        pesPacket(0x100, 0xe0, sec(25.0), sec(24.9)),
        pesPacket(0x101, 0xc0, sec(26.07)),
        pesPacket(0x100, 0xe0, sec(26.0), sec(25.9)),
      ]),
    );
    assert.equal(t.endSeconds(), 26.07);
    assert.equal(t.nextOffsetSeconds(), 26.12);
  });

  it("copes with packets split across chunks", () => {
    const t = new TsTimeline();
    const all = Buffer.concat([
      pesPacket(0x100, 0xe0, sec(1), sec(1)),
      pesPacket(0x100, 0xe0, sec(2), sec(2)),
      pesPacket(0x100, 0xe0, sec(3), sec(3)),
      pesPacket(0x100, 0xe0, sec(4), sec(4)),
    ]);
    for (let i = 0; i < all.length; i += 100) t.push(all.subarray(i, i + 100));
    assert.equal(t.endSeconds(), 4);
  });

  it("keeps counting through the 33-bit PTS wrap", () => {
    const t = new TsTimeline();
    const nearWrap = 2 ** 33 - sec(1);
    t.push(Buffer.concat([pesPacket(0x100, 0xe0, nearWrap - sec(1), nearWrap - sec(1)), pesPacket(0x100, 0xe0, nearWrap, nearWrap), pesPacket(0x100, 0xe0, sec(1), sec(1))]));
    assert.ok(Math.abs(t.endSeconds()! - (2 ** 33 + sec(1)) / 90_000) < 0.001);
  });

  it("forgets a half-read packet when the next FFmpeg starts", () => {
    const t = new TsTimeline();
    t.push(Buffer.concat([pesPacket(0x100, 0xe0, sec(5), sec(5)), pesPacket(0x100, 0xe0, sec(6), sec(6)), pesPacket(0x100, 0xe0, sec(7), sec(7))]).subarray(0, 188 * 3 - 50));
    t.startNextOutput();
    t.push(Buffer.concat([pesPacket(0x100, 0xe0, sec(8), sec(8)), pesPacket(0x100, 0xe0, sec(9), sec(9)), pesPacket(0x100, 0xe0, sec(10), sec(10))]));
    assert.equal(t.endSeconds(), 10);
  });

  it("matches the real PTS of an FFmpeg MPEG-TS stream", { skip: spawnSync("ffmpeg", ["-version"]).status !== 0 }, () => {
    const run = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24", "-f", "lavfi", "-i", "sine", "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-f", "mpegts", "-"],
      { maxBuffer: 20_000_000 },
    );
    assert.equal(run.status, 0);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "packet=pts_time,dts_time", "-of", "csv=p=0", "-"], { input: run.stdout, maxBuffer: 20_000_000 });
    const probed = probe.stdout
      .toString()
      .split(/\s+/)
      .flatMap((l) => l.split(","))
      .map(Number)
      .filter((n) => Number.isFinite(n));
    const t = new TsTimeline();
    t.push(run.stdout);
    // Packets whose PES start is in the last bytes of the buffer are still read; allow one audio frame.
    assert.ok(Math.abs(t.endSeconds()! - Math.max(...probed)) < 0.05, `${t.endSeconds()} vs ${Math.max(...probed)}`);
  });
});

describe("a respawn continues the previous timeline", () => {
  it("copy args carry -output_ts_offset before the muxer options", () => {
    const args = buildCopyFfmpegArgs("/m/a.mkv", 0, { discontinuity: true, outputTsOffset: 26.12 });
    const at = args.indexOf("-output_ts_offset");
    assert.ok(at > 0 && at < args.indexOf("-f"));
    assert.equal(args[at + 1], "26.120");
    assert.ok(args.includes("+resend_headers+initial_discontinuity"));
  });

  it("first spawn has no offset", () => {
    assert.ok(!buildCopyFfmpegArgs("/m/a.mkv", 0, { outputTsOffset: null }).includes("-output_ts_offset"));
    assert.ok(!buildCopyFfmpegArgs("/m/a.mkv", 0, { outputTsOffset: 0 }).includes("-output_ts_offset"));
  });

  it("transcode args carry it too", () => {
    const args = buildLiveFfmpegArgs("/m/a.mkv", 0, null, { mode: "software", browser: true, discontinuity: true, outputTsOffset: 90.5 });
    const at = args.indexOf("-output_ts_offset");
    assert.ok(at > 0 && at < args.indexOf("-f"));
    assert.equal(args[at + 1], "90.500");
  });
});
