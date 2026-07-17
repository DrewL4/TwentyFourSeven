import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { PassThrough } from "stream";
import { SharedLiveTranscodePool } from "./shared-live-transcode";

describe("SharedLiveTranscodePool", () => {
  let pool: SharedLiveTranscodePool;

  beforeEach(() => {
    pool = SharedLiveTranscodePool.getInstance();
    pool.resetForTests();
  });

  it("shares one hub key per live channel+program", () => {
    assert.equal(pool.getLiveShareKey(5, "rk1"), "5:rk1:live");
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
});
