/**
 * Keeps one MPEG-TS timeline running across FFmpeg respawns.
 *
 * Every FFmpeg we start for a live channel writes timestamps from ~0. When the
 * next program (or a recovery respawn) is spliced onto the same HTTP stream the
 * viewer's player (mpegts.js) sees time go backwards. It drops every sample
 * until the new timestamps pass the old maximum, so the picture freezes and the
 * audio goes silent for as long as the previous program had been playing, then
 * resumes mid-show. `-output_ts_offset` moves the next FFmpeg onto the end of
 * the previous output.
 *
 * The end is read from the bytes we actually sent (PES PTS/DTS), because the
 * muxer's `out_time` lags the last packet by about a second with video copy.
 */

const TS_PACKET = 188;
const PTS_WRAP = 2 ** 33;
const CLOCK = 90_000;
/** Gap left between the end of the old timeline and the first new packet. */
const JOIN_PAD_SECONDS = 0.05;

export class TsTimeline {
  private carry: Buffer = Buffer.alloc(0);
  private synced = false;
  private lastRaw: number | null = null;
  private unwrapped = 0;
  /** Largest PTS/DTS written so far, in seconds on the unwrapped timeline. */
  private maxSeconds: number | null = null;

  push(chunk: Buffer): void {
    const data = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    let i = 0;
    if (!this.synced) {
      // Find a run of 0x47 sync bytes one packet apart.
      while (i + TS_PACKET * 2 < data.length) {
        if (data[i] === 0x47 && data[i + TS_PACKET] === 0x47 && data[i + TS_PACKET * 2] === 0x47) {
          this.synced = true;
          break;
        }
        i += 1;
      }
      if (!this.synced) {
        this.carry = data.subarray(Math.max(0, data.length - TS_PACKET * 3));
        return;
      }
    }
    while (i + TS_PACKET <= data.length) {
      if (data[i] !== 0x47) {
        // Lost alignment (a new FFmpeg started mid-packet): resync.
        this.synced = false;
        this.carry = data.subarray(i + 1);
        return;
      }
      this.readPacket(data, i);
      i += TS_PACKET;
    }
    this.carry = Buffer.from(data.subarray(i));
  }

  private readPacket(buf: Buffer, at: number): void {
    const pusi = (buf[at + 1] & 0x40) !== 0;
    if (!pusi) return;
    const afc = (buf[at + 3] >> 4) & 0x3;
    if (!(afc & 0x1)) return;
    let p = at + 4;
    if (afc & 0x2) p += 1 + buf[at + 4];
    if (p + 14 > at + TS_PACKET) return;
    if (buf[p] !== 0 || buf[p + 1] !== 0 || buf[p + 2] !== 1) return;
    const streamId = buf[p + 3];
    const isVideo = streamId >= 0xe0 && streamId <= 0xef;
    const isAudio = streamId >= 0xc0 && streamId <= 0xdf;
    if (!isVideo && !isAudio) return;
    const ptsDtsFlags = (buf[p + 7] >> 6) & 0x3;
    if (ptsDtsFlags < 2) return;
    this.note(readTimestamp(buf, p + 9));
    if (ptsDtsFlags === 3) this.note(readTimestamp(buf, p + 14));
  }

  private note(raw: number): void {
    if (this.lastRaw !== null) {
      let delta = raw - this.lastRaw;
      if (delta > PTS_WRAP / 2) delta -= PTS_WRAP;
      else if (delta < -PTS_WRAP / 2) delta += PTS_WRAP;
      this.unwrapped += delta;
    } else {
      this.unwrapped = raw;
    }
    this.lastRaw = raw;
    const seconds = this.unwrapped / CLOCK;
    if (this.maxSeconds === null || seconds > this.maxSeconds) {
      this.maxSeconds = seconds;
    }
  }

  /** Seconds the output has reached, or null before any media was seen. */
  endSeconds(): number | null {
    return this.maxSeconds;
  }

  /** A new FFmpeg writes to the same stream: forget any half-read packet. */
  startNextOutput(): void {
    this.carry = Buffer.alloc(0);
    this.synced = false;
  }

  /** `-output_ts_offset` for the next FFmpeg, or null for the very first one. */
  nextOffsetSeconds(): number | null {
    if (this.maxSeconds === null) return null;
    return Math.round((this.maxSeconds + JOIN_PAD_SECONDS) * 1000) / 1000;
  }
}

function readTimestamp(buf: Buffer, at: number): number {
  const hi = (buf[at] >> 1) & 0x7;
  const mid = (buf[at + 1] << 7) | (buf[at + 2] >> 1);
  const lo = (buf[at + 3] << 7) | (buf[at + 4] >> 1);
  return hi * 2 ** 30 + mid * 2 ** 15 + lo;
}
