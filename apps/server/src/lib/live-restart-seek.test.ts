import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resumeSeekSeconds,
  streamMonitorService,
} from "./stream-monitor-service";
import { streamRecoveryService } from "./stream-recovery-service";

/**
 * 24/7 stutter: every mid-program FFmpeg respawn (encoder step-down, copy
 * failure, stderr-triggered recovery) re-seeked to the offset the FIRST spawn
 * started at. The show jumped back by however long it had been playing, then
 * played on behind the schedule on a fresh MPEG-TS timeline.
 */
describe("live respawn resumes at the live position", () => {
  it("advances a live seek by the wall-clock time since it was anchored", () => {
    const base = { seekSeconds: 100, seekAnchorMs: 1_000_000, sharedLive: true };
    assert.equal(resumeSeekSeconds(base, 1_000_000), 100);
    assert.equal(resumeSeekSeconds(base, 1_000_000 + 30_900), 130);
    assert.equal(resumeSeekSeconds(base, 1_000_000 - 5_000), 100);
  });

  it("leaves catchup (viewer-paced) seeks alone", () => {
    const base = { seekSeconds: 100, seekAnchorMs: 1_000_000, sharedLive: false };
    assert.equal(resumeSeekSeconds(base, 1_000_000 + 60_000), 100);
  });

  it("re-anchors when the seek is replaced (program handoff)", () => {
    const id = streamMonitorService.createSession(77, { ratingKey: "rk-a" }, undefined, {
      sharedLive: true,
    });
    streamMonitorService.updateSessionMetadata(id, { seekSeconds: 600 });
    const s = streamMonitorService.getSession(id)!;
    s.seekAnchorMs -= 45_000; // pretend 45 s of playback
    assert.equal(resumeSeekSeconds(s), 645);
    streamMonitorService.updateSessionMetadata(id, { seekSeconds: 0 });
    assert.equal(resumeSeekSeconds(streamMonitorService.getSession(id)!), 0);
    streamMonitorService.removeSession?.(id);
  });

  it("recovery respawns at the live position, not the original offset", async () => {
    const id = streamMonitorService.createSession(78, { ratingKey: "rk-b" }, undefined, {
      sharedLive: true,
    });
    streamMonitorService.updateSessionMetadata(id, {
      streamUrl: "http://plex.invalid/x",
      seekSeconds: 600,
    });
    streamMonitorService.getSession(id)!.seekAnchorMs -= 90_000;
    let seen = -1;
    await streamRecoveryService.attemptRecovery(id, "ECONNRESET timeout", async (_u, seek) => {
      seen = seek;
      throw new Error("stop before spawn");
    });
    assert.ok(seen >= 690 && seen <= 692, `expected ~690, got ${seen}`);
    streamMonitorService.removeSession?.(id);
  });
});
