/**
 * Who may join which Socket.io room. `user:update` events carry other users'
 * emails and account changes, so the shared "users" room is admins only.
 * Any signed-in user also joins a room for their own account, so the app can
 * still sign them out live when an admin disables them. No valid sign-in, no
 * rooms. Plain CommonJS: server.js loads it outside the Next.js bundle.
 */

const USERS_ROOM = 'users';

function userRoom(email) {
  return `user:${String(email).toLowerCase()}`;
}

/**
 * The socket's sign-in, checked by the app itself (/api/user/session with the
 * browser's cookie from the socket handshake). Null when there is no cookie,
 * the session is invalid, or the check fails.
 */
async function lookupSession(cookie, { port, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (!cookie) return null;
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/api/user/session`, {
      headers: { cookie },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const user = data && data.user;
    if (!user || !user.id || !user.email) return null;
    return { email: String(user.email), role: user.role, isActive: user.isActive !== false };
  } catch {
    return null;
  }
}

function roomsFor(session) {
  if (!session) return [];
  const rooms = [userRoom(session.email)];
  if (session.role === 'ADMIN' && session.isActive) rooms.unshift(USERS_ROOM);
  return rooms;
}

module.exports = { USERS_ROOM, userRoom, lookupSession, roomsFor };
