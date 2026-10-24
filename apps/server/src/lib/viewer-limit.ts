/**
 * Per-person 24/7 stream limit (on top of Settings.concurrentStreams, which
 * stays the whole-server cap that protects the GPU).
 *
 *  - Linked to ESPG: a person may run as many 24/7 streams as they have free TV
 *    connections, plus one extra that only 24/7 can use:
 *        allowed = max(0, TV connections - TV streams playing) + 1
 *    No TV service = one 24/7 stream. ESPG supplies the TV numbers.
 *  - On its own: the per-person limit on the admin Playlist logins page
 *    (default 2).
 *
 * A "person" is known from a playlist login, a link signed for them (ESPG's
 * per-viewer links, /live links) or a signed-in browser. Device keys and the
 * home network don't say who is watching, so only the server cap applies.
 */

export const EXTRA_247_STREAMS = 1;
export const DEFAULT_STANDALONE_STREAMS = 2;
export const MAX_STANDALONE_STREAMS = 50;

export function streamsAllowed(tvConnections: number, tvActive: number): number {
  const tv = Math.max(0, Math.floor(Number(tvConnections) || 0));
  const playing = Math.max(0, Math.floor(Number(tvActive) || 0));
  return Math.max(0, tv - playing) + EXTRA_247_STREAMS;
}

export type ViewerRef = { email: string | null; userId: string | null };

/** Who is asking, from the parts of a player check. null = nobody in particular. */
export function viewerFromAuth(a: { via: string; userId: string | null; email?: string | null; sub?: string | null }): ViewerRef | null {
  const email = (a.email || "").trim().toLowerCase() || null;
  if (a.via === "login" || a.via === "session") {
    return a.userId || email ? { email, userId: a.userId } : null;
  }
  if (a.via === "token") {
    const sub = a.sub || "";
    if (sub.startsWith("espg:") || sub.startsWith("viewer:")) {
      const e = sub.slice(sub.indexOf(":") + 1).trim().toLowerCase();
      return e ? { email: e, userId: null } : null;
    }
    if (sub.startsWith("user:")) return { email, userId: sub.slice(5) || null };
  }
  return null;
}

/** The key sessions are tagged with: the e-mail when known (it joins ESPG and 24/7), else the user id. */
export function viewerKey(v: { email: string | null; userId: string | null }): string | null {
  if (v.email) return `email:${v.email.toLowerCase()}`;
  if (v.userId) return `user:${v.userId}`;
  return null;
}

export type ViewerSessionRef = { viewer?: string | null; channelNumber: number; clientIp?: string };

/**
 * This person's 24/7 streams now. A player re-opening the same channel from
 * the same address (a reconnect) doesn't count against itself.
 */
export function countViewerStreams(
  sessions: ViewerSessionRef[],
  key: string,
  opening?: { channelNumber: number; clientIp?: string },
): number {
  return sessions.filter((s) => {
    if (s.viewer !== key) return false;
    if (opening && opening.clientIp && s.clientIp === opening.clientIp && s.channelNumber === opening.channelNumber) return false;
    return true;
  }).length;
}

export type ViewerLimit = {
  allowed: number;
  /** Plain words for the refusal. */
  how: string;
};

export function viewerLimitMessage(limit: ViewerLimit, active: number): string {
  return `24/7 stream limit reached: you're already watching ${active} of ${limit.allowed} allowed (${limit.how}). Stop one and try again.`;
}

export function shouldRefuseViewer(active: number, limit: ViewerLimit | null): boolean {
  return !!limit && active >= limit.allowed;
}

export function linkedLimit(answer: { tvConnections: number; tvActive: number } | null): ViewerLimit {
  if (!answer) return { allowed: EXTRA_247_STREAMS, how: "ESPG couldn't be asked about your TV services, so just the one 24/7 stream" };
  const allowed = streamsAllowed(answer.tvConnections, answer.tvActive);
  if (answer.tvConnections <= 0) return { allowed, how: "no TV service, so one 24/7 stream" };
  return {
    allowed,
    how: `${answer.tvConnections} TV connection${answer.tvConnections === 1 ? "" : "s"}, ${answer.tvActive} in use, plus 1 for 24/7`,
  };
}

export function standaloneLimit(maxStreams: number | null | undefined): ViewerLimit {
  const n = Number.isFinite(maxStreams as number) && (maxStreams as number) >= 0 ? Math.floor(maxStreams as number) : DEFAULT_STANDALONE_STREAMS;
  return { allowed: n, how: `your limit is ${n}` };
}

// --- app wiring -------------------------------------------------------------

const emailCache = new Map<string, { at: number; email: string | null }>();

/** Fill in the e-mail from the user id (so ESPG links and logins land on the same person). */
export async function resolveViewer(v: ViewerRef): Promise<ViewerRef> {
  if (v.email || !v.userId) return v;
  const hit = emailCache.get(v.userId);
  if (hit && Date.now() - hit.at < 60_000) return { ...v, email: hit.email };
  const { prisma } = await import("./prisma");
  const row = await prisma.user.findUnique({ where: { id: v.userId }, select: { email: true } });
  const email = row?.email ? row.email.toLowerCase() : null;
  emailCache.set(v.userId, { at: Date.now(), email });
  return { ...v, email };
}

/** This person's limit right now, by mode. */
export async function limitForViewer(v: ViewerRef): Promise<ViewerLimit> {
  const pl = await import("./playlist-login");
  const s = await pl.loginSettings();
  if (s.mode === "espg") {
    return linkedLimit(v.email ? await pl.playlistLogins.allowance(v.email) : null);
  }
  const { prisma } = await import("./prisma");
  let userId = v.userId;
  if (!userId && v.email) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT _id AS id FROM user WHERE lower(email) = ${v.email} LIMIT 1`;
    userId = rows[0]?.id ?? null;
  }
  const row = userId ? await prisma.playlistLogin.findUnique({ where: { userId }, select: { maxStreams: true } }) : null;
  return standaloneLimit(row?.maxStreams);
}
