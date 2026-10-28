import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "stream";
import type { ChildProcess } from "child_process";
import { TsJoinCache, JOIN_CACHE_MAX_BYTES } from "./ts-join-cache";
import { SharedLiveTranscodePool } from "./shared-live-transcode";

const PMT_PID = 0x1000;
const VIDEO_PID = 0x100;
const AUDIO_PID = 0x101;

function packet(pid: number, pusi: boolean, opts: { rai?: boolean; payload?: number[]; tag?: number } = {}): Buffer {
  const b = Buffer.alloc(188, 0xff);
  b[0] = 0x47;
  b[1] = (pusi ? 0x40 : 0) | ((pid >> 8) & 0x1f);
  b[2] = pid & 0xff;
  let p = 4;
  if (opts.rai) {
    b[3] = 0x30;
    b[4] = 7;
    b[5] = 0x40;
    p = 5 + 7;
  } else {
    b[3] = 0x10;
  }
  const payload = opts.payload ?? [];
  for (let i = 0; i < payload.length; i++) b[p + i] = payload[i];
  if (opts.tag !== undefined) b[187] = opts.tag;
  return b;
}

const pat = () => packet(0, true, { payload: [0, 0x00, 0xb0, 0x0d, 0, 1, 0xc1, 0, 0, 0, 1, 0xe0 | (PMT_PID >> 8), PMT_PID & 0xff, 0, 0, 0, 0] });
const pmt = () =>
  packet(PMT_PID, true, {
    payload: [
      0, 0x02, 0xb0, 0x17, 0, 1, 0xc1, 0, 0, 0xe0 | (VIDEO_PID >> 8), VIDEO_PID & 0xff, 0xf0, 0,
      0x1b, 0xe0 | (VIDEO_PID >> 8), VIDEO_PID & 0xff, 0xf0, 0,
      0x0f, 0xe0 | (AUDIO_PID >> 8), AUDIO_PID & 0xff, 0xf0, 0,
      0, 0, 0, 0,
    ],
  });
const key = (tag: number) => packet(VIDEO_PID, true, { rai: true, tag });
const frame = (tag: number) => packet(VIDEO_PID, true, { tag });
const audio = (tag: number) => packet(AUDIO_PID, true, { rai: true, tag });

describe("TsJoinCache", () => {
  it("has no primer before a keyframe", () => {
    const cache = new TsJoinCache();
    cache.push(Buffer.concat([pat(), pmt(), frame(1)]));
    assert.equal(cache.primer(), null);
  });

  it("primer is PAT + PMT + everything since the latest video keyframe", () => {
    const cache = new TsJoinCache();
    cache.push(Buffer.concat([pat(), pmt(), key(1), frame(2), audio(3)]));
    cache.push(Buffer.concat([pat(), pmt(), key(4), frame(5), audio(6)]));
    const primer = cache.primer()!;
    assert.equal(primer.length % 188, 0);
    const tags = [];
    for (let i = 0; i < primer.length; i += 188) tags.push([primer[i + 1] & 0x1f ? ((primer[i + 1] & 0x1f) << 8) | primer[i + 2] : 0, primer[i + 187]]);
    // PAT, PMT, then keyframe 4 and what followed (pat/pmt repeats, frame 5, audio 6).
    assert.equal(tags[0][0], 0);
    assert.equal(tags[1][0], PMT_PID);
    const firstMedia = tags.find(([pid]) => pid === VIDEO_PID)!;
    assert.equal(firstMedia[1], 4);
    assert.ok(!tags.some(([, tag]) => tag === 1 || tag === 2 || tag === 3));
    assert.ok(tags.some(([, tag]) => tag === 6));
  });

  it("audio random-access flags do not count as keyframes", () => {
    const cache = new TsJoinCache();
    cache.push(Buffer.concat([pat(), pmt(), key(1), audio(2), audio(3)]));
    const primer = cache.primer()!;
    assert.equal(primer[2 + 188 * 2 + 0] !== undefined, true);
    // Only the original GOP starting at keyframe 1.
    assert.equal(primer.length, 188 * 5);
  });

  it("copes with chunks that split packets", () => {
    const whole = Buffer.concat([pat(), pmt(), key(1), frame(2), key(3), frame(4)]);
    const a = new TsJoinCache();
    a.push(whole);
    const b = new TsJoinCache();
    for (let i = 0; i < whole.length; i += 97) b.push(whole.subarray(i, i + 97));
    assert.deepEqual(b.primer(), a.primer());
  });

  it("gives up on a huge GOP until the next keyframe", () => {
    const cache = new TsJoinCache();
    cache.push(Buffer.concat([pat(), pmt(), key(1)]));
    const filler = frame(2);
    const count = Math.ceil(JOIN_CACHE_MAX_BYTES / 188) + 2;
    for (let i = 0; i < count; i += 1000) {
      cache.push(Buffer.concat(Array.from({ length: Math.min(1000, count - i) }, () => filler)));
    }
    assert.equal(cache.primer(), null);
    cache.push(key(9));
    assert.ok(cache.primer());
  });

  it("reset drops everything", () => {
    const cache = new TsJoinCache();
    cache.push(Buffer.concat([pat(), pmt(), key(1)]));
    cache.reset();
    assert.equal(cache.primer(), null);
  });
});

describe("hub join primer", () => {
  function fakeChild() {
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    (child as unknown as { stdout: PassThrough }).stdout = new PassThrough();
    return child;
  }

  it("a viewer joining mid-GOP first receives the latest keyframe, then live bytes", async () => {
    const pool = SharedLiveTranscodePool.getInstance();
    pool.resetForTests();
    const ownerPass = new PassThrough();
    const { hub } = await pool.joinOrCreateLiveHub({
      channelNumber: 71, ratingKey: "a", sessionId: "owner", streamUrl: "u", seekSeconds: 0, passthrough: ownerPass, copy: true,
    });
    const child = fakeChild();
    pool.attachFfmpeg(hub, child);
    const out = (child as unknown as { stdout: PassThrough }).stdout;
    out.write(Buffer.concat([pat(), pmt(), key(1), frame(2), key(3), frame(4)]));
    await new Promise((r) => setImmediate(r));

    const joinerPass = new PassThrough();
    pool.addViewer(hub, "joiner", joinerPass);
    out.write(frame(5));
    await new Promise((r) => setImmediate(r));
    const got = joinerPass.read() as Buffer;
    const tags: number[] = [];
    for (let i = 0; i < got.length; i += 188) tags.push(got[i + 187]);
    assert.equal(((got[1] & 0x1f) << 8) | got[2], 0, "starts with PAT");
    const media = tags.filter((t) => t !== 0xff);
    assert.deepEqual(media, [3, 4, 5]);

    // Handoff gap: the old stream's tail must not be handed to a joiner.
    pool.beginEncoderGap(hub);
    const lateJoiner = new PassThrough();
    pool.addViewer(hub, "late", lateJoiner);
    assert.equal(lateJoiner.read(), null);
    pool.resetForTests();
  });
});
