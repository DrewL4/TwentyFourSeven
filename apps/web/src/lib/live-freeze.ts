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

/**
 * What mpegts.js reports about the video track each time it builds a video
 * init segment (its MEDIA_INFO event). A different picture size or codec
 * configuration in the middle of a live stream is the exact case Chrome cannot
 * continue, so the player restarts at once instead of waiting for the freeze.
 * Audio-only changes (48k -> 44.1k) play fine and are ignored.
 */
export type LiveVideoConfig = {
  width?: number;
  height?: number;
  videoCodec?: string;
  sarNum?: number;
  sarDen?: number;
};

export function videoConfigChanged(previous: LiveVideoConfig | null, next: LiveVideoConfig): boolean {
  if (!previous) return false;
  const same = <K extends keyof LiveVideoConfig>(key: K) => previous[key] === next[key];
  // Ignore reports that do not describe the video yet.
  if (next.width == null || next.height == null) return false;
  return !(same('width') && same('height') && same('videoCodec') && same('sarNum') && same('sarDen'));
}
