/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck: shared with WatchTower and the other app, which are plain JS; keep this file identical to theirs.
"use client"
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert, Avatar, Badge, Button, Card, Chip, EmptyState, Icons, InlineSpinner, SearchInput, Select, Switch,
    TBody, THead, Table, Td, Th, Tr, tx,
} from './ui';
import {
    APP_FILTERS, APP_KEYS, APP_LABELS, EMPTY_FILTERS, LOGIN_FILTERS, ROLE_LABELS, ROLE_TONES, STATUS_LABELS, STATUS_ORDER, STATUS_TONES,
    countBy, displayName, filterUsers, formatAgo, formatDay, formatWhen, hasActiveFilters, lastSeen, lastUse, nextDue, pendingRow,
    sortUsers, userStatus,
} from './users-shared';

/*
 * The shared Users tab. WatchTower, ESPG and 24/7 show the same list with the same filters and the same actions;
 * WatchTower is the source of truth and decides every action from the person's WatchTower role. Keep the three
 * copies in step: same columns, same labels, same data-testid values. Only ./ui differs between the apps.
 */

export { ROLE_LABELS };

const VIEW_KEY = 'users-tab-view';

function errorText(err, fallback) {
    return err?.response?.data?.error || err?.message || fallback;
}

function readView() {
    try {
        const saved = JSON.parse(window.sessionStorage.getItem(VIEW_KEY) || 'null');
        if (saved && typeof saved === 'object') {
            return { filters: { ...EMPTY_FILTERS, ...(saved.filters || {}) }, sort: saved.sort || { key: 'name', dir: 'asc' } };
        }
    } catch { /* a blocked or broken sessionStorage just means the view is not remembered */ }
    return { filters: { ...EMPTY_FILTERS }, sort: { key: 'name', dir: 'asc' } };
}

function writeView(view) {
    try { window.sessionStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* not remembered */ }
}

function loginsTitle(row) {
    return ['wt', 'espg', 'twentyfourseven'].map((k) => `${APP_LABELS[k]}: ${formatWhen(row.last_login?.[k])}`).join('\n');
}

function LoginCell({ row }) {
    const seen = lastSeen(row);
    return (
        <div data-testid={`logins-${row.id}`} title={loginsTitle(row)} className="min-w-0 text-sm">
            {seen.at ? (
                <>
                    <p className={`font-medium ${tx.strong}`}>{formatAgo(seen.at)}</p>
                    <p className={`text-xs ${tx.muted}`}>on {APP_LABELS[seen.app]}</p>
                </>
            ) : <p className={tx.muted}>Never signed in</p>}
        </div>
    );
}

function UseCell({ row }) {
    const use = lastUse(row);
    const more = (row.last_used || []).filter((u) => u.at).length - 1;
    const title = (row.last_used || []).map((u) => `${u.label}: ${u.what ? `${u.what}, ` : ''}${formatWhen(u.at)}`).join('\n');
    return (
        <div data-testid={`uses-${row.id}`} title={title} className="min-w-0 text-sm">
            {use ? (
                <>
                    <p className={`truncate font-medium ${tx.strong}`}>{use.what || use.label}</p>
                    <p className={`text-xs ${tx.muted}`}>{use.what ? `${use.label} · ` : ''}{formatAgo(use.at)}{more > 0 ? ` · +${more} more` : ''}</p>
                </>
            ) : <p className={tx.muted}>Nothing yet</p>}
        </div>
    );
}

function DonationCell({ row }) {
    const due = nextDue(row);
    return (
        <div data-testid={`donations-${row.id}`} className="min-w-0 text-sm">
            {due ? (
                <p className={`font-medium ${due.past ? tx.warn : tx.strong}`}>
                    {due.label} {due.past ? 'ended' : 'due'} {formatDay(due.date)}
                </p>
            ) : <p className={tx.muted}>No paid service</p>}
            {row.tv_donation_due && row.movie_donation_due && nextDue(row)?.label === 'Live TV' && (
                <p className={`text-xs ${tx.muted}`}>Movies due {formatDay(row.movie_donation_due)}</p>
            )}
            {row.tv_donation_due && row.movie_donation_due && nextDue(row)?.label === 'Movies' && (
                <p className={`text-xs ${tx.muted}`}>Live TV due {formatDay(row.tv_donation_due)}</p>
            )}
            <p className={`text-xs ${tx.muted}`}>
                {row.last_donation
                    ? `Last: ${formatDay(row.last_donation.date)}${row.last_donation.amount ? ` ($${row.last_donation.amount})` : ''}`
                    : 'No donations yet'}
            </p>
        </div>
    );
}

function RoleBadge({ row }) {
    return (
        <div className="space-y-1">
            <Badge tone={ROLE_TONES[row.role] || 'neutral'} data-testid={`role-${row.id}`}>{ROLE_LABELS[row.role] || row.role}</Badge>
            {row.role_lapsed && <p className={`max-w-[11rem] text-xs ${tx.warn}`}>Service expired: counts as a User until renewed</p>}
        </div>
    );
}

function AccessSwitches({ row, canToggle, busyKey, onToggle }) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" onClick={(e) => e.stopPropagation()}>
            {APP_KEYS.map((k) => {
                const on = row.access?.[k] !== false;
                return canToggle ? (
                    <span key={k} className={`inline-flex items-center gap-2 text-xs font-medium ${tx.strong}`}>
                        <Switch checked={on} disabled={busyKey === `${k}-${row.id}`} aria-label={`${APP_LABELS[k]} sign-in for ${row.username}`}
                            onChange={() => onToggle(row, k, on)} />
                        {APP_LABELS[k]}
                    </span>
                ) : (
                    <Badge key={k} tone={on ? 'ok' : 'neutral'}>{APP_LABELS[k]}: {on ? 'On' : 'Off'}</Badge>
                );
            })}
        </div>
    );
}

function PersonCell({ row, onOpenUser }) {
    const name = displayName(row);
    return (
        <div className="flex min-w-0 items-center gap-3">
            <Avatar name={name} />
            <div className="min-w-0">
                {onOpenUser && !row._pending ? (
                    <button type="button" data-testid={`user-open-${row.id}`} onClick={(e) => { e.stopPropagation(); onOpenUser(row); }}
                        className={`block max-w-full truncate text-left text-sm font-semibold hover:underline ${tx.strong}`}>
                        {name}
                    </button>
                ) : <p className={`truncate text-sm font-semibold ${tx.strong}`}>{name}</p>}
                <p className={`truncate text-xs ${tx.muted}`}>@{row.username}{row.email ? ` · ${row.email}` : ''}</p>
            </div>
        </div>
    );
}

function PendingActions({ row, can, busyKey, onRun }) {
    const p = row._pending;
    return (
        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {can.approve && (
                <Button variant="success" size="sm" disabled={busyKey === `approve-${p.id}`}
                    onClick={() => onRun(`approve-${p.id}`, { action: 'approve', user_id: p.id }, `Approved ${p.username}.`)}>Approve</Button>
            )}
            {can.deny && (
                <Button variant="danger" size="sm" disabled={busyKey === `deny-${p.id}`}
                    onClick={() => onRun(`deny-${p.id}`, { action: 'deny', user_id: p.id }, `Denied ${p.username}.`)}>Deny</Button>
            )}
        </div>
    );
}

/** The table needs room; below this width the same rows are shown as cards, and only one of the two is ever rendered. */
function useWideScreen() {
    const query = '(min-width: 768px)';
    const read = () => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(query).matches);
    const [wide, setWide] = useState(read);
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined;
        const media = window.matchMedia(query);
        const update = () => setWide(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    return wide;
}

function rowHandlers(row, onOpenUser) {
    if (!onOpenUser || row._pending) return {};
    return { onClick: () => onOpenUser(row) };
}

export default function UsersTab({ api, Spinner = InlineSpinner, onOpenUser = null, reloadEvent = null }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busyKey, setBusyKey] = useState('');
    const [view, setView] = useState(readView);
    const wide = useWideScreen();
    const { filters, sort } = view;

    const load = useCallback(async () => {
        try {
            setData(await api.directory());
            setError('');
        } catch (err) {
            setError(errorText(err, 'Could not load users.'));
        } finally {
            setLoading(false);
        }
    }, [api]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        if (!reloadEvent) return undefined;
        const handler = () => { void load(); };
        window.addEventListener(reloadEvent, handler);
        return () => window.removeEventListener(reloadEvent, handler);
    }, [reloadEvent, load]);

    useEffect(() => { writeView(view); }, [view]);

    const setFilter = (patch) => setView((v) => ({ ...v, filters: { ...v.filters, ...patch } }));
    const clearFilters = () => setView((v) => ({ ...v, filters: { ...EMPTY_FILTERS } }));
    const sortBy = (key) => setView((v) => ({
        ...v, sort: { key, dir: v.sort.key === key && v.sort.dir === 'asc' ? 'desc' : 'asc' },
    }));

    const run = useCallback(async (key, body, okMessage, after) => {
        setBusyKey(key);
        setError('');
        setNotice('');
        try {
            await api.action(body);
            setNotice(okMessage);
            if (after) after();
            await load();
        } catch (err) {
            setError(errorText(err, 'The change was not made.'));
        } finally {
            setBusyKey('');
        }
    }, [api, load]);

    const toggleApp = useCallback((row, k, on) => run(`${k}-${row.id}`,
        { action: 'set_app_access', user_id: row.id, app: k, enabled: !on },
        `${APP_LABELS[k]} sign-in ${on ? 'turned off' : 'turned on'} for ${row.username}.`), [run]);

    const everyone = useMemo(
        () => [...(data?.users || []), ...(data?.pending_signups || []).map(pendingRow)],
        [data],
    );
    const counts = useMemo(() => countBy(everyone), [everyone]);
    const rows = useMemo(() => sortUsers(filterUsers(everyone, filters), sort.key, sort.dir), [everyone, filters, sort]);

    if (loading) return <Spinner />;
    if (!data) return <Alert tone="danger" role="alert">{error || 'Could not load users.'}</Alert>;

    const can = data.viewer?.can || {};
    const filtered = hasActiveFilters(filters);
    const sortProps = (key) => ({ sortable: true, active: sort.key === key, dir: sort.dir, onSort: () => sortBy(key) });

    return (
        <div className="space-y-4" data-testid="users-tab">
            {error && <Alert tone="danger" role="alert">{error}</Alert>}
            {notice && <Alert tone="ok" role="status">{notice}</Alert>}
            {!can.edit_basic && (
                <Alert data-testid="read-only-note">
                    You can see everyone here{can.approve ? ' and approve new sign-ups' : ''}
                    {data.viewer?.role === 'manager' ? ', and turn another Manager back into a regular user' : ''}. Editing is for Admins and the Owner.
                </Alert>
            )}

            <Card className="space-y-3 p-3 sm:p-4" role="search" aria-label="Find users">
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                    <SearchInput aria-label="Search users" placeholder="Search name, username or email" value={filters.search}
                        onChange={(e) => setFilter({ search: e.target.value })} />
                    <Select aria-label="Filter by role" value={filters.role} onChange={(e) => setFilter({ role: e.target.value })}>
                        <option value="all">All roles</option>
                        {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </Select>
                    <Select aria-label="Filter by app access" value={filters.app} onChange={(e) => setFilter({ app: e.target.value })}>
                        {APP_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                    <Select aria-label="Filter by last sign-in" value={filters.login} onChange={(e) => setFilter({ login: e.target.value })}>
                        {LOGIN_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.value === 'any' ? 'Last sign-in: any time' : o.label}</option>)}
                    </Select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
                        <Chip active={filters.status === 'all'} count={counts.all} onClick={() => setFilter({ status: 'all' })}>All</Chip>
                        {STATUS_ORDER.map((s) => (
                            <Chip key={s} active={filters.status === s} count={counts[s]} onClick={() => setFilter({ status: filters.status === s ? 'all' : s })}>
                                {STATUS_LABELS[s]}
                            </Chip>
                        ))}
                    </div>
                    <div className={`flex items-center gap-3 text-xs ${tx.muted}`}>
                        <span data-testid="users-count" aria-live="polite">Showing {rows.length} of {everyone.length}</span>
                        {filtered && <button type="button" onClick={clearFilters} className={`font-medium hover:underline ${tx.link}`}>Clear filters</button>}
                    </div>
                </div>
            </Card>

            {rows.length === 0 ? (
                <EmptyState title={everyone.length === 0 ? 'No users yet' : 'No users match'}
                    action={filtered ? <Button onClick={clearFilters}>Clear filters</Button> : null}>
                    {everyone.length === 0 ? 'People show up here once they sign up and are approved.' : 'Try a different search or clear a filter.'}
                </EmptyState>
            ) : (
                wide ? (
                    <Card className="overflow-hidden">
                        <Table label="Users">
                            <THead>
                                <Th {...sortProps('name')}>User</Th>
                                <Th {...sortProps('role')}>Role</Th>
                                <Th {...sortProps('status')}>Status</Th>
                                <Th {...sortProps('login')}>Last sign-in</Th>
                                <Th>Last service use</Th>
                                <Th {...sortProps('due')}>Services</Th>
                                <Th>App access</Th>
                                <Th className="w-8"><span className="sr-only">Open</span></Th>
                            </THead>
                            <TBody>
                                {rows.map((row) => {
                                    const status = userStatus(row);
                                    return (
                                        <Tr key={row.id} data-testid={`user-row-${row.id}`} {...rowHandlers(row, onOpenUser)}>
                                            <Td className="max-w-[16rem]"><PersonCell row={row} onOpenUser={onOpenUser} /></Td>
                                            <Td>{row._pending ? <span className={tx.muted}>—</span> : <RoleBadge row={row} />}</Td>
                                            <Td><Badge tone={STATUS_TONES[status]} data-testid={`status-${row.id}`}>{STATUS_LABELS[status]}</Badge></Td>
                                            {row._pending ? (
                                                <Td colSpan={3}><PendingActions row={row} can={can} busyKey={busyKey} onRun={run} /></Td>
                                            ) : (
                                                <>
                                                    <Td><LoginCell row={row} /></Td>
                                                    <Td className="max-w-[14rem]"><UseCell row={row} /></Td>
                                                    <Td><DonationCell row={row} /></Td>
                                                </>
                                            )}
                                            <Td>{row._pending ? null : (
                                                <AccessSwitches row={row} canToggle={!!(can.disable_app && row.can?.disable_app)} busyKey={busyKey} onToggle={toggleApp} />
                                            )}</Td>
                                            <Td className="w-8 pl-0">{onOpenUser && !row._pending && <Icons.Next className={`h-4 w-4 ${tx.muted}`} aria-hidden />}</Td>
                                        </Tr>
                                    );
                                })}
                            </TBody>
                        </Table>
                    </Card>
                ) : (
                    <ul className="space-y-3" aria-label="Users">
                        {rows.map((row) => {
                            const status = userStatus(row);
                            return (
                                <li key={row.id}>
                                    <Card className={`space-y-3 p-4 ${onOpenUser && !row._pending ? 'cursor-pointer' : ''}`} {...rowHandlers(row, onOpenUser)}>
                                        <div className="flex items-start justify-between gap-2">
                                            <PersonCell row={row} onOpenUser={onOpenUser} />
                                            <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
                                        </div>
                                        {row._pending ? (
                                            <PendingActions row={row} can={can} busyKey={busyKey} onRun={run} />
                                        ) : (
                                            <>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Badge tone={ROLE_TONES[row.role] || 'neutral'}>{ROLE_LABELS[row.role] || row.role}</Badge>
                                                    {row.role_lapsed && <span className={`text-xs ${tx.warn}`}>Service expired: counts as a User</span>}
                                                </div>
                                                <dl className="grid grid-cols-2 gap-3 text-xs">
                                                    <div><dt className={tx.muted}>Last sign-in</dt><dd><LoginCell row={row} /></dd></div>
                                                    <div><dt className={tx.muted}>Last service use</dt><dd><UseCell row={row} /></dd></div>
                                                    <div className="col-span-2"><dt className={tx.muted}>Services</dt><dd><DonationCell row={row} /></dd></div>
                                                </dl>
                                                <AccessSwitches row={row} canToggle={!!(can.disable_app && row.can?.disable_app)} busyKey={busyKey} onToggle={toggleApp} />
                                            </>
                                        )}
                                    </Card>
                                </li>
                            );
                        })}
                    </ul>
                )
            )}

            <p className={`text-xs ${tx.muted}`}>
                Turning off an app only stops that person signing in there, so they cannot create their own playlists or channels.
                Playlists and streams that already exist keep working.
            </p>
        </div>
    );
}
