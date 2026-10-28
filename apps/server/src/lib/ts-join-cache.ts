/**
 * Lets a player that joins a live MPEG-TS hub start picture at once.
 *
 * A joiner used to receive bytes from the middle of a GOP and wait for the
 * next keyframe (2 s apart in most files) before the first frame. When the
 * player restarts at a program handoff, that wait also threw away the first
 * 2 s of the new program. This keeps the PAT, the PMT and every packet since
 * the latest video keyframe, so a joiner gets a clean, decodable start.
 *
 * Nothing is re-encoded: it only remembers bytes FFmpeg already wrote.
 */

const TS_PACKET = 188;
/** Above this, the cache gives up until the next keyframe (very high bitrate). */
export const JOIN_CACHE_MAX_BYTES = 6 * 1024 * 1024;

const VIDEO_STREAM_TYPES = new Set([0x01, 0x02, 0x1b, 0x24, 0x10, 0x33]);

export class TsJoinCache {
  private carry: Buffer = Buffer.alloc(0);
  private synced = false;
  private pat: Buffer | null = null;
  private pmt: Buffer | null = null;
  private pmtPid: number | null = null;
  private videoPid: number | null = null;
  private gop: Buffer[] = [];
  private gopBytes = 0;
  private inGop = false;

  push(chunk: Buffer): void {
    const data = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    let i = 0;
    if (!this.synced) {
      while (i + TS_PACKET * 2 < data.length) {
        if (data[i] === 0x47 && data[i + TS_PACKET] === 0x47 && data[i + TS_PACKET * 2] === 0x47) {
          this.synced = true;
          break;
        }
        i += 1;
      }
      if (!this.synced) {
        this.carry = Buffer.from(data.subarray(Math.max(0, data.length - TS_PACKET * 3)));
        return;
      }
    }
    // Packets from `keep` onward belong to the current GOP.
    let keep = this.inGop ? i : -1;
    while (i + TS_PACKET <= data.length) {
      if (data[i] !== 0x47) {
        this.synced = false;
        this.flushGop(data, keep, i);
        this.reset();
        this.carry = Buffer.from(data.subarray(i + 1));
        return;
      }
      const isKeyframe = this.readPacket(data, i);
      if (isKeyframe) {
        // Close the old GOP up to here and start a new one at this packet.
        this.flushGop(data, keep, i);
        this.gop = [];
        this.gopBytes = 0;
        this.inGop = true;
        keep = i;
      }
      i += TS_PACKET;
    }
    this.flushGop(data, keep, i);
    this.carry = i < data.length ? Buffer.from(data.subarray(i)) : Buffer.alloc(0);
  }

  private flushGop(data: Buffer, from: number, to: number): void {
    if (from < 0 || !this.inGop || to <= from) return;
    const part = Buffer.from(data.subarray(from, to));
    this.gop.push(part);
    this.gopBytes += part.length;
    if (this.gopBytes > JOIN_CACHE_MAX_BYTES) {
      this.gop = [];
      this.gopBytes = 0;
      this.inGop = false;
    }
  }

  /** Returns true when this packet starts a video keyframe. */
  private readPacket(buf: Buffer, at: number): boolean {
    const pid = ((buf[at + 1] & 0x1f) << 8) | buf[at + 2];
    const pusi = (buf[at + 1] & 0x40) !== 0;
    if (pid === 0 && pusi) {
      this.pat = Buffer.from(buf.subarray(at, at + TS_PACKET));
      this.readPat(buf, at);
      return false;
    }
    if (this.pmtPid !== null && pid === this.pmtPid && pusi) {
      this.pmt = Buffer.from(buf.subarray(at, at + TS_PACKET));
      this.readPmt(buf, at);
      return false;
    }
    if (this.videoPid !== null && pid === this.videoPid && pusi) {
      const afc = (buf[at + 3] >> 4) & 0x3;
      if ((afc & 0x2) && buf[at + 4] > 0 && (buf[at + 5] & 0x40) !== 0) {
        return true;
      }
    }
    return false;
  }

  private payloadStart(buf: Buffer, at: number): number {
    const afc = (buf[at + 3] >> 4) & 0x3;
    let p = at + 4;
    if (afc & 0x2) p += 1 + buf[at + 4];
    return p + 1 + buf[p]; // skip the pointer field
  }

  private readPat(buf: Buffer, at: number): void {
    const t = this.payloadStart(buf, at);
    if (t + 12 > at + TS_PACKET || buf[t] !== 0x00) return;
    const sectionLength = ((buf[t + 1] & 0x0f) << 8) | buf[t + 2];
    const end = Math.min(t + 3 + sectionLength - 4, at + TS_PACKET);
    for (let p = t + 8; p + 4 <= end; p += 4) {
      const program = (buf[p] << 8) | buf[p + 1];
      if (program !== 0) {
        this.pmtPid = ((buf[p + 2] & 0x1f) << 8) | buf[p + 3];
        return;
      }
    }
  }

  private readPmt(buf: Buffer, at: number): void {
    const t = this.payloadStart(buf, at);
    if (t + 12 > at + TS_PACKET || buf[t] !== 0x02) return;
    const sectionLength = ((buf[t + 1] & 0x0f) << 8) | buf[t + 2];
    const end = Math.min(t + 3 + sectionLength - 4, at + TS_PACKET);
    const infoLength = ((buf[t + 10] & 0x0f) << 8) | buf[t + 11];
    for (let p = t + 12 + infoLength; p + 5 <= end; ) {
      const streamType = buf[p];
      const pid = ((buf[p + 1] & 0x1f) << 8) | buf[p + 2];
      if (VIDEO_STREAM_TYPES.has(streamType)) {
        if (this.videoPid !== pid) {
          this.videoPid = pid;
          this.gop = [];
          this.gopBytes = 0;
          this.inGop = false;
        }
        return;
      }
      p += 5 + (((buf[p + 3] & 0x0f) << 8) | buf[p + 4]);
    }
  }

  /** Bytes a new viewer should receive first, or null when not ready yet. */
  primer(): Buffer | null {
    if (!this.inGop || !this.pat || !this.pmt || this.gop.length === 0) return null;
    return Buffer.concat([this.pat, this.pmt, ...this.gop]);
  }

  reset(): void {
    this.carry = Buffer.alloc(0);
    this.synced = false;
    this.pat = null;
    this.pmt = null;
    this.pmtPid = null;
    this.videoPid = null;
    this.gop = [];
    this.gopBytes = 0;
    this.inGop = false;
  }
}
