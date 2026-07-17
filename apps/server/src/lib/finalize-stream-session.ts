import { streamMonitorService } from "./stream-monitor-service";
import { streamRecoveryService } from "./stream-recovery-service";
import { sharedLiveTranscodePool } from "./shared-live-transcode";

/** Remove monitor/recovery state and optionally kill FFmpeg for a stream session. */
export function finalizeStreamSession(
  sessionId: string,
  options?: { killFfmpeg?: boolean },
): void {
  const poolResult = sharedLiveTranscodePool.releaseViewer(sessionId);

  if (poolResult.wasInPool) {
    // Shared live hub owns the FFmpeg process; only drop session metadata here.
    streamMonitorService.dropSession(sessionId);
  } else if (options?.killFfmpeg !== false) {
    streamMonitorService.removeSession(sessionId);
  } else {
    streamMonitorService.dropSession(sessionId);
  }

  streamRecoveryService.cleanup(sessionId);
}
