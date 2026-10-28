/**
 * Live picture frozen while data keeps arriving.
 *
 * Chrome cannot continue a stream when the next program changes picture size
 * (640x272 -> 640x268): the new data is buffered but never decoded and the
 * playhead stops. A normal network stall has no data ahead of the playhead.
 */
export type LivePlaybackSample = {
  paused: boolean;
  ended: boolean;
  currentTime: number;
  previousTime: number;
  readyState: number;
  /** Seconds of buffered video after the playhead. */
  bufferedAhead: number;
};

export const FREEZE_MIN_AHEAD_SECONDS = 2;
export const FREEZE_TICKS_BEFORE_RESTART = 4;

export function isLivePictureFrozen(s: LivePlaybackSample): boolean {
  return (
    !s.paused &&
    !s.ended &&
    s.currentTime > 0.25 &&
    s.readyState <= 2 &&
    s.bufferedAhead > FREEZE_MIN_AHEAD_SECONDS &&
    Math.abs(s.currentTime - s.previousTime) < 0.05
  );
}
