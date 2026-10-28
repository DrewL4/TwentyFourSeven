import { prisma } from './prisma';
import type { PageData, PageUser, StreamLimit, UserPageStore } from './user-page-door';

const MAX_FRANCHISES = 100;
const MAX_CHANNELS_PER_FRANCHISE = 50;
const MAX_VIEWING = 30;

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

async function streamLimit(user: PageUser): Promise<StreamLimit> {
  const { loginSettings } = await import('./playlist-login');
  const [settings, login] = await Promise.all([
    loginSettings(),
    prisma.playlistLogin.findUnique({ where: { userId: user.id }, select: { username: true, maxStreams: true } }),
  ]);
  const linked = settings.mode === 'espg';
  return {
    has_login: !!login,
    max_streams: linked ? null : (login?.maxStreams ?? null),
    username: login?.username ?? null,
    linked,
    editable: !linked,
  };
}

/** 24/7's own people, found by WatchTower id (a person who has no id yet is matched by e-mail once). */
export const prismaUserPageStore: UserPageStore = {
  async findUser({ wtId, email }) {
    const byId = await prisma.user.findUnique({ where: { watchTowerUserId: wtId }, select: { id: true, email: true } });
    if (byId) return byId;
    if (!email) return null;
    const rows = await prisma.$queryRaw<Array<{ id: string; email: string; wt: string | null }>>`
      SELECT _id AS id, email, watchTowerUserId AS wt FROM user WHERE lower(email) = ${email} LIMIT 1`;
    const row = rows[0];
    return row && !row.wt ? { id: row.id, email: row.email } : null;
  },

  streamLimit,

  async read(user): Promise<PageData> {
    const [row, lastSession, franchises, viewers, limit] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, createdAt: true } }),
      prisma.session.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.franchise.findMany({
        where: { ownerId: user.id },
        orderBy: { name: 'asc' },
        take: MAX_FRANCHISES,
        select: {
          id: true,
          name: true,
          _count: { select: { entries: true } },
          channels: { orderBy: { number: 'asc' }, take: MAX_CHANNELS_PER_FRANCHISE, select: { id: true, number: true, name: true } },
        },
      }),
      prisma.viewer.findMany({ where: { userId: user.id }, select: { ipAddress: true } }),
      streamLimit(user),
    ]);
    const ips = viewers.map((v) => v.ipAddress);
    const history = ips.length
      ? await prisma.viewingHistory.findMany({
          where: { ipAddress: { in: ips } },
          orderBy: { startTime: 'desc' },
          take: MAX_VIEWING,
          select: { id: true, startTime: true, channelNumber: true, channelName: true, programTitle: true, duration: true },
        })
      : [];
    return {
      user: { id: user.id, email: row?.email ?? user.email, created_at: iso(row?.createdAt), last_login: iso(lastSession?.createdAt) },
      stream_limit: limit,
      franchises: franchises.map((f) => ({
        id: f.id,
        name: f.name,
        entry_count: f._count.entries,
        channels: f.channels.map((c) => ({ id: c.id, number: c.number, name: c.name })),
      })),
      recent_viewing: history.map((h) => ({
        id: h.id,
        at: iso(h.startTime),
        channel_number: h.channelNumber,
        channel: h.channelName ?? '',
        program: h.programTitle ?? '',
        duration_seconds: h.duration ?? null,
      })),
    };
  },

  async setMaxStreams(user, value) {
    await prisma.playlistLogin.update({ where: { userId: user.id }, data: { maxStreams: value } });
  },
};
