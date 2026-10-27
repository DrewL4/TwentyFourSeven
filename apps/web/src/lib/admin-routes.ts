// Who may open which pages. Roles come from WatchTower: Owner and Admin are ADMIN,
// Manager is MANAGER, everyone else is a viewer. Viewers keep Home, the Guide (with
// its player) and their dashboard. The server enforces the same split on its APIs;
// these lists only keep the UI from offering dead ends.

/** Managers and Admins: channels, the library and franchise orders. */
export const MANAGER_PATHS = ["/channels", "/library", "/settings/franchises"] as const;

/** Admins only: users, viewers and all other settings (sources, integrations, ffmpeg). */
export const ADMIN_ONLY_PATHS = ["/users", "/viewers", "/settings"] as const;

function matches(pathname: string, paths: readonly string[]): boolean {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isManagerPath(pathname: string): boolean {
  return matches(pathname, MANAGER_PATHS);
}

/** True when a Manager is NOT enough, i.e. only Admins may open it. */
export function isAdminOnlyPath(pathname: string): boolean {
  if (isManagerPath(pathname)) return false;
  return matches(pathname, ADMIN_ONLY_PATHS);
}

/** True when the page needs at least the Manager role. */
export function isStaffPath(pathname: string): boolean {
  return isManagerPath(pathname) || isAdminOnlyPath(pathname);
}

export type NavRole = "ADMIN" | "MANAGER" | "USER";

export function canOpenPath(role: NavRole, pathname: string): boolean {
  if (role === "ADMIN") return true;
  if (isAdminOnlyPath(pathname)) return false;
  if (isManagerPath(pathname)) return role === "MANAGER";
  return true;
}
