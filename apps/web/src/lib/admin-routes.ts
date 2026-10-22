// Pages only WatchTower admins (TFS role ADMIN) may open. Viewers keep Home,
// the Guide (with its player), and their dashboard. The server enforces the same
// split on its APIs; this list only keeps the UI from offering dead ends.
export const ADMIN_ONLY_PATHS = ["/channels", "/library", "/users", "/viewers", "/settings"] as const;

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
