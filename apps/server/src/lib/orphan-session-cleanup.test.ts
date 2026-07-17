import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { PassThrough } from "stream";
import { SharedLiveTranscodePool } from "./shared-live-transcode";
import { streamMonitorService } from "./stream-monitor-service";

describe("orphan session idle cleanup", () => {
  it("does not treat FFmpeg output as client activity", () => {
    const sessionId = streamMonitorService.createSession(9, {
      ratingKey: "rk-orphan",
    });
    const created = streamMonitorService.getSession(sessionId)!;
    const createdAt = created.lastActivity.getTime();

    // Simulate encoder churn that previously kept orphans alive forever
    streamMonitorService.updateOutputActivity(sessionId);
    streamMonitorService.updateOutputActivity(sessionId);
    streamMonitorService.setFfmpegProcess(sessionId, {
      pid: 12345,
      kill: () => undefined,
    } as any);

    const after = streamMonitorService.getSession(sessionId)!;
    assert.equal(after.lastActivity.getTime(), createdAt);
    assert.ok(after.lastOutputTimestamp.getTime() >= createdAt);

    streamMonitorService.dropSession(sessionId);
  });
});

describe("SharedLiveTranscodePool destroyed viewers", () => {
  let pool: SharedLiveTranscodePool;

  beforeEach(() => {
    pool = SharedLiveTranscodePool.getInstance();
    pool.resetForTests();
  });

  it("releases viewers whose passthrough already ended", () => {
    const pass = new PassThrough();
    const hub = pool.createHub({
      channelNumber: 3,
      ratingKey: "300",
      ownerSessionId: "gone",
      streamUrl: "http://example",
      seekSeconds: 0,
      passthrough: pass,
    });
    let killed = false;
    pool.attachFfmpeg(hub, {
      kill: () => {
        killed = true;
      },
      stdout: new PassThrough(),
    } as any);

    pass.end();
    const released = pool.releaseDestroyedViewers();
    assert.deepEqual(released, ["gone"]);
    assert.equal(killed, true);
    assert.equal(pool.findLiveHub(3, "300"), undefined);
  });
});
