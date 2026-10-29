/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck: shared with WatchTower and the other app, which are plain JS; keep this file identical to theirs.
"use client"
/*
 * Names, dates, filters and sorting shared by the Users tab and the person page. WatchTower, ESPG and 24/7
 * ship the same file (ESPG and 24/7 get a generated copy), so the three lists filter and sort the same way.
 */

export const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', manager: 'Manager', user: 'User' };
export const APP_LABELS = { wt: 'WatchTower', espg: 'ESPG', twentyfourseven: '24/7' };
export const APP_KEYS = ['espg', 'twentyfourseven'];
export const ROLE_TONES = { owner: 'purple', admin: 'info', manager: 'accent', user: 'neutral' };
const ROLE_RANK = { owner: 0, admin: 1, manager: 2, user: 3 };

export const STATUS_LABELS = { active: 'Active', expired: 'Expired', pending: 'Pending', off: 'Turned off' };
export const STATUS_TONES = { active: 'ok', expired: 'warn', pending: 'info', off: 'danger' };
export const STATUS_ORDER = ['active', 'expired', 'pending', 'off'];

export const APP_FILTERS = [
    { value: 'all', label: 'Any app' },
    { value: 'wt_on', label: 'WatchTower on' },
    { value: 'wt_off', label: 'WatchTower off' },
    { value: 'espg_on', label: 'ESPG on' },
    { value: 'espg_off', label: 'ESPG off' },
    { value: 'twentyfourseven_on', label: '24/7 on' },
    { value: 'twentyfourseven_off', label: '24/7 off' },
];

export const LOGIN_FILTERS = [
    { value: 'any', label: 'Any time' },
    { value: 'day', label: 'Last 24 hours' },
    { value: 'week', label: 'Last 7 days' },
    { value: 'month', label: 'Last 30 days' },
    { value: 'older', label: 'More than 30 days ago' },
    { value: 'never', label: 'Never signed in' },
];

export const EMPTY_FILTERS = { search: '', role: 'all', status: 'all', app: 'all', login: 'any' };

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatWhen(iso) {
    if (!iso) return 'Never';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDay(iso) {
    if (!iso) return '—';
    const date = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "5 minutes ago", "3 days ago", or the date once it is older than a month. */
export function formatAgo(iso, now = new Date()) {
    if (!iso) return 'Never';
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return 'Never';
    const diff = now.getTime() - then.getTime();
    if (diff < 0) return formatWhen(iso);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days < 31) return days === 1 ? 'Yesterday' : `${days} days ago`;
    return formatDay(iso);
}

export function displayName(row) {
    return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username;
}

/** The most recent sign-in on any app, as { app, at } (at is null when they have never signed in). */
export function lastSeen(row) {
    let best = { app: null, at: null };
    ['wt', 'espg', 'twentyfourseven'].forEach((k) => {
        const at = row.last_login?.[k];
        if (at && (!best.at || new Date(at) > new Date(best.at))) best = { app: k, at };
    });
    return best;
}

/** The newest thing they used, as one entry from last_used (or null). */
export function lastUse(row) {
    const list = (row.last_used || []).filter((u) => u.at);
    if (list.length === 0) return null;
    return list.reduce((a, b) => (new Date(b.at) > new Date(a.at) ? b : a));
}

/** The soonest paid-service end date, as { label, date, past } (or null). */
export function nextDue(row, now = new Date()) {
    const dues = [
        row.tv_donation_due && { label: 'Live TV', date: row.tv_donation_due },
        row.movie_donation_due && { label: 'Movies', date: row.movie_donation_due },
    ].filter(Boolean);
    if (dues.length === 0) return null;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const stamped = dues.map((d) => ({ ...d, time: new Date(`${String(d.date).slice(0, 10)}T12:00:00`).getTime() }));
    stamped.sort((a, b) => a.time - b.time);
    return { ...stamped[0], past: stamped[0].time < today };
}

/** active, expired (a paid service ran out or a Manager lapsed), off (account turned off) or pending. */
export function userStatus(row, now = new Date()) {
    if (row._pending) return 'pending';
    if (row.is_active === false) return 'off';
    if (row.role_lapsed) return 'expired';
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const past = [row.tv_donation_due, row.movie_donation_due].filter(Boolean)
        .some((d) => new Date(`${String(d).slice(0, 10)}T12:00:00`).getTime() < today);
    return past ? 'expired' : 'active';
}

export function pendingRow(p) {
    return {
        id: `pending-${p.id}`, username: p.username, first_name: p.first_name, last_name: p.last_name, email: p.email,
        role: '', _pending: p, last_login: {}, last_used: [], access: {},
    };
}

function appOn(row, key) {
    if (key === 'wt') return row.is_active !== false;
    return row.access?.[key] !== false;
}

export function filterUsers(users, filters = {}, now = new Date()) {
    const { search = '', role = 'all', status = 'all', app = 'all', login = 'any' } = filters;
    const needle = search.trim().toLowerCase();
    return users.filter((u) => {
        if (role !== 'all' && u.role !== role) return false;
        if (status !== 'all' && userStatus(u, now) !== status) return false;
        if (app !== 'all') {
            const [key, state] = app.endsWith('_on') ? [app.slice(0, -3), 'on'] : [app.slice(0, -4), 'off'];
            if (u._pending) return false;
            if (appOn(u, key) !== (state === 'on')) return false;
        }
        if (login !== 'any') {
            const seen = lastSeen(u).at;
            if (login === 'never') {
                if (seen) return false;
            } else {
                if (!seen) return false;
                const age = now.getTime() - new Date(seen).getTime();
                const limit = { day: DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS }[login];
                if (login === 'older' ? age <= 30 * DAY_MS : age > limit) return false;
            }
        }
        if (!needle) return true;
        const hay = [u.username, u.first_name, u.last_name, u.email].filter(Boolean).join(' ').toLowerCase();
        return needle.split(/\s+/).every((word) => hay.includes(word));
    });
}

export function countBy(users, now = new Date()) {
    const counts = { all: users.length, active: 0, expired: 0, pending: 0, off: 0 };
    users.forEach((u) => { counts[userStatus(u, now)] += 1; });
    return counts;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const SORTERS = {
    name: (a, b) => displayName(a).toLowerCase().localeCompare(displayName(b).toLowerCase()),
    role: (a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9),
    status: (a, b) => STATUS_ORDER.indexOf(userStatus(a)) - STATUS_ORDER.indexOf(userStatus(b)),
    login: (a, b) => new Date(lastSeen(a).at || 0).getTime() - new Date(lastSeen(b).at || 0).getTime(),
    due: (a, b) => cmp(nextDue(a)?.time ?? Infinity, nextDue(b)?.time ?? Infinity),
};

export function sortUsers(rows, key = 'name', dir = 'asc') {
    const sorter = SORTERS[key] || SORTERS.name;
    const sign = dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
        const primary = sorter(a, b);
        if (primary !== 0) return sign * primary;
        return SORTERS.name(a, b);
    });
}

export function hasActiveFilters(filters) {
    return Object.keys(EMPTY_FILTERS).some((k) => (filters[k] ?? EMPTY_FILTERS[k]) !== EMPTY_FILTERS[k]);
}
