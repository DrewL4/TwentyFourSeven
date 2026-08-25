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

  it("does not reclaim a live joiner whose HTTP passthrough is still open", async () => {
    const pool = SharedLiveTranscodePool.getInstance();
    pool.resetForTests();

    const ownerPass = new PassThrough();
    const joinerPass = new PassThrough();
    const ownerId = streamMonitorService.createSession(
      4,
      { ratingKey: "ep1" },
      undefined,
      { sharedLive: true },
    );
    const joinerId = streamMonitorService.createSession(
      4,
      { ratingKey: "ep1" },
      undefined,
      { sharedLive: true },
    );

    await pool.joinOrCreateLiveHub({
      channelNumber: 4,
      ratingKey: "ep1",
      sessionId: ownerId,
      streamUrl: "http://example/a",
      seekSeconds: 0,
      passthrough: ownerPass,
    });
    await pool.joinOrCreateLiveHub({
      channelNumber: 4,
      ratingKey: "ep1",
      sessionId: joinerId,
      streamUrl: "http://example/a",
      seekSeconds: 0,
      passthrough: joinerPass,
    });

    const joiner = streamMonitorService.getSession(joinerId)!;
    joiner.lastActivity = new Date(Date.now() - 180_000);

    const cleaned = streamMonitorService.cleanupStaleSessions();
    assert.equal(streamMonitorService.getSession(joinerId)?.sessionId, joinerId);
    assert.ok(cleaned >= 0);

    pool.dissolveHub(pool.getHubForSession(ownerId)!, { killFfmpeg: false });
    streamMonitorService.dropSession(ownerId);
    streamMonitorService.dropSession(joinerId);
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
