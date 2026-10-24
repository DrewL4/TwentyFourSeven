import { bearer } from "./espg-caller";
import type { LinkScope } from "./link-security";

/**
 * ESPG's source sync as a service caller.
 *
 * When an ESPG admin adds this TwentyFourSeven as an M3U source, ESPG fetches
 * the playlist and the guide server to server with its WatchTower app token
 * in `Authorization: Bearer …` (never in the URL). WatchTower confirms the
 * token belongs to the ESPG app, so no key or login has to be typed in.
 *
 * Only the playlist and guide are opened this way. The links we hand back
 * carry no key: ESPG asks us for a short-lived, per-viewer signed link for
 * every channel a viewer plays (POST /api/integrations/espg "sign").
 */

/** Guide-scope resources ESPG's source sync may read (media.m3u / get.php, media.xml / xmltv.php). */
export const ESPG_SERVICE_RESOURCES: ReadonlySet<string> = new Set(["m3u", "xmltv"]);

/** Image passes handed to ESPG last a week; ESPG refreshes them on every sync. */
export const ESPG_SERVICE_IMAGE_PASS_SECONDS = 7 * 24 * 3600;
export const ESPG_SERVICE_SUBJECT = "espg:source-sync";

export function serviceCallAllowed(check: { scope: LinkScope; resource: string }): boolean {
  return check.scope === "guide" && ESPG_SERVICE_RESOURCES.has(check.resource);
}

/**
 * "service" when the request carries a bearer token WatchTower says belongs to
 * ESPG and the address is one ESPG's source sync reads; "absent" when there is
 * no bearer token or the address is not one it may read; "refused" for a
 * bearer token that is not ESPG's.
 */
export async function espgServiceCaller(
  headers: Headers,
  check: { scope: LinkScope; resource: string },
  isEspg: (token: string | null) => Promise<boolean>,
): Promise<"service" | "refused" | "absent"> {
  const token = bearer(headers);
  if (!token) return "absent";
  if (!serviceCallAllowed(check)) return "absent";
  return (await isEspg(token)) ? "service" : "refused";
}

/** `&k=…` for links we hand back, or nothing when the caller gets keyless links. */
export function keyParam(k: string, sep: "&" | "&amp;" = "&"): string {
  return k ? `${sep}k=${k}` : "";
}
