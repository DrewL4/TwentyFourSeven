// Shared constants, types and filters for the Users tab.
export const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', user: 'User' }
export const APP_LABELS: Record<string, string> = { wt: 'WatchTower', espg: 'ESPG', twentyfourseven: '24/7' }
export const APP_KEYS = ['espg', 'twentyfourseven']

export interface TabUser {
  id: number
  username: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  role: string
  role_lapsed?: boolean
  is_active?: boolean
  services?: string[]
  last_donation?: { date?: string; amount?: string; service_type?: string } | null
  tv_donation_due?: string | null
  movie_donation_due?: string | null
  last_login?: Record<string, string | null | undefined>
  last_used?: { key: string; label: string; at?: string | null; what?: string | null }[]
  access?: Record<string, boolean | undefined>
  can?: { roles?: string[]; edit_basic?: boolean; disable_app?: boolean }
}

export interface TabDirectory {
  viewer?: { role?: string; can?: Record<string, boolean | undefined> }
  users: TabUser[]
  pending_signups?: { id: number; username: string; email?: string; first_name?: string; last_name?: string }[]
}

export interface UsersTabApi {
  directory: () => Promise<TabDirectory>
  action: (body: Record<string, unknown>) => Promise<unknown>
}

export function formatWhen(iso?: string | null): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Never'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatDay(iso?: string | null): string {
  if (!iso) return '—'
  const date = new Date(`${String(iso).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function filterUsers(users: TabUser[], { search = '', role = 'all', app = 'all' } = {}): TabUser[] {
  const needle = search.trim().toLowerCase()
  return users.filter((u) => {
    if (role !== 'all' && u.role !== role) return false
    if (app === 'espg_off' && u.access?.espg !== false) return false
    if (app === 'twentyfourseven_off' && u.access?.twentyfourseven !== false) return false
    if (!needle) return true
    const hay = [u.username, u.first_name, u.last_name, u.email].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(needle)
  })
}

