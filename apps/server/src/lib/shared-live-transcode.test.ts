import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { PassThrough } from "stream";
import {
  SharedLiveTranscodePool,
  createMpegTsNullPacket,
} from "./shared-live-transcode";

describe("SharedLiveTranscodePool", () => {
  let pool: SharedLiveTranscodePool;

  beforeEach(() => {
    pool = SharedLiveTranscodePool.getInstance();
    pool.resetForTests();
  });

  it("emits a valid MPEG-TS null packet", () => {
    const packet = createMpegTsNullPacket();
    assert.equal(packet.length, 188);
    assert.equal(packet[0], 0x47);
    assert.equal((packet[1] << 8 | packet[2]) & 0x1fff, 0x1fff);
  });

  it("shares one hub key per live channel and encode mode", () => {
    assert.equal(pool.getLiveShareKey(5, "rk1"), "5:live:transcode");
    assert.equal(pool.getLiveShareKey(5, "rk2"), "5:live:transcode");
    assert.equal(pool.getLiveShareKey(5, "rk1", true), "5:live:copy");
    assert.equal(pool.getLiveShareKey(5, "rk1", false, true), "5:live:browser");
    assert.notEqual(
      pool.getLiveShareKey(5, "rk1", false),
      pool.getLiveShareKey(5, "rk1", true),
    );
  });

  it("lets a second viewer join while FFmpeg is not attached yet", async () => {
    const ownerPass = new PassThrough();
    const first = await pool.joinOrCreateLiveHub({
      channelNumber: 9,
      ratingKey: "ep1",
      sessionId: "owner",
      streamUrl: "http://example/a",
      seekSeconds: 0,
      passthrough: ownerPass,
    });
    assert.equal(first.shouldStartFfmpeg, true);

    const joinerPass = new PassThrough();
    const second = await pool.joinOrCreateLiveHub({
      channelNumber: 9,
      ratingKey: "ep1",
      sessionId: "joiner",
      streamUrl: "http://example/a",
      seekSeconds: 0,
      passthrough: joinerPass,
    });
    assert.equal(second.shouldStartFfmpeg, false);
    assert.equal(second.hub, first.hub);
    assert.equal(first.hub.viewers.size, 2);
    pool.dissolveHub(first.hub, { killFfmpeg: false });
  });

  it("keeps copy and transcode viewers on separate hubs", async () => {
    const copyPass = new PassThrough();
    const copyJoin = await pool.joinOrCreateLiveHub({
      channelNumber: 3,
      ratingKey: "ep1",
      sessionId: "copy-owner",
      streamUrl: "http://example/a",
      seekSeconds: 0,
      passthrough: copyPass,
      copy: true,
    });
    assert.equal(copyJoin.shouldStartFfmpeg, true);
    assert.equal(copyJoin.hub.copy, true);
    assert.equal(copyJoin.hub.key, "3:live:copy");

    const transPass = new PassThrough();
    const transJoin = await pool.joinOrCreateLiveHub({
      channelNumber: 3,
      ratingKey: "ep1",
      sessionId: "trans-owner",
      streamUrl: "http://example/a",
      seekSeconds: 0,
      passthrough: transPass,
      copy: false,
    });
    assert.equal(transJoin.shouldStartFfmpeg, true);
    assert.equal(transJoin.hub.copy, false);
    assert.notEqual(transJoin.hub, copyJoin.hub);

    const copyJoinerPass = new PassThrough();
    const copyJoiner = await pool.joinOrCreateLiveHub({
      channelNumber: 3,
      ratingKey: "ep1",
      sessionId: "copy-joiner",
      streamUrl: "http://example/poison",
      seekSeconds: 0,
      passthrough: copyJoinerPass,
      copy: true,
    });
    assert.equal(copyJoiner.shouldStartFfmpeg, false);
    assert.equal(copyJoiner.hub, copyJoin.hub);
    assert.equal(copyJoin.hub.viewers.size, 2);
    assert.equal(transJoin.hub.viewers.size, 1);

    pool.dissolveHub(copyJoin.hub, { killFfmpeg: false });
    pool.dissolveHub(transJoin.hub, { killFfmpeg: false });
  });

  it("fans out viewers on the same hub and kills FFmpeg only on last leave", () => {
    const ownerPass = new PassThrough();
    const hub = pool.createHub({
      channelNumber: 1,
      ratingKey: "100",
      ownerSessionId: "owner",
      streamUrl: "http://example/stream",
      seekSeconds: 10,
      passthrough: ownerPass,
    });

    let killed = false;
    const fakeFfmpeg = {
      kill: () => {
        killed = true;
      },
      stdout: new PassThrough(),
    } as any;

    pool.attachFfmpeg(hub, fakeFfmpeg);

    const joinerPass = new PassThrough();
    pool.addViewer(hub, "joiner", joinerPass);
    assert.equal(hub.viewers.size, 2);

    const firstLeave = pool.releaseViewer("owner");
    assert.equal(firstLeave.wasInPool, true);
    assert.equal(firstLeave.killedFfmpeg, false);
    assert.equal(killed, false);
    assert.equal(hub.ownerSessionId, "joiner");
    assert.equal(hub.viewers.size, 1);

    const lastLeave = pool.releaseViewer("joiner");
    assert.equal(lastLeave.killedFfmpeg, true);
    assert.equal(killed, true);
    assert.equal(pool.findLiveHub(1, "100"), undefined);
  });

  it("broadcasts chunks to all attached viewers", async () => {
    const a = new PassThrough();
    const b = new PassThrough();
    const hub = pool.createHub({
      channelNumber: 2,
      ratingKey: "200",
      ownerSessionId: "a",
      streamUrl: "http://example/stream",
      seekSeconds: 0,
      passthrough: a,
    });
    pool.addViewer(hub, "b", b);

    const stdout = new PassThrough();
    pool.attachFfmpeg(hub, { kill: () => undefined, stdout } as any);

    const received: Buffer[] = [];
    b.on("data", (chunk) => received.push(Buffer.from(chunk)));

    stdout.write(Buffer.from("ts-packet"));
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(Buffer.concat(received).toString(), "ts-packet");
    pool.releaseViewer("a");
    pool.releaseViewer("b");
  });

  it("pauses copy remux on backpressure instead of dropping the viewer", () => {
    const pass = new PassThrough({ highWaterMark: 16 });
    const hub = pool.createHub({
      channelNumber: 11,
      ratingKey: "1100",
      ownerSessionId: "owner",
      streamUrl: "http://example/stream",
      seekSeconds: 0,
      passthrough: pass,
      copy: true,
    });
    const stdout = new PassThrough();
    pool.attachFfmpeg(hub, { kill: () => undefined, stdout } as any);
    stdout.write(Buffer.alloc(64 * 1024, 0x47));
    stdout.write(Buffer.alloc(64 * 1024, 0x47));
    assert.equal(pass.destroyed, false);
    pool.dissolveHub(hub, { killFfmpeg: false });
  });

  it("does not overwrite hub streamUrl when a late joiner attaches", async () => {
    const ownerPass = new PassThrough();
    const first = await pool.joinOrCreateLiveHub({
      channelNumber: 4,
      ratingKey: "ep1",
      sessionId: "owner",
      streamUrl: "http://example/original",
      seekSeconds: 42,
      passthrough: ownerPass,
    });

    const joinerPass = new PassThrough();
    await pool.joinOrCreateLiveHub({
      channelNumber: 4,
      ratingKey: "ep2",
      sessionId: "joiner",
      streamUrl: "http://example/joiner-poison",
      seekSeconds: 0,
      passthrough: joinerPass,
    });

    assert.equal(first.hub.streamUrl, "http://example/original");
    assert.equal(first.hub.seekSeconds, 42);
    assert.equal(first.hub.ratingKey, "ep1");
    pool.dissolveHub(first.hub, { killFfmpeg: false });
  });

  it("stuffs MPEG-TS null packets during an encoder gap", async () => {
    const pass = new PassThrough();
    const hub = pool.createHub({
      channelNumber: 8,
      ratingKey: "800",
      ownerSessionId: "owner",
      streamUrl: "http://example/stream",
      seekSeconds: 0,
      passthrough: pass,
    });

    const received: Buffer[] = [];
    pass.on("data", (chunk) => received.push(Buffer.from(chunk)));
    pool.beginEncoderGap(hub);
    await new Promise((r) => setTimeout(r, 80));
    pool.dissolveHub(hub, { killFfmpeg: false });

    const bytes = Buffer.concat(received);
    assert.ok(bytes.length >= 188);
    assert.equal(bytes[0], 0x47);
    assert.equal(bytes[1], 0x1f);
    assert.equal(bytes[2], 0xff);
  });
});
