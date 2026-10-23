import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed links for anything TwentyFourSeven hands to a browser, IPTV app or
 * HDHomeRun client: streams, guide images and local artwork.
 *
 * - Short-lived tokens (`t=`): HMAC over scope + resource + subject + expiry.
 *   A token for one channel or image does not open another.
 * - Player keys (`k=`): one per device, revocable. The secret is an HMAC of
 *   the key id, so the database only stores the id and revocation state.
 *
 * Keys are derived from BETTER_AUTH_SECRET (start.sh creates and keeps it in
 * /app/database), so restarts do not break links but a new secret does.
 */

export type LinkScope = "video" | "image" | "guide";

export type LinkCheck =
  | { ok: true; sub: string; exp: number }
  | { ok: false; reason: "malformed" | "tampered" | "expired" | "wrong-link" };

let cachedKey: { secret: string; key: Buffer } | null = null;

function linkKey(secret = process.env.BETTER_AUTH_SECRET || ""): Buffer {
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is not set; cannot sign links");
  }
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = createHmac("sha256", secret).update("tfs-links-v1").digest();
  cachedKey = { secret, key };
  return key;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function mac(data: string, secret?: string): Buffer {
  return createHmac("sha256", linkKey(secret)).update(data).digest();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Sign `resource` (e.g. "ch:5" or "img:movie:abc") for `sub` (user or key id). */
export function signLink(
  scope: LinkScope,
  resource: string,
  sub: string,
  ttlSeconds: number,
  opts: { now?: number; secret?: string } = {},
): string {
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + Math.max(1, Math.floor(ttlSeconds));
  const body = b64url(JSON.stringify({ s: scope, r: resource, u: sub, e: exp }));
  return `${body}.${b64url(mac(`v1.${body}`, opts.secret).subarray(0, 18))}`;
}

export function verifyLink(
  token: string | null | undefined,
  scope: LinkScope,
  resource: string,
  opts: { now?: number; secret?: string } = {},
): LinkCheck {
  if (!token || token.length > 1024) return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  let sig: Buffer;
  try {
    sig = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!safeEqual(sig, mac(`v1.${body}`, opts.secret).subarray(0, 18))) {
    return { ok: false, reason: "tampered" };
  }
  let payload: { s?: unknown; r?: unknown; u?: unknown; e?: unknown };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.s !== scope || payload.r !== resource || typeof payload.u !== "string") {
    return { ok: false, reason: "wrong-link" };
  }
  const exp = typeof payload.e === "number" ? payload.e : 0;
  if (exp * 1000 <= (opts.now ?? Date.now())) return { ok: false, reason: "expired" };
  return { ok: true, sub: payload.u, exp };
}

const KEY_PREFIX = "pk1";

/** The secret a device puts in its M3U / HDHomeRun URLs (`k=`). */
export function playerKeySecret(id: string, secret?: string): string {
  return `${KEY_PREFIX}_${id}_${b64url(mac(`key.${id}`, secret).subarray(0, 18))}`;
}

/** Returns the key id when the secret is genuine (revocation is checked by the caller). */
export function parsePlayerKeySecret(value: string | null | undefined, secret?: string): string | null {
  if (!value || value.length > 200) return null;
  const parts = value.split("_");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX || !/^[a-z0-9]{8,40}$/i.test(parts[1])) return null;
  const expected = Buffer.from(playerKeySecret(parts[1], secret));
  return safeEqual(Buffer.from(value), expected) ? parts[1] : null;
}

/** Fails per client address; blocks an address that keeps sending bad links. */
export class FailureLimiter {
  private readonly hits = new Map<string, { count: number; first: number; blockedUntil: number }>();

  constructor(
    private readonly maxFailures = 20,
    private readonly windowMs = 10 * 60_000,
    private readonly blockMs = 10 * 60_000,
  ) {}

  isBlocked(ip: string, now = Date.now()): boolean {
    const row = this.hits.get(ip);
    return !!row && row.blockedUntil > now;
  }

  recordFailure(ip: string, now = Date.now()): void {
    let row = this.hits.get(ip);
    if (!row || now - row.first > this.windowMs) {
      row = { count: 0, first: now, blockedUntil: row?.blockedUntil ?? 0 };
    }
    row.count += 1;
    if (row.count >= this.maxFailures) {
      row.blockedUntil = now + this.blockMs;
      row.count = 0;
      row.first = now;
    }
    this.hits.set(ip, row);
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (v.blockedUntil <= now && now - v.first > this.windowMs) this.hits.delete(k);
      }
    }
  }
}

export function isPrivateAddress(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]"));
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1" || ip === "localhost") return true;
  if (ip.includes(":")) {
    return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
  }
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

type HeaderBag = { get(name: string): string | null };

/**
 * The address of the real viewer. Trust X-Forwarded-For only when the hop
 * that reached us is private (our nginx, or a reverse proxy on the LAN), and
 * walk it from the right so a client cannot pretend to be on the LAN by
 * sending its own X-Forwarded-For.
 */
export function clientAddress(headers: HeaderBag): string {
  const realIp = headers.get("x-real-ip")?.trim() || "";
  const chain = (headers.get("x-forwarded-for") || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (realIp && !isPrivateAddress(realIp)) return realIp;
  // nginx appends $remote_addr (== realIp) last; skip trusted private hops.
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isPrivateAddress(chain[i])) return chain[i];
  }
  return realIp || chain[0] || "unknown";
}

const SEAL_PREFIX = "pl1.";

function sealKey(secret?: string): Buffer {
  return createHmac("sha256", linkKey(secret)).update("tfs-login-seal-v1").digest();
}

/**
 * A playlist login (username + password) packed into an opaque link key, so the
 * stream and image links we hand out never carry the password in clear text.
 * Every use is checked again against the login, so removing access still works.
 */
export function sealLogin(login: { username: string; password: string }, secret?: string): string {
  // Same login -> same link, so players that remember a base URL keep working.
  const iv = createHmac("sha256", sealKey(secret)).update(`iv\0${login.username}\0${login.password}`).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify([login.username, login.password]), "utf8"), cipher.final()]);
  return SEAL_PREFIX + b64url(Buffer.concat([iv, cipher.getAuthTag(), body]));
}

export function isSealedLogin(value: string | null | undefined): boolean {
  return !!value && value.startsWith(SEAL_PREFIX);
}

export function openSealedLogin(value: string | null | undefined, secret?: string): { username: string; password: string } | null {
  if (!value || !value.startsWith(SEAL_PREFIX) || value.length > 1024) return null;
  try {
    const raw = Buffer.from(value.slice(SEAL_PREFIX.length), "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", sealKey(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") return null;
    return { username: parsed[0], password: parsed[1] };
  } catch {
    return null;
  }
}
