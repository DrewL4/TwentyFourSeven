export interface TranscodeSessionRef {
  channelNumber: number;
  programInfo: { ratingKey: string };
  /** Live 24/7 hub is one transcode per channel across episode handoffs. */
  sharedLive?: boolean;
}

/** Stable identity for one channel+program transcode (shared by multiple viewers). */
export function getTranscodeKey(
  channelNumber: number,
  ratingKey: string,
  sharedLive = false,
): string {
  if (sharedLive) {
    return `${channelNumber}:live`;
  }
  return `${channelNumber}:${ratingKey}`;
}

/** Count distinct channel/program transcodes, not viewer connections. */
export function countActiveTranscodes(sessions: TranscodeSessionRef[]): number {
  const keys = new Set(
    sessions.map((session) =>
      getTranscodeKey(
        session.channelNumber,
        session.programInfo.ratingKey,
        session.sharedLive === true,
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
): boolean {
  if (isUnlimitedConcurrentStreams(concurrentStreamsLimit)) {
    return false;
  }

  const incomingKey = getTranscodeKey(channelNumber, ratingKey, sharedLive);
  const activeKeys = new Set(
    activeSessions.map((session) =>
      getTranscodeKey(
        session.channelNumber,
        session.programInfo.ratingKey,
        session.sharedLive === true,
      ),
    ),
  );
  if (activeKeys.has(incomingKey)) {
    return false;
  }
  return isStreamCapacityReached(activeKeys.size, concurrentStreamsLimit);
}
