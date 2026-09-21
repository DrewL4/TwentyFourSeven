export interface TranscodeSessionRef {
  channelNumber: number;
  programInfo: { ratingKey: string };
  /** Live 24/7 hub is one transcode per channel across episode handoffs. */
  sharedLive?: boolean;
  /** `copy=1` remux — does not consume a concurrent-streams slot. */
  copyRemux?: boolean;
}

/** Stable identity for one channel+program transcode (shared by multiple viewers). */
export function getTranscodeKey(
  channelNumber: number,
  ratingKey: string,
  sharedLive = false,
  copyRemux = false,
): string {
  if (copyRemux) {
    return `${channelNumber}:live:copy`;
  }
  if (sharedLive) {
    return `${channelNumber}:live`;
  }
  return `${channelNumber}:${ratingKey}`;
}

/** Count distinct channel/program transcodes, not viewer connections or remuxes. */
export function countActiveTranscodes(sessions: TranscodeSessionRef[]): number {
  const keys = new Set(
    sessions
      .filter((session) => session.copyRemux !== true)
      .map((session) =>
        getTranscodeKey(
          session.channelNumber,
          session.programInfo.ratingKey,
          session.sharedLive === true,
          false,
        ),
      ),
  );
  return keys.size;
}

/** 0 = unlimited — no concurrent-stream cap. */
export function isUnlimitedConcurrentStreams(
  concurrentStreamsLimit: number,
): boolean {
  return concurrentStreamsLimit <= 0;
}

/** Returns true when another stream must be rejected (503). */
export function isStreamCapacityReached(
  activeTranscodeCount: number,
  concurrentStreamsLimit: number,
): boolean {
  if (isUnlimitedConcurrentStreams(concurrentStreamsLimit)) {
    return false;
  }
  return activeTranscodeCount >= concurrentStreamsLimit;
}

/**
 * Reject only when starting a new transcode would exceed the limit.
 * Additional viewers on an already-active channel/program are always allowed.
 */
export function shouldRejectNewTranscode(
  activeSessions: TranscodeSessionRef[],
  channelNumber: number,
  ratingKey: string,
  concurrentStreamsLimit: number,
  sharedLive = false,
  copyRemux = false,
): boolean {
  if (copyRemux || isUnlimitedConcurrentStreams(concurrentStreamsLimit)) {
    return false;
  }

  const incomingKey = getTranscodeKey(channelNumber, ratingKey, sharedLive, false);
  const activeKeys = new Set(
    activeSessions
      .filter((session) => session.copyRemux !== true)
      .map((session) =>
        getTranscodeKey(
          session.channelNumber,
          session.programInfo.ratingKey,
          session.sharedLive === true,
          false,
        ),
      ),
  );
  if (activeKeys.has(incomingKey)) {
    return false;
  }
  return isStreamCapacityReached(activeKeys.size, concurrentStreamsLimit);
}
