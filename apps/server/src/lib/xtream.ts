import { createHash } from "node:crypto";

/**
 * Xtream Codes answers (player_api.php) built from TwentyFourSeven channels.
 * Pure helpers so they can be tested without a database.
 */

export type XtreamChannel = {
  number: number;
  name: string;
  groupTitle: string | null;
  icon?: string | null;
  createdAt?: Date;
};

export type XtreamProgram = { id: string; startTime: Date; durationMs: number; title: string; description: string };

const NO_GROUP = "TwentyFourSeven";

/** A stable numeric id per group name, so categories keep their id as channels are added. */
export function categoryId(group: string | null | undefined): string {
  const name = (group || "").trim() || NO_GROUP;
  return String(parseInt(createHash("sha1").update(name).digest("hex").slice(0, 7), 16));
}

export function liveCategories(channels: XtreamChannel[]) {
  const seen = new Map<string, string>();
  for (const c of channels) {
    const name = (c.groupTitle || "").trim() || NO_GROUP;
    if (!seen.has(name)) seen.set(name, categoryId(name));
  }
  return [...seen.entries()].map(([category_name, category_id]) => ({ category_id, category_name, parent_id: 0 }));
}

export function liveStreams(channels: XtreamChannel[], icon: (c: XtreamChannel) => string, categoryFilter?: string | null) {
  return channels
    .map((c, i) => ({
      num: i + 1,
      name: c.name,
      stream_type: "live",
      stream_id: c.number,
      stream_icon: icon(c),
      epg_channel_id: c.name, // same id as the XMLTV guide (xmltv.php)
      added: String(Math.floor((c.createdAt?.getTime() ?? 0) / 1000)),
      is_adult: 0,
      category_id: categoryId(c.groupTitle),
      category_ids: [Number(categoryId(c.groupTitle))],
      custom_sid: "",
      tv_archive: 0,
      direct_source: "",
      tv_archive_duration: 0,
    }))
    .filter((s) => !categoryFilter || s.category_id === categoryFilter);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
/** Xtream EPG times: "YYYY-MM-DD HH:MM:SS" in UTC (server_info.timezone is UTC). */
export function xtreamTime(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export function epgListings(channel: XtreamChannel, programs: XtreamProgram[], now: Date, withPlaying = false) {
  return programs.map((p) => {
    const start = p.startTime;
    const end = new Date(start.getTime() + p.durationMs);
    const row: Record<string, unknown> = {
      id: p.id,
      epg_id: p.id,
      title: b64(p.title),
      lang: "en",
      start: xtreamTime(start),
      end: xtreamTime(end),
      description: b64(p.description),
      channel_id: channel.name,
      start_timestamp: String(Math.floor(start.getTime() / 1000)),
      stop_timestamp: String(Math.floor(end.getTime() / 1000)),
    };
    if (withPlaying) {
      row.now_playing = start <= now && now < end ? 1 : 0;
      row.has_archive = 0;
    }
    return row;
  });
}

/** maxConnections: this person's 24/7 stream allowance (see viewer-limit); 1 when it can't be worked out. */
export function userInfo(login: { username: string; password: string }, now: Date, maxConnections = 1) {
  const max = Number.isInteger(maxConnections) && maxConnections >= 0 ? maxConnections : 1;
  return {
    username: login.username,
    password: login.password,
    message: "TwentyFourSeven",
    auth: 1,
    status: "Active",
    exp_date: null,
    is_trial: "0",
    active_cons: "0",
    created_at: String(Math.floor(now.getTime() / 1000)),
    max_connections: String(max),
    allowed_output_formats: ["ts", "m3u8"],
  };
}

export function serverInfo(baseUrl: string, now: Date) {
  const u = new URL(baseUrl);
  const https = u.protocol === "https:";
  const port = u.port || (https ? "443" : "80");
  return {
    url: u.hostname,
    port: https ? "80" : port,
    https_port: https ? port : "443",
    server_protocol: https ? "https" : "http",
    rtmp_port: "0",
    timezone: "UTC",
    timestamp_now: Math.floor(now.getTime() / 1000),
    time_now: xtreamTime(now),
    process: true,
  };
}

/** /live/<user>/<pass>/<id>.ts → the channel number, or null. */
export function parseLiveStream(segment: string): { channel: number; ext: "ts" | "m3u8" } | null {
  const m = /^(\d{1,6})(?:\.(ts|m3u8))?$/.exec(segment);
  if (!m) return null;
  return { channel: Number(m[1]), ext: (m[2] as "ts" | "m3u8") || "ts" };
}
