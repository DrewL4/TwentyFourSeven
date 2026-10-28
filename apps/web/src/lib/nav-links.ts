// The links each role sees in the sidebar and the phone tab bar, and the one name
// for the franchise page. Everyone signed in can open it. Kept in one place so the two navs, the Home
// cards and the Settings card cannot drift apart again.
// Rule: an Admin (and the Owner, who is an Admin here) sees everything a Manager
// sees, plus the Admin-only pages.

import { canOpenPath, type NavRole } from "./admin-routes";

export const FRANCHISES_PATH = "/franchises";
/** The one name for the franchise page, everywhere in the app. */
export const FRANCHISES_LABEL = "Franchises";
/** The one plain sentence that says what the page is for. */
export const FRANCHISES_BLURB = "Build a franchise from your library, pick the order it plays in, and request what is missing";

export type NavKey = "home" | "guide" | "channels" | "library" | "franchises" | "users" | "viewers" | "settings";
export type NavLink = { key: NavKey; to: string; label: string };

const SIDEBAR: NavLink[] = [
  { key: "home", to: "/", label: "Home" },
  { key: "guide", to: "/guide", label: "TV Guide" },
  { key: "channels", to: "/channels", label: "Channels" },
  { key: "library", to: "/library", label: "Library" },
  { key: "franchises", to: FRANCHISES_PATH, label: FRANCHISES_LABEL },
  { key: "users", to: "/users", label: "Users" },
  { key: "viewers", to: "/viewers", label: "Viewers" },
  { key: "settings", to: "/settings", label: "Settings" },
];

// The phone bar is short on room. A Manager has no Settings page, so Franchises
// takes the last slot; an Admin keeps Settings and also gets Franchises.
const MOBILE: NavLink[] = [
  { key: "home", to: "/", label: "Home" },
  { key: "guide", to: "/guide", label: "Guide" },
  { key: "channels", to: "/channels", label: "Channels" },
  { key: "library", to: "/library", label: "Library" },
  { key: "franchises", to: FRANCHISES_PATH, label: FRANCHISES_LABEL },
  { key: "settings", to: "/settings", label: "Settings" },
];

function visible(links: NavLink[], role: NavRole): NavLink[] {
  return links.filter((link) => canOpenPath(role, link.to));
}

export function sidebarLinksFor(role: NavRole): NavLink[] {
  return visible(SIDEBAR, role);
}

export function mobileLinksFor(role: NavRole): NavLink[] {
  return visible(MOBILE, role);
}
