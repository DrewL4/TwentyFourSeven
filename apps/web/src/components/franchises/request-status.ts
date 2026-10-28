/** How a franchise row talks about WatchTower requests and release dates. */

export type WtState = "pending" | "approved" | "downloading" | "available" | "denied" | "failed" | "requested";

export type WtView = { state: WtState; requestedByMe: boolean };

export type ReleaseView = {
  theatrical: string | null;
  theatricalOut: boolean;
  digital: string | null;
  digitalOut: boolean;
  coming: string | null;
  nextEpisode: string | null;
  undated: boolean;
};

export type StatusTone = "blue" | "green" | "amber" | "red";

export type StatusView = {
  text: string;
  tone: StatusTone;
  /** The Request button still makes sense (nothing live in WatchTower, or it was declined or failed). */
  canRequest: boolean;
  requestLabel: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-12-18" -> "Dec 18, 2026", with no time zone shift. */
export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

const WHO = (mine: boolean) => (mine ? " (by you)" : " (by another user)");

/**
 * The status line for a row that is not in the library. `wt` is what WatchTower said (null when
 * nobody asked or WatchTower could not be checked); `requestedLocally` is 24/7's own record of a
 * request, used only when there is no live answer.
 */
export function statusView(wt: WtView | null | undefined, requestedLocally: boolean): StatusView {
  if (wt) {
    const who = WHO(wt.requestedByMe);
    switch (wt.state) {
      case "pending":
        return { text: `Requested, waiting for approval${who}`, tone: "blue", canRequest: false, requestLabel: "Request" };
      case "approved":
        return { text: `Approved, searching for it${who}`, tone: "blue", canRequest: false, requestLabel: "Request" };
      case "downloading":
        return { text: `Downloading now${who}`, tone: "blue", canRequest: false, requestLabel: "Request" };
      case "available":
        return { text: "Ready in WatchTower, on its way to your library", tone: "green", canRequest: false, requestLabel: "Request" };
      case "denied":
        return { text: `Request declined${who}`, tone: "red", canRequest: true, requestLabel: "Request again" };
      case "failed":
        return { text: `Request failed${who}`, tone: "red", canRequest: true, requestLabel: "Try again" };
      default:
        return { text: `Requested${who}`, tone: "blue", canRequest: false, requestLabel: "Request" };
    }
  }
  if (requestedLocally) return { text: "Requested", tone: "blue", canRequest: false, requestLabel: "Request" };
  return { text: "Missing from your library", tone: "amber", canRequest: true, requestLabel: "Request" };
}

/** "In theaters Dec 18, 2026 · Digital Feb 10, 2027", or "" when there is nothing to say. */
export function releaseText(r: ReleaseView | null | undefined): string {
  if (!r) return "";
  const parts: string[] = [];
  if (r.theatrical) parts.push(r.theatricalOut ? "In theaters now" : `In theaters ${formatDay(r.theatrical)}`);
  if (r.digital) parts.push(r.digitalOut ? `Digital since ${formatDay(r.digital)}` : `Digital ${formatDay(r.digital)}`);
  if (r.coming) parts.push(`Coming ${formatDay(r.coming)}`);
  if (r.nextEpisode) parts.push(`Next episode ${formatDay(r.nextEpisode)}`);
  if (!parts.length && r.undated) parts.push("Release date not announced");
  return parts.join(" · ");
}

export const TONE_CLASS: Record<StatusTone, string> = {
  blue: "text-blue-600 dark:text-blue-400",
  green: "text-green-600 dark:text-green-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
};
