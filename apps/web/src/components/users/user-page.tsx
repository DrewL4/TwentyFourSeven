/* eslint-disable @typescript-eslint/ban-ts-comment, react-refresh/only-export-components */
// @ts-nocheck: shared with WatchTower and 24/7, which are plain JS; keep this file identical to theirs.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/*
 * The per-user page, shared by WatchTower, ESPG and 24/7. WatchTower is the source of truth: the page, its
 * rights and its Save all come from WatchTower's signed Users-tab door, so the three apps show the same page.
 * Keep the three copies in step (same sections, same labels, same data-testid values).
 *
 * One Save button for the whole page. It sends every changed section together; WatchTower checks them all
 * first and saves nothing if any section has a problem. If an app goes down while saving, the page says which
 * sections were saved and keeps the unsaved edits so Save can be pressed again for just those.
 */

export const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', manager: 'Manager', user: 'User' };
const APP_LABELS = { wt: 'WatchTower', espg: 'ESPG', twentyfourseven: '24/7' };
const SECTION_LABELS = { overview: 'Overview', espg: 'ESPG', twentyfourseven: '24/7' };
const SECTION_ORDER = ['overview', 'espg', 'twentyfourseven'];
const SOURCE_FLAGS = [['can_view', 'View'], ['can_edit', 'Edit'], ['has_vod_access', 'VOD'], ['has_epg_access', 'EPG'], ['has_catchup_access', 'Catch-up']];
const PLAYLIST_FLAGS = [
    ['can_view', 'View'], ['can_edit', 'Edit'], ['can_add_channels', 'Add channels'], ['can_remove_channels', 'Remove channels'],
    ['can_reorder_channels', 'Reorder channels'], ['can_manage_groups', 'Manage groups'], ['can_share_playlist', 'Share'],
    ['has_vod_access', 'VOD'], ['has_epg_access', 'EPG'], ['has_catchup_access', 'Catch-up'],
];
const HIDDEN = '[hidden]';

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

export function InlineSpinner({ label = 'Loading' }) {
    return (
        <div role="status" aria-label={label} className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 dark:border-gray-700 border-t-blue-600" />
        </div>
    );
}

function Section({ id, title, result, children, note }) {
    const tone = result?.status === 'saved' ? 'text-green-800 dark:text-green-200 bg-green-50 dark:bg-green-900/30'
        : result?.status && result.status !== 'unchanged' ? 'text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-900/30' : '';
    return (
        <section aria-label={title} data-testid={`section-${id}`} className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
            {note && <p className="text-xs text-gray-600 dark:text-gray-400">{note}</p>}
            {result?.status && result.status !== 'unchanged' && (
                <p role={result.status === 'saved' ? 'status' : 'alert'} data-testid={`result-${id}`} className={`rounded p-2 text-sm ${tone}`}>
                    {STATUS_TEXT[result.status] || result.status}{result.message && result.status !== 'saved' ? `: ${result.message}` : ''}
                </p>
            )}
            {children}
        </section>
    );
}

function Field({ label, error, children }) {
    return (
        <label className="block text-xs text-gray-700 dark:text-gray-300">
            {label}
            {children}
            {error && <span role="alert" className="mt-1 block text-red-700 dark:text-red-300">{error}</span>}
        </label>
    );
}

const inputClass = 'mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1 text-sm disabled:bg-gray-100 dark:disabled:bg-gray-700';

function Flags({ row, flags, disabled, onChange, label }) {
    return (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
            {flags.map(([key, text]) => (
                <label key={key} className="flex items-center gap-1 text-xs">
                    <input type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600" checked={!!row[key]} disabled={disabled}
                        aria-label={`${text} ${label}`} onChange={(e) => onChange({ ...row, [key]: e.target.checked })} />
                    {text}
                </label>
            ))}
        </div>
    );
}

function Empty({ children }) {
    return <p className="text-sm text-gray-600 dark:text-gray-400">{children}</p>;
}

function Table({ head, children, label }) {
    return (
        <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm" aria-label={label}>
                <thead className="bg-gray-50 dark:bg-gray-900 text-left text-xs uppercase text-gray-600 dark:text-gray-400">
                    <tr>{head.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">{children}</tbody>
            </table>
        </div>
    );
}

function OverviewSection({ page, draft, setDraft, result, busy, onImmediate }) {
    const o = page.overview;
    const can = page.can;
    const errors = result?.errors || {};
    const value = (key) => (key in draft ? draft[key] : (o[key] || ''));
    const access = { ...o.access, ...(draft.access || {}) };
    const roleOptions = (can.roles || []).filter((r) => r !== o.role);
    const stagedRole = draft.role || '';
    const [demotePassword, setDemotePassword] = useState('');
    return (
        <Section id="overview" title="Overview" result={result}>
            {!can.edit && (
                <p className="text-xs text-gray-600 dark:text-gray-400" data-testid="read-only-note">
                    You can look at this page but not change it. Editing is for Admins and the Owner.
                </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
                {[['first_name', 'First name'], ['last_name', 'Last name'], ['email', 'Email'], ['phone', 'Phone']].map(([key, label]) => (
                    <Field key={key} label={label} error={errors[key]}>
                        <input data-testid={`field-${key}`} className={inputClass} value={value(key)}
                            disabled={!can.edit_basic || busy} onChange={(e) => setDraft({ [key]: e.target.value })} />
                    </Field>
                ))}
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
                <div><dt className="inline text-gray-600 dark:text-gray-400">Username: </dt><dd className="inline">{o.username}</dd></div>
                <div>
                    <dt className="inline text-gray-600 dark:text-gray-400">Role: </dt>
                    <dd className="inline" data-testid="overview-role">{ROLE_LABELS[o.role] || o.role}</dd>
                    {o.role_lapsed && <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">Service expired: counts as a User until renewed</span>}
                </div>
                <div>
                    <dt className="inline text-gray-600 dark:text-gray-400">Approval: </dt>
                    <dd className="inline capitalize" data-testid="overview-approval">{String(o.approval_status || '').replace('_', ' ')}</dd>
                </div>
                <div><dt className="inline text-gray-600 dark:text-gray-400">Joined: </dt><dd className="inline">{formatDay(o.date_joined)}</dd></div>
                <div><dt className="inline text-gray-600 dark:text-gray-400">Account: </dt><dd className="inline">{o.is_active ? 'Active' : 'Turned off'}{o.is_family ? ' · Family' : ''}</dd></div>
            </dl>

            {o.approval_status !== 'approved' && (can.approve || can.deny) && (
                <div className="flex flex-wrap items-center gap-2 rounded border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-2">
                    <span className="text-sm">This sign-up is waiting. These buttons act right away (they are not part of Save).</span>
                    {can.approve && (
                        <button type="button" disabled={busy} onClick={() => onImmediate('approve', { action: 'approve', user_id: o.id }, `Approved ${o.username}.`)}
                            className="rounded bg-green-600 px-3 py-1 text-xs text-white disabled:opacity-40">Approve</button>
                    )}
                    {can.deny && (
                        <button type="button" disabled={busy} onClick={() => onImmediate('deny', { action: 'deny', user_id: o.id }, `Denied ${o.username}.`)}
                            className="rounded bg-red-600 px-3 py-1 text-xs text-white disabled:opacity-40">Deny</button>
                    )}
                </div>
            )}

            <div className="space-y-1" data-testid="overview-services">
                <p className="text-sm font-medium">Services and expiry</p>
                {(o.services || []).length === 0 ? <Empty>No services.</Empty> : (
                    <ul className="text-sm">
                        {o.services.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                )}
                {o.tv_donation_due && <p className="text-xs text-gray-700 dark:text-gray-300">Live TV due {formatDay(o.tv_donation_due)}</p>}
                {o.movie_donation_due && <p className="text-xs text-gray-700 dark:text-gray-300">Movies due {formatDay(o.movie_donation_due)}</p>}
            </div>

            <div className="space-y-1" data-testid="overview-donations">
                <p className="text-sm font-medium">Donations</p>
                {(o.donations || []).length === 0 ? <Empty>No donations yet.</Empty> : (
                    <ul className="text-sm">
                        {o.donations.map((d, i) => (
                            <li key={`${d.date}-${i}`}>{formatDay(d.date)} — ${d.amount}{d.service_type ? ` (${d.service_type})` : ''}</li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="space-y-1">
                <p className="text-sm font-medium">Sign-in to the apps</p>
                {['espg', 'twentyfourseven'].map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                        {can.disable_app ? (
                            <input type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600" checked={access[k] !== false} disabled={busy}
                                aria-label={`${APP_LABELS[k]} sign-in`} data-testid={`access-${k}`}
                                onChange={(e) => setDraft({ access: { ...(draft.access || {}), [k]: e.target.checked } })} />
                        ) : null}
                        <span data-testid={`access-text-${k}`}>{APP_LABELS[k]}{can.disable_app ? '' : `: ${access[k] !== false ? 'On' : 'Off'}`}</span>
                    </label>
                ))}
                {errors.access && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{errors.access}</p>}
                <p className="text-xs text-gray-500 dark:text-gray-400">Turning an app off only stops this person signing in there. Playlists and streams that already exist keep working.</p>
            </div>

            {roleOptions.length > 0 && can.edit && (
                <div className="space-y-1" data-testid="role-change">
                    <Field label="Change role" error={errors.role}>
                        <select data-testid="role-select" className={inputClass} value={stagedRole} disabled={busy}
                            onChange={(e) => setDraft(e.target.value ? { role: e.target.value } : { role: undefined, password: undefined })}>
                            <option value="">Keep as {ROLE_LABELS[o.role]}</option>
                            {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                    </Field>
                    {stagedRole && (
                        <Field label="Your password (to confirm the role change)" error={errors.password}>
                            <input type="password" autoComplete="current-password" data-testid="role-password" className={inputClass}
                                value={draft.password || ''} disabled={busy} onChange={(e) => setDraft({ password: e.target.value })} />
                        </Field>
                    )}
                </div>
            )}
            {roleOptions.length > 0 && !can.edit && (
                <div className="flex flex-wrap items-center gap-2" data-testid="role-demote">
                    <span className="text-sm">Turn this {ROLE_LABELS[o.role]} back into a regular user (acts right away).</span>
                    <input type="password" autoComplete="current-password" aria-label="Your password" placeholder="Your password"
                        value={demotePassword} onChange={(e) => setDemotePassword(e.target.value)}
                        className="w-32 rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs" />
                    <button type="button" disabled={busy || !demotePassword}
                        onClick={() => onImmediate('demote', { action: 'set_role', user_id: o.id, role: roleOptions[0], password: demotePassword },
                            `${o.username} is now ${ROLE_LABELS[roleOptions[0]]}.`, () => setDemotePassword(''))}
                        className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-40">Demote to {ROLE_LABELS[roleOptions[0]]}</button>
                </div>
            )}
        </Section>
    );
}

function ActivitySection({ page }) {
    const a = page.activity;
    const log = a.log;
    return (
        <Section id="activity" title="Activity">
            <div className="grid gap-4 md:grid-cols-2">
                <div data-testid="activity-logins">
                    <p className="text-sm font-medium">Last login</p>
                    {['wt', 'espg', 'twentyfourseven'].map((k) => (
                        <p key={k} className="text-sm">{APP_LABELS[k]}: {formatWhen(a.last_login?.[k])}</p>
                    ))}
                </div>
                <div data-testid="activity-uses">
                    <p className="text-sm font-medium">Last service use</p>
                    {(a.last_used || []).length === 0 ? <Empty>Nothing yet.</Empty> : a.last_used.map((u) => (
                        <p key={u.key} className="text-sm"><strong>{u.label}</strong>: {u.what ? `${u.what}, ` : ''}{formatWhen(u.at)}</p>
                    ))}
                </div>
            </div>
            <div data-testid="activity-log">
                <p className="text-sm font-medium">Activity log</p>
                {log === null ? <Empty>The activity log is not available for this person.</Empty>
                    : log.length === 0 ? <Empty>No activity logged for this person.</Empty> : (
                        <Table label="Activity log" head={['When', 'App', 'Who', 'What', 'Result']}>
                            {log.map((e) => (
                                <tr key={e.id} className="align-top">
                                    <td className="px-3 py-1 text-xs">{formatWhen(e.occurred_at)}</td>
                                    <td className="px-3 py-1 text-xs">{APP_LABELS[e.app] || e.app}</td>
                                    <td className="px-3 py-1 text-xs">{e.actor_name}{e.actor_role ? ` (${e.actor_role})` : ''}</td>
                                    <td className="px-3 py-1 text-xs">{e.action}{e.target_label ? ` → ${e.target_label}` : ''}{e.is_actor ? ' (done by this person)' : ''}</td>
                                    <td className="px-3 py-1 text-xs">{e.result}</td>
                                </tr>
                            ))}
                        </Table>
                    )}
            </div>
        </Section>
    );
}

function WatchTowerSection({ page }) {
    const w = page.wt;
    const none = w.requests === null && w.issues === null;
    return (
        <Section id="wt" title="WatchTower" note="Read-only: this person's requests and issue reports.">
            {none ? <Empty>Requests and issue reports are not shown to you.</Empty> : (
                <>
                    <div data-testid="wt-requests">
                        <p className="text-sm font-medium">Media requests</p>
                        {(w.requests || []).length === 0 ? <Empty>No media requests.</Empty> : (
                            <Table label="Media requests" head={['Title', 'Type', 'Status', 'When']}>
                                {w.requests.map((r) => (
                                    <tr key={r.id}>
                                        <td className="px-3 py-1 text-xs">{r.title}{r.season_number ? ` S${r.season_number}` : ''}{r.episode_number ? `E${r.episode_number}` : ''}</td>
                                        <td className="px-3 py-1 text-xs">{r.media_type}</td>
                                        <td className="px-3 py-1 text-xs">{r.status}</td>
                                        <td className="px-3 py-1 text-xs">{formatWhen(r.at)}</td>
                                    </tr>
                                ))}
                            </Table>
                        )}
                    </div>
                    <div data-testid="wt-channel-requests">
                        <p className="text-sm font-medium">Channel requests</p>
                        {(w.channel_requests || []).length === 0 ? <Empty>No channel requests.</Empty> : (
                            <Table label="Channel requests" head={['Channel', 'Playlist', 'Status', 'When']}>
                                {w.channel_requests.map((r) => (
                                    <tr key={r.id}>
                                        <td className="px-3 py-1 text-xs">{r.channel_name}</td>
                                        <td className="px-3 py-1 text-xs">{r.playlist}</td>
                                        <td className="px-3 py-1 text-xs">{r.status}</td>
                                        <td className="px-3 py-1 text-xs">{formatWhen(r.at)}</td>
                                    </tr>
                                ))}
                            </Table>
                        )}
                    </div>
                    <div data-testid="wt-signup-requests">
                        <p className="text-sm font-medium">Live TV sign-up requests</p>
                        {(w.signup_requests || []).length === 0 ? <Empty>None.</Empty> : (
                            <ul className="text-sm">{w.signup_requests.map((r) => <li key={r.id}>{r.package} — {r.status} ({formatWhen(r.at)})</li>)}</ul>
                        )}
                    </div>
                    <div data-testid="wt-issues">
                        <p className="text-sm font-medium">Issue reports</p>
                        {(w.issues || []).length === 0 ? <Empty>No issue reports.</Empty> : (
                            <Table label="Issue reports" head={['Content', 'Service', 'Issue', 'Status', 'When']}>
                                {w.issues.map((r) => (
                                    <tr key={r.id} className="align-top">
                                        <td className="px-3 py-1 text-xs">{r.content}</td>
                                        <td className="px-3 py-1 text-xs">{r.service}</td>
                                        <td className="px-3 py-1 text-xs">{r.issue_type}{r.details ? ` — ${r.details}` : ''}</td>
                                        <td className="px-3 py-1 text-xs">{r.status}</td>
                                        <td className="px-3 py-1 text-xs">{formatWhen(r.at)}</td>
                                    </tr>
                                ))}
                            </Table>
                        )}
                    </div>
                </>
            )}
        </Section>
    );
}

const pick = (obj, keys) => keys.reduce((acc, k) => (k in obj ? { ...acc, [k]: obj[k] } : acc), {});

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

function PasswordInput({ value, onChange, disabled, label }) {
    const [shown, setShown] = useState(false);
    return (
        <span className="flex items-center gap-1">
            <input type={shown ? 'text' : 'password'} autoComplete="new-password" aria-label={label} className={inputClass}
                value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
            <button type="button" onClick={() => setShown((s) => !s)} className="mt-1 rounded border border-gray-300 dark:border-gray-600 px-1 text-xs">
                {shown ? 'Hide' : 'Show'}
            </button>
        </span>
    );
}

function EspgSources({ data, draft, setDraft, editable, error }) {
    const rows = draft.source_permissions || baseSourceRows(data);
    const byId = Object.fromEntries(rows.map((r) => [r.source, r]));
    const { rights } = data;
    const update = (next) => setDraft({ source_permissions: next });
    const edit = (row) => update(rows.map((r) => (r.source === row.source ? row : r)));
    return (
        <div data-testid="espg-sources" className="space-y-2">
            <p className="text-sm font-medium">Source permissions</p>
            {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
            {!rights.see_source_passwords && <p className="text-xs text-gray-600 dark:text-gray-400">Source passwords are only shown to the Owner.</p>}
            {data.sources.length === 0 ? <Empty>No sources.</Empty> : (
                <Table label="Source permissions" head={['Source', 'Access', 'Rights', 'Login']}>
                    {data.sources.map((s) => {
                        const row = byId[s.id];
                        const perm = s.permission;
                        return (
                            <tr key={s.id} className="align-top" data-testid={`espg-source-${s.id}`}>
                                <td className="px-3 py-2 text-xs"><p className="font-medium">{s.name}</p><p className="text-gray-600 dark:text-gray-400">{s.source_type}{s.public ? ' · public' : ''}</p></td>
                                <td className="px-3 py-2 text-xs">
                                    {s.public && !row ? <span>Public: available to everyone</span> : (
                                        <label className="flex items-center gap-1">
                                            <input type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600" checked={!!row} disabled={!editable}
                                                aria-label={`Allow ${s.name}`}
                                                onChange={(e) => update(e.target.checked ? [...rows, { source: s.id, can_view: true }] : rows.filter((r) => r.source !== s.id))} />
                                            Allowed
                                        </label>
                                    )}
                                </td>
                                <td className="px-3 py-2">
                                    {row && <Flags row={row} flags={SOURCE_FLAGS} disabled={!editable} onChange={edit} label={s.name} />}
                                </td>
                                <td className="px-3 py-2 text-xs">
                                    {row && rights.see_source_usernames && (
                                        <input aria-label={`Username for ${s.name}`} placeholder="Username" className={inputClass}
                                            value={row.username === undefined ? '' : row.username}
                                            disabled={!editable || row.username === HIDDEN}
                                            onChange={(e) => edit({ ...row, username: e.target.value })} />
                                    )}
                                    {row && rights.see_source_passwords && (
                                        <PasswordInput label={`Password for ${s.name}`} value={row.password || ''} disabled={!editable}
                                            onChange={(v) => edit({ ...row, password: v })} />
                                    )}
                                    {row && !rights.see_source_passwords && perm && (
                                        <p className="text-gray-600 dark:text-gray-400">{perm.has_password ? 'Password set (hidden)' : 'No password'}</p>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </Table>
            )}
        </div>
    );
}

function EspgPlaylists({ data, draft, setDraft, editable, error }) {
    const rows = draft.playlist_permissions || basePlaylistRows(data);
    const byId = Object.fromEntries(rows.map((r) => [r.playlist, r]));
    const resets = draft.reset_login_playlists || [];
    const { rights } = data;
    const update = (next) => setDraft({ playlist_permissions: next });
    const edit = (row) => update(rows.map((r) => (r.playlist === row.playlist ? row : r)));
    return (
        <div data-testid="espg-playlists" className="space-y-2">
            <p className="text-sm font-medium">Playlist permissions</p>
            {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
            {rights.logins_hidden && <p className="text-xs text-gray-600 dark:text-gray-400">This person's playlist logins are not shown to you.</p>}
            {data.playlists.length === 0 ? <Empty>No playlists.</Empty> : (
                <Table label="Playlist permissions" head={['Playlist', 'Access', 'Rights', 'Logins']}>
                    {data.playlists.map((p) => {
                        const row = byId[p.id];
                        return (
                            <tr key={p.id} className="align-top" data-testid={`espg-playlist-${p.id}`}>
                                <td className="px-3 py-2 text-xs"><p className="font-medium">{p.name}</p><p className="text-gray-600 dark:text-gray-400">{p.public ? 'Public' : 'Private'}{p.active ? '' : ' · inactive'}</p></td>
                                <td className="px-3 py-2 text-xs">
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600" checked={!!row} disabled={!editable || rights.logins_hidden}
                                            aria-label={`Allow playlist ${p.name}`}
                                            onChange={(e) => update(e.target.checked ? [...rows, { playlist: p.id, can_view: true }] : rows.filter((r) => r.playlist !== p.id))} />
                                        Allowed
                                    </label>
                                </td>
                                <td className="px-3 py-2">
                                    {row && <Flags row={row} flags={PLAYLIST_FLAGS} disabled={!editable || rights.logins_hidden} onChange={edit} label={p.name} />}
                                </td>
                                <td className="px-3 py-2 text-xs">
                                    {row && !rights.logins_hidden && (
                                        <div className="space-y-1">
                                            <input aria-label={`Login username for ${p.name}`} placeholder="Login username" className={inputClass}
                                                value={row.xtream_username || ''} disabled={!editable}
                                                onChange={(e) => edit({ ...row, xtream_username: e.target.value })} />
                                            <PasswordInput label={`Login password for ${p.name}`} value={row.xtream_password || ''} disabled={!editable}
                                                onChange={(v) => edit({ ...row, xtream_password: v })} />
                                            {editable && (
                                                <label className="flex items-center gap-1">
                                                    <input type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600" checked={resets.includes(p.id)}
                                                        aria-label={`Reset login to default for ${p.name}`}
                                                        onChange={(e) => setDraft({ reset_login_playlists: e.target.checked ? [...resets, p.id] : resets.filter((i) => i !== p.id) })} />
                                                    Reset login to default (on Save)
                                                </label>
                                            )}
                                        </div>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </Table>
            )}
        </div>
    );
}

function EspgSports({ data, draft, setDraft, editable, error }) {
    const s = data.sports;
    const selected = draft.sports_group_ids || s.selected_ids;
    return (
        <div data-testid="espg-sports" className="space-y-2">
            <p className="text-sm font-medium">Custom sports</p>
            {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
            <p className="text-xs text-gray-600 dark:text-gray-400">{selected.length === 0 ? 'No groups picked: this person gets all sports.' : `${selected.length} group(s) picked.`}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">A lock means an admin turned that group on for all users. If no other groups are picked, the person gets those as well.</p>
            {s.groups.length === 0 ? <Empty>No custom sports groups.</Empty> : (
                <div className="grid gap-1 md:grid-cols-3">
                    {s.groups.map((g) => (
                        <label key={g.id} className="flex items-center gap-1 text-sm">
                            <input type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600" checked={g.locked || selected.includes(g.id)} disabled={!editable || g.locked}
                                aria-label={`Sports group ${g.name}`}
                                onChange={(e) => setDraft({ sports_group_ids: e.target.checked ? [...selected, g.id] : selected.filter((i) => i !== g.id) })} />
                            {g.name}{g.locked ? ' (turned on for everyone)' : ''}{g.active ? '' : ' (off)'}
                        </label>
                    ))}
                </div>
            )}
            <p className="text-sm" data-testid="espg-favorite">
                Favorite team{(s.ncaaf_favorite_team_ids || []).length === 1 ? '' : 's'} (college football):{' '}
                {(s.ncaaf_favorite_team_ids || []).length === 0 ? 'none' : s.ncaaf_favorite_team_ids.join(', ')}
                {s.ncaaf_include_fcs ? ' · includes FCS' : ''}
                <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">(set by the person in ESPG)</span>
            </p>
        </div>
    );
}

function EspgOwned({ data, onRemove, busy }) {
    const [confirming, setConfirming] = useState(null);
    const list = data.owned_playlists;
    return (
        <div data-testid="espg-owned" className="space-y-2">
            <p className="text-sm font-medium">Their playlists</p>
            {list.length === 0 ? <Empty>This person has no playlists of their own.</Empty> : (
                <Table label="Their playlists" head={['Name', 'Channels', 'Movies', 'Series', 'Max connections', 'Updated', '']}>
                    {list.map((p) => (
                        <tr key={p.id} data-testid={`espg-owned-${p.id}`}>
                            <td className="px-3 py-1 text-xs">{p.name}{p.public ? ' · public' : ''}{p.active ? '' : ' · inactive'}</td>
                            <td className="px-3 py-1 text-xs">{p.channels}</td>
                            <td className="px-3 py-1 text-xs">{p.movies}</td>
                            <td className="px-3 py-1 text-xs">{p.series}</td>
                            <td className="px-3 py-1 text-xs">{p.max_connections}</td>
                            <td className="px-3 py-1 text-xs">{formatWhen(p.updated_at)}</td>
                            <td className="px-3 py-1 text-xs">
                                {p.can_remove && (confirming === p.id ? (
                                    <span className="flex gap-1">
                                        <button type="button" disabled={busy} onClick={() => { setConfirming(null); onRemove(p); }}
                                            className="rounded bg-red-600 px-2 py-0.5 text-white disabled:opacity-40">Yes, remove</button>
                                        <button type="button" onClick={() => setConfirming(null)} className="rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5">Keep</button>
                                    </span>
                                ) : (
                                    <button type="button" disabled={busy} onClick={() => setConfirming(p.id)}
                                        className="rounded border border-red-300 px-2 py-0.5 text-red-700 dark:text-red-300 disabled:opacity-40">Remove</button>
                                ))}
                            </td>
                        </tr>
                    ))}
                </Table>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">Removing a playlist acts right away (it is not part of Save) and cannot be undone.</p>
        </div>
    );
}

function EspgStreams({ data }) {
    const s = data.streams;
    return (
        <div data-testid="espg-streams" className="space-y-1">
            <p className="text-sm font-medium">Stream limits</p>
            {s.tv_connections === null ? <Empty>Stream limits could not be read.</Empty> : (
                <>
                    <p className="text-sm">TV connections: {s.tv_connections}{s.max_247_streams !== null ? ` · 24/7 streams allowed: ${s.max_247_streams}` : ''}</p>
                    {(s.lines || []).map((l) => <p key={l.source} className="text-xs text-gray-700 dark:text-gray-300">{l.source}: {l.max_connections}</p>)}
                </>
            )}
        </div>
    );
}

function EspgSection({ section, draft, setDraft, result, onRemove, busy }) {
    const errors = result?.errors || {};
    if (section.status !== 'ok') {
        return (
            <Section id="espg" title="ESPG" result={result}>
                <Empty>{section.message || 'ESPG is not available right now.'}</Empty>
            </Section>
        );
    }
    const data = section.data;
    const editable = !!data.rights.edit && !busy;
    const props = { data, draft, setDraft, editable };
    return (
        <Section id="espg" title="ESPG" result={result}>
            {!data.rights.edit && <p className="text-xs text-gray-600 dark:text-gray-400">View only.</p>}
            <p className="text-sm text-gray-700 dark:text-gray-300">
                {data.user.email} · joined {formatDay(data.user.date_joined)} · last ESPG sign-in {formatWhen(data.user.last_login)}
            </p>
            <EspgSources {...props} error={errors.source_permissions} />
            <EspgPlaylists {...props} error={errors.playlist_permissions || errors.reset_login_playlists} />
            <EspgSports {...props} error={errors.sports_group_ids} />
            <EspgOwned data={data} onRemove={onRemove} busy={busy} />
            <EspgStreams data={data} />
        </Section>
    );
}

function TfsSection({ section, draft, setDraft, result, busy }) {
    const errors = result?.errors || {};
    if (section.status !== 'ok') {
        return (
            <Section id="twentyfourseven" title="24/7" result={result}>
                <Empty>{section.message || '24/7 is not available right now.'}</Empty>
            </Section>
        );
    }
    const d = section.data;
    const limitEditable = d.stream_limit?.editable !== false;
    const editable = !!d.rights.edit && !busy && limitEditable;
    const limit = 'max_streams' in draft ? draft.max_streams : d.stream_limit?.max_streams;
    return (
        <Section id="twentyfourseven" title="24/7" result={result}>
            {!d.rights.edit && <p className="text-xs text-gray-600 dark:text-gray-400">View only.</p>}
            <p className="text-sm text-gray-700 dark:text-gray-300">
                {d.user.email} · joined {formatDay(d.user.created_at)} · last 24/7 sign-in {formatWhen(d.user.last_login)}
            </p>
            <div data-testid="tfs-streams" className="space-y-1">
                <p className="text-sm font-medium">Stream limits</p>
                {!d.stream_limit?.has_login ? <Empty>No playlist login yet, so no stream limit is set.</Empty> : (
                    <Field label="Streams at once" error={errors.max_streams}>
                        <input type="number" min="0" max="50" data-testid="field-max-streams" className={`${inputClass} w-24`}
                            value={limit === undefined || limit === null ? '' : limit} disabled={!editable}
                            onChange={(e) => setDraft({ max_streams: e.target.value === '' ? '' : Number(e.target.value) })} />
                    </Field>
                )}
                {d.stream_limit?.has_login && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                        Login: {d.stream_limit.username}. {d.stream_limit.linked ? "While linked to ESPG, the limit follows the person's ESPG TV connections plus one." : 'This is how many 24/7 streams they may run at once.'}
                    </p>
                )}
            </div>
            <div data-testid="tfs-franchises" className="space-y-1">
                <p className="text-sm font-medium">Franchises and channels</p>
                {d.franchises.length === 0 ? <Empty>This person has not created any franchises.</Empty> : (
                    <Table label="Franchises" head={['Franchise', 'Entries', 'Channels']}>
                        {d.franchises.map((f) => (
                            <tr key={f.id} className="align-top" data-testid={`tfs-franchise-${f.id}`}>
                                <td className="px-3 py-1 text-xs font-medium">{f.name}</td>
                                <td className="px-3 py-1 text-xs">{f.entry_count}</td>
                                <td className="px-3 py-1 text-xs">
                                    {f.channels.length === 0 ? 'None' : f.channels.map((c) => `${c.number} ${c.name}`).join(', ')}
                                </td>
                            </tr>
                        ))}
                    </Table>
                )}
            </div>
            <div data-testid="tfs-viewing" className="space-y-1">
                <p className="text-sm font-medium">Recent viewing</p>
                {d.recent_viewing.length === 0 ? <Empty>No viewing recorded for this person.</Empty> : (
                    <Table label="Recent viewing" head={['When', 'Channel', 'Program', 'Length']}>
                        {d.recent_viewing.map((v) => (
                            <tr key={v.id}>
                                <td className="px-3 py-1 text-xs">{formatWhen(v.at)}</td>
                                <td className="px-3 py-1 text-xs">{v.channel_number} {v.channel}</td>
                                <td className="px-3 py-1 text-xs">{v.program}</td>
                                <td className="px-3 py-1 text-xs">{v.duration_seconds ? `${Math.round(v.duration_seconds / 60)} min` : '—'}</td>
                            </tr>
                        ))}
                    </Table>
                )}
            </div>
        </Section>
    );
}

const prune = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export default function UserPage({ api, userId, onBack, Spinner = InlineSpinner }) {
    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [drafts, setDrafts] = useState({});
    const [results, setResults] = useState({});
    const [saving, setSaving] = useState(false);
    const [busyKey, setBusyKey] = useState('');
    const alive = useRef(true);
    useEffect(() => () => { alive.current = false; }, []);

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
            else if (data.saved) setNotice('Some parts were saved and some were not. The ones that were not saved keep your edits; press Save to try them again.');
            else setNotice('Nothing was saved. Fix the problems shown and press Save again.');
        } catch (err) {
            if (alive.current) setError(errorText(err, 'The page was not saved.'));
        } finally {
            if (alive.current) setSaving(false);
        }
    }, [api, dirty, drafts, userId]);

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
    if (!page) return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error || 'Could not load this person.'}</p>;

    const o = page.overview;
    const busy = saving || !!busyKey;
    const name = [o.first_name, o.last_name].filter(Boolean).join(' ') || o.username;
    const canSave = page.can.edit;
    return (
        <div className="space-y-4" data-testid="user-page">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    {onBack && <button type="button" onClick={onBack} className="text-xs text-blue-600 underline">← All users</button>}
                    <h2 className="text-xl font-semibold" data-testid="user-page-name">{name}</h2>
                    <p className="text-xs text-gray-600 dark:text-gray-400">{o.username} · {o.email} · {ROLE_LABELS[o.role] || o.role}</p>
                </div>
                {canSave && (
                    <div className="flex items-center gap-2">
                        {dirty.length > 0 && (
                            <button type="button" disabled={busy} onClick={() => { setDrafts({}); setResults({}); }}
                                className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm disabled:opacity-40">Discard edits</button>
                        )}
                        <button type="button" data-testid="save-page" disabled={busy || dirty.length === 0} onClick={save}
                            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                            {saving && <span role="status" aria-label="Saving" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                            {saving ? 'Saving…' : 'Save changes'}
                        </button>
                    </div>
                )}
            </div>
            {error && <p role="alert" className="rounded bg-red-50 dark:bg-red-900/30 p-2 text-sm text-red-800 dark:text-red-200">{error}</p>}
            {notice && <p role="status" data-testid="page-notice" className="rounded bg-blue-50 dark:bg-blue-900/30 p-2 text-sm text-blue-900 dark:text-blue-100">{notice}</p>}
            {dirty.length > 0 && (
                <p className="text-xs text-amber-800 dark:text-amber-200" data-testid="dirty-note">
                    Unsaved changes in: {dirty.map((k) => SECTION_LABELS[k]).join(', ')}.
                </p>
            )}

            <OverviewSection page={page} draft={drafts.overview || {}} setDraft={(p) => setDraft('overview', p)}
                result={results.overview} busy={busy} onImmediate={immediate} />
            <ActivitySection page={page} />
            <EspgSection section={page.sections.espg} draft={drafts.espg || {}} setDraft={(p) => setDraft('espg', p)}
                result={results.espg} onRemove={removePlaylist} busy={busy} />
            <TfsSection section={page.sections.twentyfourseven} draft={drafts.twentyfourseven || {}}
                setDraft={(p) => setDraft('twentyfourseven', p)} result={results.twentyfourseven} busy={busy} />
            <WatchTowerSection page={page} />
        </div>
    );
}
