import { streamMonitorService } from "./stream-monitor-service";
import { streamRecoveryService } from "./stream-recovery-service";

/** Remove monitor/recovery state and optionally kill FFmpeg for a stream session. */
export function finalizeStreamSession(
  sessionId: string,
  options?: { killFfmpeg?: boolean },
): void {
  if (options?.killFfmpeg !== false) {
    streamMonitorService.removeSession(sessionId);
  } else {
    streamMonitorService.dropSession(sessionId);
  }
  streamRecoveryService.cleanup(sessionId);
}
