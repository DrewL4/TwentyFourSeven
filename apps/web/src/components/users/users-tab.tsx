"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  APP_KEYS, APP_LABELS, ROLE_LABELS, filterUsers, formatDay, formatWhen,
  type TabDirectory, type TabUser, type UsersTabApi,
} from '@/lib/users-tab-helpers'
import { Loader2 } from 'lucide-react'

/*
 * The shared Users tab. WatchTower, ESPG and 24/7 show the same list with the same actions; WatchTower is
 * the source of truth and decides every action from the person's WatchTower role. Keep the three copies
 * in step: same columns, same labels, same data-testid values.
 */

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string }
  return e?.response?.data?.error || e?.message || fallback
}

const inputCls = 'rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'

function Spinner() {
  return (
    <div className="flex justify-center py-10" role="status" aria-label="Loading users">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
    </div>
  )
}

function RoleCell({ row, busy, onChange }: {
  row: TabUser
  busy: boolean
  onChange: (row: TabUser, role: string, password: string, clear: () => void) => void
}) {
  const options = row.can?.roles || []
  const [role, setRole] = useState(row.role)
  const [password, setPassword] = useState('')
  // Follow the server's role when it changes (after a save); do not reset on first mount.
  const seenRole = useRef(row.role)
  useEffect(() => {
    if (seenRole.current !== row.role) {
      seenRole.current = row.role
      setRole(row.role)
    }
  }, [row.role])
  return (
    <div className="space-y-1">
      <span data-testid={`role-${row.id}`} className="inline-block rounded bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-800 dark:text-gray-100">
        {ROLE_LABELS[row.role] || row.role}
      </span>
      {row.role_lapsed && <p className="text-xs text-amber-700 dark:text-amber-300">Service expired: counts as a User until renewed</p>}
      {options.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <select aria-label={`New role for ${row.username}`} value={role} onChange={(e) => setRole(e.target.value)}
            className={`${inputCls} px-1 py-0.5 text-xs`}>
            <option value={row.role}>{ROLE_LABELS[row.role]}</option>
            {options.filter((r) => r !== row.role).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          {role !== row.role && (
            <>
              <input type="password" autoComplete="current-password" aria-label={`Your password to change ${row.username}`}
                placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls} w-28 px-1 py-0.5 text-xs`} />
              <button type="button" disabled={busy || !password}
                onClick={() => onChange(row, role, password, () => setPassword(''))}
                className="rounded bg-violet-700 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40">
                Change
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function EditRow({ row, busy, onSave, onCancel }: {
  row: TabUser
  busy: boolean
  onSave: (row: TabUser, fields: Record<string, string>) => void
  onCancel: () => void
}) {
  const [fields, setFields] = useState<Record<string, string>>({
    first_name: row.first_name || '', last_name: row.last_name || '', email: row.email || '', phone: row.phone || '',
  })
  return (
    <tr className="bg-violet-50 dark:bg-violet-900/20" data-testid={`edit-row-${row.id}`}>
      <td colSpan={8} className="p-3">
        <div className="grid gap-2 md:grid-cols-4">
          {Object.keys(fields).map((key) => (
            <label key={key} className="text-xs text-gray-700 dark:text-gray-300">
              {key.replace('_', ' ')}
              <input value={fields[key]} onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                className={`${inputCls} mt-1 w-full px-2 py-1 text-sm`} />
            </label>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => onSave(row, fields)}
            className="rounded bg-violet-700 px-3 py-1 text-sm text-white disabled:opacity-40">Save</button>
          <button type="button" onClick={onCancel} className={`${inputCls} px-3 py-1 text-sm`}>Cancel</button>
        </div>
      </td>
    </tr>
  )
}

export default function UsersTab({ api, onOpenUser = null }: { api: UsersTabApi; onOpenUser?: ((row: TabUser) => void) | null }) {
  const [data, setData] = useState<TabDirectory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [filters, setFilters] = useState({ search: '', role: 'all', app: 'all' })

  const load = useCallback(async () => {
    try {
      setData(await api.directory())
      setError('')
    } catch (err) {
      setError(errorText(err, 'Could not load users.'))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  const run = useCallback(async (key: string, body: Record<string, unknown>, okMessage: string, after?: () => void) => {
    setBusyKey(key)
    setError('')
    setNotice('')
    try {
      await api.action(body)
      setNotice(okMessage)
      if (after) after()
      await load()
    } catch (err) {
      setError(errorText(err, 'The change was not made.'))
    } finally {
      setBusyKey('')
    }
  }, [api, load])

  const users = useMemo(() => filterUsers(data?.users || [], filters), [data, filters])

  if (loading) return <Spinner />
  if (!data) return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error || 'Could not load users.'}</p>

  const can = data.viewer?.can || {}
  const pending = data.pending_signups || []

  return (
    <div className="space-y-4" data-testid="users-tab">
      {error && <p role="alert" className="rounded bg-red-50 dark:bg-red-900/30 p-2 text-sm text-red-800 dark:text-red-200">{error}</p>}
      {notice && <p role="status" className="rounded bg-green-50 dark:bg-green-900/30 p-2 text-sm text-green-800 dark:text-green-200">{notice}</p>}
      {!can.edit_basic && (
        <p className="text-xs text-gray-600 dark:text-gray-400" data-testid="read-only-note">
          You can see everyone here{can.approve ? ' and approve new sign-ups' : ''}
          {data.viewer?.role === 'manager' ? ', and turn another Manager back into a regular user' : ''}. Editing is for Admins and the Owner.
        </p>
      )}

      {pending.length > 0 && (
        <section aria-label="Sign-ups waiting" className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
          <h3 className="text-sm font-semibold">Sign-ups waiting for approval ({pending.length})</h3>
          <ul className="mt-2 divide-y divide-amber-200 dark:divide-amber-800">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm">
                  {[p.first_name, p.last_name].filter(Boolean).join(' ') || p.username}
                  <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">{p.username} · {p.email}</span>
                </span>
                <span className="flex gap-2">
                  {can.approve && (
                    <button type="button" disabled={busyKey === `approve-${p.id}`}
                      onClick={() => run(`approve-${p.id}`, { action: 'approve', user_id: p.id }, `Approved ${p.username}.`)}
                      className="rounded bg-green-600 px-3 py-1 text-xs text-white disabled:opacity-40">Approve</button>
                  )}
                  {can.deny && (
                    <button type="button" disabled={busyKey === `deny-${p.id}`}
                      onClick={() => run(`deny-${p.id}`, { action: 'deny', user_id: p.id }, `Denied ${p.username}.`)}
                      className="rounded bg-red-600 px-3 py-1 text-xs text-white disabled:opacity-40">Deny</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" aria-label="Search users" placeholder="Search name, username or email" value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          className={`${inputCls} min-w-[14rem] px-2 py-1 text-sm`} />
        <select aria-label="Filter by role" value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}
          className={`${inputCls} px-2 py-1 text-sm`}>
          <option value="all">All roles</option>
          {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select aria-label="Filter by app access" value={filters.app} onChange={(e) => setFilters((f) => ({ ...f, app: e.target.value }))}
          className={`${inputCls} px-2 py-1 text-sm`}>
          <option value="all">All access</option>
          <option value="espg_off">ESPG turned off</option>
          <option value="twentyfourseven_off">24/7 turned off</option>
        </select>
        <span className="text-xs text-gray-600 dark:text-gray-400">{users.length} of {data.users.length} users</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase text-gray-600 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Services</th>
              <th className="px-3 py-2">Donations</th>
              <th className="px-3 py-2">Last login</th>
              <th className="px-3 py-2">Last service use</th>
              <th className="px-3 py-2">App access</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
            {users.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-600 dark:text-gray-400">No users match.</td></tr>
            )}
            {users.map((row) => (
              <React.Fragment key={row.id}>
                <tr data-testid={`user-row-${row.id}`} className="align-top">
                  <td className="px-3 py-2">
                    {onOpenUser ? (
                      <button type="button" data-testid={`user-open-${row.id}`} onClick={() => onOpenUser(row)}
                        className="text-left font-medium text-blue-600 dark:text-blue-400 underline">
                        {[row.first_name, row.last_name].filter(Boolean).join(' ') || row.username}
                      </button>
                    ) : (
                      <p className="font-medium">{[row.first_name, row.last_name].filter(Boolean).join(' ') || row.username}</p>
                    )}
                    <p className="text-xs text-gray-600 dark:text-gray-400">{row.username}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">{row.email}</p>
                    {!row.is_active && <p className="text-xs text-red-700 dark:text-red-300">Account turned off</p>}
                  </td>
                  <td className="px-3 py-2">
                    <RoleCell row={row} busy={busyKey === `role-${row.id}`}
                      onChange={(r, role, password, clear) => run(`role-${r.id}`,
                        { action: 'set_role', user_id: r.id, role, password },
                        `${r.username} is now ${ROLE_LABELS[role]}.`, clear)} />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {(row.services || []).length === 0 ? '—' : (row.services || []).map((s) => <p key={s}>{s}</p>)}
                  </td>
                  <td className="px-3 py-2 text-xs" data-testid={`donations-${row.id}`}>
                    {row.last_donation
                      ? <p>Last: {formatDay(row.last_donation.date)}{row.last_donation.amount ? ` ($${row.last_donation.amount})` : ''}</p>
                      : <p>No donations yet</p>}
                    {row.tv_donation_due && <p>Live TV due {formatDay(row.tv_donation_due)}</p>}
                    {row.movie_donation_due && <p>Movies due {formatDay(row.movie_donation_due)}</p>}
                  </td>
                  <td className="px-3 py-2 text-xs" data-testid={`logins-${row.id}`}>
                    {['wt', 'espg', 'twentyfourseven'].map((k) => (
                      <p key={k}>{APP_LABELS[k]}: {formatWhen(row.last_login?.[k])}</p>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-xs" data-testid={`uses-${row.id}`}>
                    {(row.last_used || []).length === 0 ? 'Nothing yet' : (row.last_used || []).map((u) => (
                      <p key={u.key}><strong>{u.label}</strong>: {u.what ? `${u.what}, ` : ''}{formatWhen(u.at)}</p>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {APP_KEYS.map((k) => {
                      const on = row.access?.[k] !== false
                      return (
                        <p key={k} className="flex items-center gap-1">
                          {can.disable_app && row.can?.disable_app ? (
                            <label className="flex items-center gap-1">
                              <input type="checkbox" checked={on} disabled={busyKey === `${k}-${row.id}`}
                                aria-label={`${APP_LABELS[k]} sign-in for ${row.username}`}
                                onChange={() => run(`${k}-${row.id}`,
                                  { action: 'set_app_access', user_id: row.id, app: k, enabled: !on },
                                  `${APP_LABELS[k]} sign-in ${on ? 'turned off' : 'turned on'} for ${row.username}.`)} />
                              {APP_LABELS[k]}
                            </label>
                          ) : (
                            <span>{APP_LABELS[k]}: {on ? 'On' : 'Off'}</span>
                          )}
                        </p>
                      )
                    })}
                  </td>
                  <td className="px-3 py-2">
                    {row.can?.edit_basic && (
                      <button type="button" onClick={() => setEditingId(editingId === row.id ? null : row.id)}
                        className={`${inputCls} px-2 py-0.5 text-xs`}>Edit</button>
                    )}
                  </td>
                </tr>
                {editingId === row.id && (
                  <EditRow row={row} busy={busyKey === `edit-${row.id}`} onCancel={() => setEditingId(null)}
                    onSave={(r, fields) => run(`edit-${r.id}`, { action: 'edit_basic', user_id: r.id, fields },
                      `Saved ${r.username}.`, () => setEditingId(null))} />
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Turning off an app only stops that person signing in there, so they cannot create their own playlists or channels.
        Playlists and streams that already exist keep working.
      </p>
    </div>
  )
}
