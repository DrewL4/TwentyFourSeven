/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck: shared with WatchTower and the other app, which are plain JS; keep this file identical to theirs.
"use client"
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Avatar, Badge, Button, Card, CardSection, Field, Icons, InlineSpinner, Input, PillTabs, SearchInput, Select, StickyBar, Switch,
    TBody, THead, Table, Td, Th, Toggle, Tr, tx,
} from './ui';
import {
    APP_LABELS, ROLE_LABELS, ROLE_TONES, STATUS_LABELS, STATUS_TONES, displayName, formatAgo, formatDay, formatWhen, userStatus,
} from './users-shared';

/*
 * The per-user page, shared by WatchTower, ESPG and 24/7. WatchTower is the source of truth: the page, its
 * rights and its Save all come from WatchTower's signed Users-tab door, so the three apps show the same page.
 * Keep the three copies in step (same tabs, same labels, same data-testid values). Only ./ui differs.
 *
 * One Save bar for the whole page. It only appears once something has changed, and it sends every changed
 * section together; WatchTower checks them all first and saves nothing if any section has a problem. If an app
 * goes down while saving, the page says which sections were saved and keeps the unsaved edits so Save can be
 * pressed again for just those.
 */

export { ROLE_LABELS, InlineSpinner };

const TABS = [
    ['overview', 'Overview'], ['activity', 'Activity'], ['espg', 'ESPG'], ['twentyfourseven', '24/7'], ['wt', 'WatchTower'],
];
const SECTION_LABELS = { overview: 'Overview', espg: 'ESPG', twentyfourseven: '24/7' };
const SECTION_ORDER = ['overview', 'espg', 'twentyfourseven'];
const SOURCE_FLAGS = [['can_view', 'View'], ['can_edit', 'Edit'], ['has_vod_access', 'VOD'], ['has_epg_access', 'EPG'], ['has_catchup_access', 'Catch-up']];
const PLAYLIST_FLAGS = [
    ['can_view', 'View'], ['can_edit', 'Edit'], ['can_add_channels', 'Add channels'], ['can_remove_channels', 'Remove channels'],
    ['can_reorder_channels', 'Reorder channels'], ['can_manage_groups', 'Manage groups'], ['can_share_playlist', 'Share'],
    ['has_vod_access', 'VOD'], ['has_epg_access', 'EPG'], ['has_catchup_access', 'Catch-up'],
];
const SOURCE_GROUPS = [['Access', ['can_view', 'can_edit']], ['Media', ['has_vod_access', 'has_epg_access', 'has_catchup_access']]];
const PLAYLIST_GROUPS = [
    ['Playlist', ['can_view', 'can_edit', 'can_share_playlist']],
    ['Channels', ['can_add_channels', 'can_remove_channels', 'can_reorder_channels', 'can_manage_groups']],
    ['Media', ['has_vod_access', 'has_epg_access', 'has_catchup_access']],
];
const HIDDEN = '[hidden]';
const LOG_PAGE = 15;

function errorText(err, fallback) {
    return err?.response?.data?.error || err?.message || fallback;
}

const STATUS_TEXT = {
    saved: 'Saved',
    unchanged: 'Nothing to change',
    invalid: 'Not saved — fix the problem below',
    error: 'Not saved — try again',
    not_saved: 'Not saved',
};

const pick = (obj, keys) => keys.reduce((acc, k) => (k in obj ? { ...acc, [k]: obj[k] } : acc), {});
const prune = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

function baseSourceRows(data) {
    const { rights } = data;
    return data.sources.filter((s) => s.permission).map((s) => {
        const row = { source: s.id, ...pick(s.permission, SOURCE_FLAGS.map((f) => f[0])) };
        if (rights.see_source_usernames) row.username = s.permission.username || '';
        if (rights.see_source_passwords) row.password = s.permission.password || '';
        return row;
    });
}

function basePlaylistRows(data) {
    return data.playlists.filter((p) => p.permission).map((p) => ({
        playlist: p.id,
        ...pick(p.permission, PLAYLIST_FLAGS.map((f) => f[0])),
        ...(data.rights.logins_hidden ? {} : pick(p.permission, ['xtream_username', 'xtream_password'])),
    }));
}

/* ---------- small building blocks ---------- */

function Note({ children, ...rest }) {
    return <p className={`text-xs ${tx.muted}`} {...rest}>{children}</p>;
}

function Empty({ children }) {
    return <p className={`text-sm ${tx.muted}`}>{children}</p>;
}

function Problem({ children }) {
    return <p role="alert" className={`mt-1 block text-xs ${tx.danger}`}>{children}</p>;
}

function Value({ children, ...rest }) {
    const empty = children === undefined || children === null || children === '';
    return <span className={empty ? tx.muted : tx.strong} {...rest}>{empty ? '—' : children}</span>;
}

function Facts({ items }) {
    return (
        <dl className="divide-y divide-transparent">
            {items.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
                    <dt className={`shrink-0 ${tx.muted}`}>{label}</dt>
                    <dd className={`min-w-0 text-right ${tx.strong}`}>{value}</dd>
                </div>
            ))}
        </dl>
    );
}

function Section({ id, result, children }) {
    const failed = result?.status && result.status !== 'unchanged' && result.status !== 'saved';
    return (
        <div data-testid={`section-${id}`} className="space-y-4">
            {result?.status && result.status !== 'unchanged' && (
                <Alert tone={failed ? 'danger' : 'ok'} role={failed ? 'alert' : 'status'} data-testid={`result-${id}`}>
                    {STATUS_TEXT[result.status] || result.status}{result.message && result.status !== 'saved' ? `: ${result.message}` : ''}
                </Alert>
            )}
            {children}
        </div>
    );
}

function DataTable({ label, head, children }) {
    return (
        <Table label={label}>
            <THead>{head.map((h) => <Th key={h || 'blank'}>{h}</Th>)}</THead>
            <TBody>{children}</TBody>
        </Table>
    );
}

function PasswordInput({ value, onChange, label }) {
    const [shown, setShown] = useState(false);
    return (
        <span className="flex items-center gap-2">
            <Input type={shown ? 'text' : 'password'} autoComplete="new-password" aria-label={label} placeholder="Password"
                value={value} onChange={(e) => onChange(e.target.value)} />
            <Button size="sm" onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</Button>
        </span>
    );
}

/** Rights as grouped toggles when editing, or as plain badges for someone who can only look. */
function Rights({ row, flags, groups, editable, onChange, label }) {
    const text = Object.fromEntries(flags);
    if (!editable) {
        const granted = flags.filter(([key]) => row[key]);
        return granted.length === 0
            ? <Note>No rights.</Note>
            : <div className="flex flex-wrap gap-1.5">{granted.map(([key, name]) => <Badge key={key} tone="accent">{name}</Badge>)}</div>;
    }
    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map(([title, keys]) => (
                <div key={title} className="space-y-1.5">
                    <p className={`text-[11px] font-semibold uppercase tracking-wider ${tx.muted}`}>{title}</p>
                    <div className="flex flex-wrap gap-1.5">
                        {keys.map((key) => (
                            <Toggle key={key} checked={!!row[key]} aria-label={`${text[key]} ${label}`}
                                onChange={(e) => onChange({ ...row, [key]: e.target.checked })}>{text[key]}</Toggle>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ListSearch({ value, onChange, label }) {
    return <SearchInput aria-label={label} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-full sm:w-72" />;
}

/* ---------- header ---------- */

function PersonHeader({ page, onBack }) {
    const o = page.overview;
    const a = page.activity;
    const name = displayName(o);
    const status = userStatus(o.approval_status !== 'approved' ? { ...o, _pending: true } : o);
    const apps = [
        ['wt', o.is_active !== false],
        ['espg', o.access?.espg !== false],
        ['twentyfourseven', o.access?.twentyfourseven !== false],
    ];
    const tvPast = o.tv_donation_due && new Date(`${String(o.tv_donation_due).slice(0, 10)}T12:00:00`) < new Date();
    const moviePast = o.movie_donation_due && new Date(`${String(o.movie_donation_due).slice(0, 10)}T12:00:00`) < new Date();
    const last = (o.donations || [])[0];
    return (
        <Card className="p-4 sm:p-5">
            {onBack && (
                <Button variant="ghost" size="sm" icon={Icons.Back} onClick={onBack} className="-ml-2 mb-3">All users</Button>
            )}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <Avatar name={name} size="lg" />
                <div className="min-w-0 flex-1 space-y-2">
                    <div>
                        <h2 className={`truncate text-xl font-semibold tracking-tight sm:text-2xl ${tx.strong}`} data-testid="user-page-name">{name}</h2>
                        <p className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm ${tx.muted}`}>
                            <span>@{o.username}</span>
                            {o.email && <span className="inline-flex items-center gap-1"><Icons.Mail className="h-3.5 w-3.5" aria-hidden />{o.email}</span>}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5" data-testid="header-badges">
                        <Badge tone={ROLE_TONES[o.role] || 'neutral'}>{ROLE_LABELS[o.role] || o.role}</Badge>
                        <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
                        {o.is_family && <Badge tone="info">Family</Badge>}
                        {(o.services || []).map((s) => <Badge key={s} tone="accent">{s}</Badge>)}
                        {o.tv_donation_due && <Badge tone={tvPast ? 'warn' : 'ok'}>Live TV · due {formatDay(o.tv_donation_due)}</Badge>}
                        {o.movie_donation_due && <Badge tone={moviePast ? 'warn' : 'ok'}>Movies · due {formatDay(o.movie_donation_due)}</Badge>}
                    </div>
                    {last && <Note>Last donation {formatDay(last.date)} · ${last.amount}</Note>}
                </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3" data-testid="header-apps">
                {apps.map(([k, on]) => (
                    <div key={k} className={`flex items-center justify-between gap-2 px-3 py-2.5 ${tx.well}`}>
                        <div className="min-w-0">
                            <p className={`text-sm font-medium ${tx.strong}`}>{APP_LABELS[k]}</p>
                            <p className={`truncate text-xs ${tx.muted}`}>
                                {a.last_login?.[k] ? `Signed in ${formatAgo(a.last_login[k])}` : 'Never signed in'}
                            </p>
                        </div>
                        <Badge tone={on ? 'ok' : 'neutral'}>{on ? 'On' : 'Off'}</Badge>
                    </div>
                ))}
            </div>
        </Card>
    );
}

/* ---------- overview ---------- */

function OverviewSection({ page, draft, setDraft, result, busy, onImmediate }) {
    const o = page.overview;
    const can = page.can;
    const errors = result?.errors || {};
    const value = (key) => (key in draft ? draft[key] : (o[key] || ''));
    const access = { ...o.access, ...(draft.access || {}) };
    const roleOptions = (can.roles || []).filter((r) => r !== o.role);
    const stagedRole = draft.role || '';
    const [demotePassword, setDemotePassword] = useState('');
    const fields = [['first_name', 'First name'], ['last_name', 'Last name'], ['email', 'Email'], ['phone', 'Phone']];
    return (
        <Section id="overview" result={result}>
            {o.approval_status !== 'approved' && (can.approve || can.deny) && (
                <Alert tone="warn" className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1">This sign-up is waiting. These buttons act right away (they are not part of Save).</span>
                    {can.approve && (
                        <Button variant="success" size="sm" disabled={busy} onClick={() => onImmediate('approve', { action: 'approve', user_id: o.id }, `Approved ${o.username}.`)}>Approve</Button>
                    )}
                    {can.deny && (
                        <Button variant="danger" size="sm" disabled={busy} onClick={() => onImmediate('deny', { action: 'deny', user_id: o.id }, `Denied ${o.username}.`)}>Deny</Button>
                    )}
                </Alert>
            )}
            <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                    <CardSection title="Profile" description={can.edit_basic ? 'Name and contact details.' : null}>
                        {can.edit_basic ? (
                            <div className="grid gap-4 sm:grid-cols-2">
                                {fields.map(([key, label]) => (
                                    <div key={key}>
                                        <Field label={label}>
                                            <Input data-testid={`field-${key}`} value={value(key)} disabled={busy}
                                                onChange={(e) => setDraft({ [key]: e.target.value })} />
                                        </Field>
                                        {errors[key] && <Problem>{errors[key]}</Problem>}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                                {fields.map(([key, label]) => (
                                    <div key={key}>
                                        <dt className={`text-xs font-medium ${tx.muted}`}>{label}</dt>
                                        <dd className="mt-0.5 text-sm"><Value data-testid={`field-${key}`}>{o[key]}</Value></dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                    </CardSection>

                    <div className="grid gap-4 md:grid-cols-2">
                        <CardSection title="Services and expiry" data-testid="overview-services">
                            {(o.services || []).length === 0 ? <Empty>No services.</Empty> : (
                                <ul className="space-y-1 text-sm">
                                    {o.services.map((s) => <li key={s} className={tx.strong}>{s}</li>)}
                                </ul>
                            )}
                            <div className="mt-2 space-y-0.5">
                                {o.tv_donation_due && <p className={`text-xs ${tx.muted}`}>Live TV due {formatDay(o.tv_donation_due)}</p>}
                                {o.movie_donation_due && <p className={`text-xs ${tx.muted}`}>Movies due {formatDay(o.movie_donation_due)}</p>}
                            </div>
                        </CardSection>
                        <CardSection title="Donations" data-testid="overview-donations">
                            {(o.donations || []).length === 0 ? <Empty>No donations yet.</Empty> : (
                                <ul className="space-y-1.5 text-sm">
                                    {o.donations.map((d, i) => (
                                        <li key={`${d.date}-${i}`} className={tx.strong}>{formatDay(d.date)} — ${d.amount}{d.service_type ? <Badge className="ml-2">{d.service_type}</Badge> : null}</li>
                                    ))}
                                </ul>
                            )}
                        </CardSection>
                    </div>
                </div>

                <div className="space-y-4">
                    <CardSection title="Account">
                        <Facts items={[
                            ['Username', <Value key="u">{o.username}</Value>],
                            ['Role', (
                                <span key="r" className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                    <span data-testid="overview-role">{ROLE_LABELS[o.role] || o.role}</span>
                                </span>
                            )],
                            ['Approval', <span key="a" className="capitalize" data-testid="overview-approval">{String(o.approval_status || '').replace('_', ' ')}</span>],
                            ['Joined', <Value key="j">{o.date_joined ? formatDay(o.date_joined) : ''}</Value>],
                            ['Account', <span key="s">{o.is_active ? 'Active' : 'Turned off'}{o.is_family ? ' · Family' : ''}</span>],
                        ]} />
                        {o.role_lapsed && <Note>Service expired: counts as a User until renewed</Note>}
                    </CardSection>

                    <CardSection title="Sign-in to the apps">
                        <div className="space-y-2">
                            {['espg', 'twentyfourseven'].map((k) => (
                                <label key={k} className="flex items-center justify-between gap-3 text-sm">
                                    <span data-testid={`access-text-${k}`} className={tx.strong}>{APP_LABELS[k]}{can.disable_app ? '' : `: ${access[k] !== false ? 'On' : 'Off'}`}</span>
                                    {can.disable_app && (
                                        <Switch checked={access[k] !== false} disabled={busy} aria-label={`${APP_LABELS[k]} sign-in`} data-testid={`access-${k}`}
                                            onChange={(e) => setDraft({ access: { ...(draft.access || {}), [k]: e.target.checked } })} />
                                    )}
                                </label>
                            ))}
                        </div>
                        {errors.access && <Problem>{errors.access}</Problem>}
                        <Note>Turning an app off only stops this person signing in there. Playlists and streams that already exist keep working.</Note>
                    </CardSection>

                    {roleOptions.length > 0 && can.edit && (
                        <CardSection title="Role" data-testid="role-change">
                            <Field label="Change role">
                                <Select data-testid="role-select" value={stagedRole} disabled={busy}
                                    onChange={(e) => setDraft(e.target.value ? { role: e.target.value } : { role: undefined, password: undefined })}>
                                    <option value="">Keep as {ROLE_LABELS[o.role]}</option>
                                    {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                                </Select>
                            </Field>
                            {errors.role && <Problem>{errors.role}</Problem>}
                            {stagedRole && (
                                <div className="mt-3">
                                    <Field label="Your password (to confirm the role change)">
                                        <Input type="password" autoComplete="current-password" data-testid="role-password"
                                            value={draft.password || ''} disabled={busy} onChange={(e) => setDraft({ password: e.target.value })} />
                                    </Field>
                                    {errors.password && <Problem>{errors.password}</Problem>}
                                </div>
                            )}
                        </CardSection>
                    )}
                    {roleOptions.length > 0 && !can.edit && (
                        <CardSection title="Role" data-testid="role-demote">
                            <p className={`text-sm ${tx.muted}`}>Turn this {ROLE_LABELS[o.role]} back into a regular user (acts right away).</p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Input type="password" autoComplete="current-password" aria-label="Your password" placeholder="Your password"
                                    value={demotePassword} onChange={(e) => setDemotePassword(e.target.value)} className="w-44" />
                                <Button variant="primary" disabled={busy || !demotePassword}
                                    onClick={() => onImmediate('demote', { action: 'set_role', user_id: o.id, role: roleOptions[0], password: demotePassword },
                                        `${o.username} is now ${ROLE_LABELS[roleOptions[0]]}.`, () => setDemotePassword(''))}>
                                    Demote to {ROLE_LABELS[roleOptions[0]]}
                                </Button>
                            </div>
                        </CardSection>
                    )}
                </div>
            </div>
        </Section>
    );
}

/* ---------- activity ---------- */

function resultTone(text) {
    if (/fail|denied|error|invalid|blocked/i.test(text || '')) return 'danger';
    if (/success|ok|saved|allowed/i.test(text || '')) return 'ok';
    return 'neutral';
}

function ActivityLog({ log }) {
    const [app, setApp] = useState('all');
    const [action, setAction] = useState('all');
    const [shown, setShown] = useState(LOG_PAGE);
    const apps = useMemo(() => [...new Set((log || []).map((e) => e.app).filter(Boolean))], [log]);
    const actions = useMemo(() => [...new Set((log || []).map((e) => e.action).filter(Boolean))].sort(), [log]);
    const rows = useMemo(
        () => (log || []).filter((e) => (app === 'all' || e.app === app) && (action === 'all' || e.action === action)),
        [log, app, action],
    );
    const filtered = app !== 'all' || action !== 'all';
    return (
        <CardSection title="Activity log" data-testid="activity-log" bodyClassName="p-0 sm:p-0"
            description="Changes made to and by this person, newest first."
            actions={log && log.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                    <div className="w-36"><Select aria-label="Filter log by app" value={app} className="" onChange={(e) => { setApp(e.target.value); setShown(LOG_PAGE); }}>
                        <option value="all">All apps</option>
                        {apps.map((k) => <option key={k} value={k}>{APP_LABELS[k] || k}</option>)}
                    </Select></div>
                    <div className="w-48"><Select aria-label="Filter log by action" value={action} className="" onChange={(e) => { setAction(e.target.value); setShown(LOG_PAGE); }}>
                        <option value="all">All actions</option>
                        {actions.map((k) => <option key={k} value={k}>{k}</option>)}
                    </Select></div>
                </div>
            ) : null}>
            {log === null ? <div className="p-4 sm:p-5"><Empty>The activity log is not available for this person.</Empty></div>
                : log.length === 0 ? <div className="p-4 sm:p-5"><Empty>No activity logged for this person.</Empty></div>
                    : rows.length === 0 ? (
                        <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
                            <Empty>No log entries match.</Empty>
                            <Button size="sm" onClick={() => { setApp('all'); setAction('all'); }}>Clear filters</Button>
                        </div>
                    ) : (
                        <>
                            <DataTable label="Activity log" head={['When', 'App', 'Who', 'What', 'Result']}>
                                {rows.slice(0, shown).map((e) => (
                                    <Tr key={e.id} className="align-top">
                                        <Td className="whitespace-nowrap text-xs" title={formatWhen(e.occurred_at)}>{formatWhen(e.occurred_at)}</Td>
                                        <Td><Badge>{APP_LABELS[e.app] || e.app}</Badge></Td>
                                        <Td className="text-xs">{e.actor_name}{e.actor_role ? ` (${e.actor_role})` : ''}</Td>
                                        <Td className="text-xs">{e.action}{e.target_label ? ` → ${e.target_label}` : ''}{e.is_actor ? ' (done by this person)' : ''}</Td>
                                        <Td>{e.result ? <Badge tone={resultTone(e.result)}>{e.result}</Badge> : <span className={tx.muted}>—</span>}</Td>
                                    </Tr>
                                ))}
                            </DataTable>
                            <div className={`flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs sm:px-5 ${tx.rule} ${tx.muted}`}>
                                <span data-testid="log-count">Showing {Math.min(shown, rows.length)} of {rows.length}{filtered ? ` (${log.length} in all)` : ''}</span>
                                {rows.length > shown && <Button size="sm" onClick={() => setShown((n) => n + LOG_PAGE)}>Show more</Button>}
                            </div>
                        </>
                    )}
        </CardSection>
    );
}

function ActivitySection({ page }) {
    const a = page.activity;
    return (
        <Section id="activity">
            <div className="grid gap-4 md:grid-cols-2">
                <CardSection title="Last sign-in" data-testid="activity-logins">
                    <div className="space-y-2">
                        {['wt', 'espg', 'twentyfourseven'].map((k) => (
                            <p key={k} className="flex items-baseline justify-between gap-3 text-sm" title={formatWhen(a.last_login?.[k])}>
                                <span className={`font-medium ${tx.strong}`}>{APP_LABELS[k]}:</span>{' '}
                                <span className={a.last_login?.[k] ? tx.strong : tx.muted}>{a.last_login?.[k] ? formatWhen(a.last_login[k]) : 'Never'}</span>
                            </p>
                        ))}
                    </div>
                </CardSection>
                <CardSection title="Last service use" data-testid="activity-uses">
                    {(a.last_used || []).length === 0 ? <Empty>Nothing yet.</Empty> : (
                        <div className="space-y-2">
                            {a.last_used.map((u) => (
                                <p key={u.key} className="flex items-baseline justify-between gap-3 text-sm">
                                    <span className={`font-medium ${tx.strong}`}>{u.label}:</span>{' '}
                                    <span className={`text-right ${tx.strong}`}>{u.what ? `${u.what}, ` : ''}{formatWhen(u.at)}</span>
                                </p>
                            ))}
                        </div>
                    )}
                </CardSection>
            </div>
            <ActivityLog log={a.log} />
        </Section>
    );
}

/* ---------- WatchTower ---------- */

function CountTitle({ children, count }) {
    return <span className="inline-flex items-center gap-2">{children}<Badge>{count}</Badge></span>;
}

function WatchTowerSection({ page }) {
    const w = page.wt;
    const none = w.requests === null && w.issues === null;
    return (
        <Section id="wt">
            {none ? <CardSection title="WatchTower"><Empty>Requests and issue reports are not shown to you.</Empty></CardSection> : (
                <>
                    <Note>Read-only: this person's requests and issue reports.</Note>
                    <CardSection title={<CountTitle count={(w.requests || []).length}>Media requests</CountTitle>} data-testid="wt-requests" bodyClassName="p-0 sm:p-0">
                        {(w.requests || []).length === 0 ? <div className="p-4 sm:p-5"><Empty>No media requests.</Empty></div> : (
                            <DataTable label="Media requests" head={['Title', 'Type', 'Status', 'When']}>
                                {w.requests.map((r) => (
                                    <Tr key={r.id}>
                                        <Td className="text-xs">{r.title}{r.season_number ? ` S${r.season_number}` : ''}{r.episode_number ? `E${r.episode_number}` : ''}</Td>
                                        <Td className="text-xs">{r.media_type}</Td>
                                        <Td><Badge tone={resultTone(r.status)}>{r.status}</Badge></Td>
                                        <Td className="text-xs">{formatWhen(r.at)}</Td>
                                    </Tr>
                                ))}
                            </DataTable>
                        )}
                    </CardSection>
                    <CardSection title={<CountTitle count={(w.channel_requests || []).length}>Channel requests</CountTitle>} data-testid="wt-channel-requests" bodyClassName="p-0 sm:p-0">
                        {(w.channel_requests || []).length === 0 ? <div className="p-4 sm:p-5"><Empty>No channel requests.</Empty></div> : (
                            <DataTable label="Channel requests" head={['Channel', 'Playlist', 'Status', 'When']}>
                                {w.channel_requests.map((r) => (
                                    <Tr key={r.id}>
                                        <Td className="text-xs">{r.channel_name}</Td>
                                        <Td className="text-xs">{r.playlist}</Td>
                                        <Td><Badge tone={resultTone(r.status)}>{r.status}</Badge></Td>
                                        <Td className="text-xs">{formatWhen(r.at)}</Td>
                                    </Tr>
                                ))}
                            </DataTable>
                        )}
                    </CardSection>
                    <CardSection title={<CountTitle count={(w.signup_requests || []).length}>Live TV sign-up requests</CountTitle>} data-testid="wt-signup-requests">
                        {(w.signup_requests || []).length === 0 ? <Empty>None.</Empty> : (
                            <ul className={`space-y-1 text-sm ${tx.strong}`}>{w.signup_requests.map((r) => <li key={r.id}>{r.package} — {r.status} ({formatWhen(r.at)})</li>)}</ul>
                        )}
                    </CardSection>
                    <CardSection title={<CountTitle count={(w.issues || []).length}>Issue reports</CountTitle>} data-testid="wt-issues" bodyClassName="p-0 sm:p-0">
                        {(w.issues || []).length === 0 ? <div className="p-4 sm:p-5"><Empty>No issue reports.</Empty></div> : (
                            <DataTable label="Issue reports" head={['Content', 'Service', 'Issue', 'Status', 'When']}>
                                {w.issues.map((r) => (
                                    <Tr key={r.id} className="align-top">
                                        <Td className="text-xs">{r.content}</Td>
                                        <Td className="text-xs">{r.service}</Td>
                                        <Td className="text-xs">{r.issue_type}{r.details ? ` — ${r.details}` : ''}</Td>
                                        <Td><Badge tone={resultTone(r.status)}>{r.status}</Badge></Td>
                                        <Td className="text-xs">{formatWhen(r.at)}</Td>
                                    </Tr>
                                ))}
                            </DataTable>
                        )}
                    </CardSection>
                </>
            )}
        </Section>
    );
}

/* ---------- ESPG ---------- */

/** One source or playlist: its name, whether this person may use it, and what they may do with it. */
function PermissionItem({ testid, name, detail, row, allowed, canAllow, allowDisabled = false, onAllow, allowLabel, children }) {
    return (
        <li data-testid={testid} className={`rounded-xl border p-3 sm:p-4 ${tx.rule}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold ${tx.strong}`}>{name}</p>
                    <p className={`text-xs ${tx.muted}`}>{detail}</p>
                </div>
                {canAllow ? (
                    <label className={`inline-flex items-center gap-2 text-xs font-medium ${tx.strong}`}>
                        <Switch checked={allowed} disabled={allowDisabled} aria-label={allowLabel} onChange={(e) => onAllow(e.target.checked)} />
                        Allowed
                    </label>
                ) : <Badge tone={allowed ? 'ok' : 'neutral'}>{allowed ? 'Allowed' : 'Not allowed'}</Badge>}
            </div>
            {row && children && <div className={`mt-3 space-y-3 border-t pt-3 ${tx.rule}`}>{children}</div>}
        </li>
    );
}

function EspgSources({ data, draft, setDraft, editable, error }) {
    const rows = draft.source_permissions || baseSourceRows(data);
    const byId = Object.fromEntries(rows.map((r) => [r.source, r]));
    const { rights } = data;
    const update = (next) => setDraft({ source_permissions: next });
    const edit = (row) => update(rows.map((r) => (r.source === row.source ? row : r)));
    const list = editable ? data.sources : [...data.sources].sort((a, b) => Number(!!byId[b.id]) - Number(!!byId[a.id]));
    return (
        <CardSection title="Source permissions" data-testid="espg-sources"
            description="Which of your IPTV sources this person can use, and what they can do with each.">
            {error && <Problem>{error}</Problem>}
            {!rights.see_source_passwords && <Note>Source passwords are only shown to the Owner.</Note>}
            {data.sources.length === 0 ? <Empty>No sources.</Empty> : (
                <ul className="mt-2 space-y-3">
                    {list.map((s) => {
                        const row = byId[s.id];
                        const perm = s.permission;
                        const detail = `${s.source_type}${s.public ? ' · public' : ''}`;
                        if (s.public && !row) {
                            return (
                                <li key={s.id} data-testid={`espg-source-${s.id}`} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 sm:p-4 ${tx.rule}`}>
                                    <div><p className={`text-sm font-semibold ${tx.strong}`}>{s.name}</p><p className={`text-xs ${tx.muted}`}>{detail}</p></div>
                                    <Badge tone="info">Public: available to everyone</Badge>
                                </li>
                            );
                        }
                        return (
                            <PermissionItem key={s.id} testid={`espg-source-${s.id}`} name={s.name} detail={detail} row={row} allowed={!!row}
                                canAllow={editable} allowLabel={`Allow ${s.name}`}
                                onAllow={(on) => update(on ? [...rows, { source: s.id, can_view: true }] : rows.filter((r) => r.source !== s.id))}>
                                {row && <Rights row={row} flags={SOURCE_FLAGS} groups={SOURCE_GROUPS} editable={editable} onChange={edit} label={s.name} />}
                                {row && rights.see_source_usernames && (
                                    editable ? (
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <Input aria-label={`Username for ${s.name}`} placeholder="Username"
                                                value={row.username === undefined ? '' : row.username} disabled={row.username === HIDDEN}
                                                onChange={(e) => edit({ ...row, username: e.target.value })} />
                                            {rights.see_source_passwords && (
                                                <PasswordInput label={`Password for ${s.name}`} value={row.password || ''} onChange={(v) => edit({ ...row, password: v })} />
                                            )}
                                        </div>
                                    ) : <Note>Username: {row.username && row.username !== HIDDEN ? row.username : 'hidden'}</Note>
                                )}
                                {row && !rights.see_source_passwords && perm && (
                                    <Note>{perm.has_password ? 'Password set (hidden)' : 'No password'}</Note>
                                )}
                            </PermissionItem>
                        );
                    })}
                </ul>
            )}
        </CardSection>
    );
}

function EspgPlaylists({ data, draft, setDraft, editable, error }) {
    const rows = draft.playlist_permissions || basePlaylistRows(data);
    const byId = Object.fromEntries(rows.map((r) => [r.playlist, r]));
    const resets = draft.reset_login_playlists || [];
    const { rights } = data;
    const [needle, setNeedle] = useState('');
    const update = (next) => setDraft({ playlist_permissions: next });
    const edit = (row) => update(rows.map((r) => (r.playlist === row.playlist ? row : r)));
    const canChange = editable && !rights.logins_hidden;
    const visible = data.playlists
        .filter((p) => p.name.toLowerCase().includes(needle.trim().toLowerCase()))
        .sort((a, b) => (canChange ? 0 : Number(!!byId[b.id]) - Number(!!byId[a.id])));
    return (
        <CardSection title="Playlist permissions" data-testid="espg-playlists"
            description="Which playlists this person can open, what they can change, and their login for each."
            actions={data.playlists.length > 6 ? <ListSearch label="Find a playlist" value={needle} onChange={setNeedle} /> : null}>
            {error && <Problem>{error}</Problem>}
            {rights.logins_hidden && <Note>This person's playlist logins are not shown to you.</Note>}
            {data.playlists.length === 0 ? <Empty>No playlists.</Empty> : visible.length === 0 ? <Empty>No playlists match.</Empty> : (
                <ul className="mt-2 space-y-3">
                    {visible.map((p) => {
                        const row = byId[p.id];
                        return (
                            <PermissionItem key={p.id} testid={`espg-playlist-${p.id}`} name={p.name}
                                detail={`${p.public ? 'Public' : 'Private'}${p.active ? '' : ' · inactive'}`}
                                row={row} allowed={!!row} canAllow={editable} allowDisabled={rights.logins_hidden} allowLabel={`Allow playlist ${p.name}`}
                                onAllow={(on) => update(on ? [...rows, { playlist: p.id, can_view: true }] : rows.filter((r) => r.playlist !== p.id))}>
                                {row && <Rights row={row} flags={PLAYLIST_FLAGS} groups={PLAYLIST_GROUPS} editable={canChange} onChange={edit} label={p.name} />}
                                {row && !rights.logins_hidden && (
                                    canChange ? (
                                        <div className="space-y-2">
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                <Input aria-label={`Login username for ${p.name}`} placeholder="Login username"
                                                    value={row.xtream_username || ''} onChange={(e) => edit({ ...row, xtream_username: e.target.value })} />
                                                <PasswordInput label={`Login password for ${p.name}`} value={row.xtream_password || ''}
                                                    onChange={(v) => edit({ ...row, xtream_password: v })} />
                                            </div>
                                            <Toggle checked={resets.includes(p.id)} aria-label={`Reset login to default for ${p.name}`}
                                                onChange={(e) => setDraft({ reset_login_playlists: e.target.checked ? [...resets, p.id] : resets.filter((i) => i !== p.id) })}>
                                                Reset login to default (on Save)
                                            </Toggle>
                                        </div>
                                    ) : <Note>Login: {row.xtream_username || '—'}{row.xtream_password ? ' · password set' : ''}</Note>
                                )}
                            </PermissionItem>
                        );
                    })}
                </ul>
            )}
        </CardSection>
    );
}

function EspgSports({ data, draft, setDraft, editable, error }) {
    const s = data.sports;
    const selected = draft.sports_group_ids || s.selected_ids;
    const favorites = s.ncaaf_favorite_team_ids || [];
    return (
        <CardSection title="Custom sports" data-testid="espg-sports"
            description={selected.length === 0 ? 'No groups picked: this person gets all sports.' : `${selected.length} group(s) picked.`}>
            {error && <Problem>{error}</Problem>}
            <Note>A lock means an admin turned that group on for all users. If no other groups are picked, the person gets those as well.</Note>
            {s.groups.length === 0 ? <div className="mt-2"><Empty>No custom sports groups.</Empty></div> : editable ? (
                <div className="mt-3 flex flex-wrap gap-2">
                    {s.groups.map((g) => (
                        <Toggle key={g.id} checked={g.locked || selected.includes(g.id)} disabled={g.locked} aria-label={`Sports group ${g.name}`}
                            onChange={(e) => setDraft({ sports_group_ids: e.target.checked ? [...selected, g.id] : selected.filter((i) => i !== g.id) })}>
                            {g.name}{g.locked ? ' (turned on for everyone)' : ''}{g.active ? '' : ' (off)'}
                        </Toggle>
                    ))}
                </div>
            ) : (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.groups.filter((g) => g.locked || selected.includes(g.id)).map((g) => (
                        <Badge key={g.id} tone="accent">{g.name}{g.locked ? ' (turned on for everyone)' : ''}</Badge>
                    ))}
                    {s.groups.every((g) => !(g.locked || selected.includes(g.id))) && <Note>None picked.</Note>}
                </div>
            )}
            <p className={`mt-4 text-sm ${tx.strong}`} data-testid="espg-favorite">
                Favorite team{favorites.length === 1 ? '' : 's'} (college football):{' '}
                {favorites.length === 0 ? 'none' : favorites.join(', ')}
                {s.ncaaf_include_fcs ? ' · includes FCS' : ''}
                <span className={`ml-2 text-xs ${tx.muted}`}>(set by the person in ESPG)</span>
            </p>
        </CardSection>
    );
}

function EspgOwned({ data, onRemove, busy }) {
    const [confirming, setConfirming] = useState(null);
    const list = data.owned_playlists;
    return (
        <CardSection title="Their playlists" data-testid="espg-owned" bodyClassName="p-0 sm:p-0">
            {list.length === 0 ? <div className="p-4 sm:p-5"><Empty>This person has no playlists of their own.</Empty></div> : (
                <DataTable label="Their playlists" head={['Name', 'Channels', 'Movies', 'Series', 'Max connections', 'Updated', '']}>
                    {list.map((p) => (
                        <Tr key={p.id} data-testid={`espg-owned-${p.id}`}>
                            <Td className="text-xs font-medium">{p.name}{p.public ? ' · public' : ''}{p.active ? '' : ' · inactive'}</Td>
                            <Td className="text-xs">{p.channels}</Td>
                            <Td className="text-xs">{p.movies}</Td>
                            <Td className="text-xs">{p.series}</Td>
                            <Td className="text-xs">{p.max_connections}</Td>
                            <Td className="text-xs">{formatWhen(p.updated_at)}</Td>
                            <Td className="text-right">
                                {p.can_remove && (confirming === p.id ? (
                                    <span className="inline-flex gap-1">
                                        <Button variant="danger" size="sm" disabled={busy} onClick={() => { setConfirming(null); onRemove(p); }}>Yes, remove</Button>
                                        <Button size="sm" onClick={() => setConfirming(null)}>Keep</Button>
                                    </span>
                                ) : (
                                    <Button size="sm" disabled={busy} onClick={() => setConfirming(p.id)}>Remove</Button>
                                ))}
                            </Td>
                        </Tr>
                    ))}
                </DataTable>
            )}
            <div className={`border-t px-4 py-3 sm:px-5 ${tx.rule}`}>
                <Note>Removing a playlist acts right away (it is not part of Save) and cannot be undone.</Note>
            </div>
        </CardSection>
    );
}

function Stat({ label, value }) {
    return (
        <div className={`px-4 py-3 ${tx.well}`}>
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${tx.muted}`}>{label}</p>
            <p className={`mt-0.5 text-lg font-semibold ${tx.strong}`}>{value}</p>
        </div>
    );
}

function EspgStreams({ data }) {
    const s = data.streams;
    return (
        <CardSection title="Stream limits" data-testid="espg-streams">
            {s.tv_connections === null ? <Empty>Stream limits could not be read.</Empty> : (
                <>
                    <p className="sr-only">TV connections: {s.tv_connections}{s.max_247_streams !== null ? ` · 24/7 streams allowed: ${s.max_247_streams}` : ''}</p>
                    <div className="grid gap-3 sm:grid-cols-3" aria-hidden>
                        <Stat label="TV connections" value={s.tv_connections} />
                        {s.max_247_streams !== null && <Stat label="24/7 streams allowed" value={s.max_247_streams} />}
                    </div>
                    {(s.lines || []).length > 0 && (
                        <div className="mt-3 space-y-1">
                            {s.lines.map((l) => <p key={l.source} className={`text-xs ${tx.muted}`}>{l.source}: {l.max_connections}</p>)}
                        </div>
                    )}
                </>
            )}
        </CardSection>
    );
}

function EspgSection({ section, draft, setDraft, result, onRemove, busy }) {
    const errors = result?.errors || {};
    if (section.status !== 'ok') {
        return (
            <Section id="espg" result={result}>
                <CardSection title="ESPG"><Empty>{section.message || 'ESPG is not available right now.'}</Empty></CardSection>
            </Section>
        );
    }
    const data = section.data;
    const editable = !!data.rights.edit && !busy;
    const props = { data, draft, setDraft, editable };
    return (
        <Section id="espg" result={result}>
            <p className={`text-sm ${tx.muted}`}>
                {data.rights.edit ? '' : 'View only. '}{data.user.email} · joined {formatDay(data.user.date_joined)} · last ESPG sign-in {formatWhen(data.user.last_login)}
            </p>
            <EspgPlaylists {...props} error={errors.playlist_permissions || errors.reset_login_playlists} />
            <EspgSources {...props} error={errors.source_permissions} />
            <EspgSports {...props} error={errors.sports_group_ids} />
            <EspgOwned data={data} onRemove={onRemove} busy={busy} />
            <EspgStreams data={data} />
        </Section>
    );
}

/* ---------- 24/7 ---------- */

function TfsSection({ section, draft, setDraft, result, busy }) {
    const errors = result?.errors || {};
    if (section.status !== 'ok') {
        return (
            <Section id="twentyfourseven" result={result}>
                <CardSection title="24/7"><Empty>{section.message || '24/7 is not available right now.'}</Empty></CardSection>
            </Section>
        );
    }
    const d = section.data;
    const limitEditable = d.stream_limit?.editable !== false;
    const editable = !!d.rights.edit && !busy && limitEditable;
    const limit = 'max_streams' in draft ? draft.max_streams : d.stream_limit?.max_streams;
    return (
        <Section id="twentyfourseven" result={result}>
            <p className={`text-sm ${tx.muted}`}>
                {d.rights.edit ? '' : 'View only. '}{d.user.email} · joined {formatDay(d.user.created_at)} · last 24/7 sign-in {formatWhen(d.user.last_login)}
            </p>
            <CardSection title="Stream limits" data-testid="tfs-streams">
                {!d.stream_limit?.has_login ? <Empty>No playlist login yet, so no stream limit is set.</Empty> : (
                    <div className="space-y-2">
                        {d.rights.edit ? (
                            <>
                                <Field label="Streams at once">
                                    <Input type="number" min="0" max="50" data-testid="field-max-streams" className="w-28" disabled={!editable}
                                        value={limit === undefined || limit === null ? '' : limit}
                                        onChange={(e) => setDraft({ max_streams: e.target.value === '' ? '' : Number(e.target.value) })} />
                                </Field>
                                {errors.max_streams && <Problem>{errors.max_streams}</Problem>}
                            </>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Stat label="Streams at once" value={<Value data-testid="field-max-streams">{limit}</Value>} />
                            </div>
                        )}
                        <Note>
                            Login: {d.stream_limit.username}. {d.stream_limit.linked ? "While linked to ESPG, the limit follows the person's ESPG TV connections plus one." : 'This is how many 24/7 streams they may run at once.'}
                        </Note>
                    </div>
                )}
            </CardSection>
            <CardSection title="Franchises and channels" data-testid="tfs-franchises" bodyClassName="p-0 sm:p-0">
                {d.franchises.length === 0 ? <div className="p-4 sm:p-5"><Empty>This person has not created any franchises.</Empty></div> : (
                    <DataTable label="Franchises" head={['Franchise', 'Entries', 'Channels']}>
                        {d.franchises.map((f) => (
                            <Tr key={f.id} className="align-top" data-testid={`tfs-franchise-${f.id}`}>
                                <Td className="text-xs font-medium">{f.name}</Td>
                                <Td className="text-xs">{f.entry_count}</Td>
                                <Td className="text-xs">{f.channels.length === 0 ? 'None' : f.channels.map((c) => `${c.number} ${c.name}`).join(', ')}</Td>
                            </Tr>
                        ))}
                    </DataTable>
                )}
            </CardSection>
            <CardSection title="Recent viewing" data-testid="tfs-viewing" bodyClassName="p-0 sm:p-0">
                {d.recent_viewing.length === 0 ? <div className="p-4 sm:p-5"><Empty>No viewing recorded for this person.</Empty></div> : (
                    <DataTable label="Recent viewing" head={['When', 'Channel', 'Program', 'Length']}>
                        {d.recent_viewing.map((v) => (
                            <Tr key={v.id}>
                                <Td className="text-xs">{formatWhen(v.at)}</Td>
                                <Td className="text-xs">{v.channel_number} {v.channel}</Td>
                                <Td className="text-xs">{v.program}</Td>
                                <Td className="text-xs">{v.duration_seconds ? `${Math.round(v.duration_seconds / 60)} min` : '—'}</Td>
                            </Tr>
                        ))}
                    </DataTable>
                )}
            </CardSection>
        </Section>
    );
}

/* ---------- the page ---------- */

function startTab() {
    try {
        const wanted = window.location.hash.replace('#', '');
        if (TABS.some(([id]) => id === wanted)) return wanted;
    } catch { /* no window: start on Overview */ }
    return 'overview';
}

export default function UserPage({ api, userId, onBack, Spinner = InlineSpinner }) {
    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [drafts, setDrafts] = useState({});
    const [results, setResults] = useState({});
    const [saving, setSaving] = useState(false);
    const [busyKey, setBusyKey] = useState('');
    const [tab, setTabState] = useState(startTab);
    const alive = useRef(true);
    useEffect(() => () => { alive.current = false; }, []);

    const setTab = useCallback((id) => {
        setTabState(id);
        try { window.history.replaceState(null, '', `#${id}`); } catch { /* the tab just is not in the address */ }
    }, []);

    const load = useCallback(async () => {
        try {
            const data = await api.page(userId);
            if (!alive.current) return;
            setPage(data);
            setError('');
        } catch (err) {
            if (alive.current) setError(errorText(err, 'Could not load this person.'));
        } finally {
            if (alive.current) setLoading(false);
        }
    }, [api, userId]);

    useEffect(() => { setLoading(true); setDrafts({}); setResults({}); void load(); }, [load]);

    const dirty = useMemo(() => SECTION_ORDER.filter((k) => drafts[k] && Object.keys(drafts[k]).length > 0), [drafts]);

    useEffect(() => {
        if (dirty.length === 0) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty.length]);

    const setDraft = useCallback((section, patch) => {
        setDrafts((all) => {
            const next = prune({ ...(all[section] || {}), ...patch });
            const copy = { ...all, [section]: next };
            if (Object.keys(next).length === 0) delete copy[section];
            return copy;
        });
        setResults((r) => (r[section] ? { ...r, [section]: undefined } : r));
    }, []);

    const save = useCallback(async () => {
        const changes = Object.fromEntries(dirty.map((k) => [k, drafts[k]]));
        setSaving(true);
        setError('');
        setNotice('');
        try {
            const { data } = await api.save(userId, changes);
            if (!alive.current) return;
            if (!data || !data.sections) {
                setError(data?.error || 'The page was not saved.');
                return;
            }
            setResults(data.sections);
            if (data.page) setPage(data.page);
            setDrafts((all) => {
                const keep = { ...all };
                Object.entries(data.sections).forEach(([k, s]) => { if (s.status === 'saved' || s.status === 'unchanged') delete keep[k]; });
                return keep;
            });
            const failed = Object.entries(data.sections).filter(([, s]) => ['invalid', 'error', 'not_saved'].includes(s.status));
            if (failed.length === 0) setNotice('Saved.');
            else {
                setNotice(data.saved
                    ? 'Some parts were saved and some were not. The ones that were not saved keep your edits; press Save to try them again.'
                    : 'Nothing was saved. Fix the problems shown and press Save again.');
                setTab(failed[0][0]);
            }
        } catch (err) {
            if (alive.current) setError(errorText(err, 'The page was not saved.'));
        } finally {
            if (alive.current) setSaving(false);
        }
    }, [api, dirty, drafts, userId, setTab]);

    const immediate = useCallback(async (key, body, okMessage, after) => {
        setBusyKey(key);
        setError('');
        setNotice('');
        try {
            await api.action(body);
            setNotice(okMessage);
            if (after) after();
            await load();
        } catch (err) {
            if (alive.current) setError(errorText(err, 'The change was not made.'));
        } finally {
            if (alive.current) setBusyKey('');
        }
    }, [api, load]);

    const removePlaylist = useCallback(async (playlist) => {
        setBusyKey(`remove-${playlist.id}`);
        setError('');
        setNotice('');
        try {
            const data = await api.removePlaylist(userId, playlist.id);
            setNotice(data?.detail || `Removed ${playlist.name}.`);
            await load();
        } catch (err) {
            if (alive.current) setError(errorText(err, 'The playlist was not removed.'));
        } finally {
            if (alive.current) setBusyKey('');
        }
    }, [api, load, userId]);

    if (loading) return <Spinner />;
    if (!page) return <Alert tone="danger" role="alert">{error || 'Could not load this person.'}</Alert>;

    const busy = saving || !!busyKey;
    const canSave = page.can.edit;
    const discard = () => { setDrafts({}); setResults({}); };
    const tabs = TABS.map(([id, label]) => ({ id, label, dot: dirty.includes(id) }));

    return (
        <div className="space-y-4" data-testid="user-page">
            <PersonHeader page={page} onBack={onBack} />
            {error && <Alert tone="danger" role="alert">{error}</Alert>}
            {notice && <Alert tone="info" role="status" data-testid="page-notice">{notice}</Alert>}
            {!page.can.edit && (
                <Alert data-testid="read-only-note">
                    You can look at this page but not change it. Editing is for Admins and the Owner.
                </Alert>
            )}

            <PillTabs items={tabs} value={tab} onChange={setTab} label="Sections of this person's page" />

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={-1} className="outline-none">
                {tab === 'overview' && (
                    <OverviewSection page={page} draft={drafts.overview || {}} setDraft={(p) => setDraft('overview', p)}
                        result={results.overview} busy={busy} onImmediate={immediate} />
                )}
                {tab === 'activity' && <ActivitySection page={page} />}
                {tab === 'espg' && (
                    <EspgSection section={page.sections.espg} draft={drafts.espg || {}} setDraft={(p) => setDraft('espg', p)}
                        result={results.espg} onRemove={removePlaylist} busy={busy} />
                )}
                {tab === 'twentyfourseven' && (
                    <TfsSection section={page.sections.twentyfourseven} draft={drafts.twentyfourseven || {}}
                        setDraft={(p) => setDraft('twentyfourseven', p)} result={results.twentyfourseven} busy={busy} />
                )}
                {tab === 'wt' && <WatchTowerSection page={page} />}
            </div>

            {canSave && (dirty.length > 0 || saving) && (
                <StickyBar data-testid="save-bar">
                    <p className={`text-sm ${tx.warn}`} data-testid="dirty-note">
                        Unsaved changes in: {dirty.map((k) => SECTION_LABELS[k]).join(', ')}.
                    </p>
                    <div className="flex items-center gap-2">
                        <Button disabled={busy} onClick={discard}>Discard</Button>
                        <Button variant="primary" data-testid="save-page" disabled={busy || dirty.length === 0} loading={saving} loadingLabel="Saving" onClick={save}>
                            {saving ? 'Saving…' : 'Save changes'}
                        </Button>
                    </div>
                </StickyBar>
            )}
        </div>
    );
}
