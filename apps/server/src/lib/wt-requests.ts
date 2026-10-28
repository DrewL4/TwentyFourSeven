/**
 * Send a media request to WatchTower as the signed-in user, through WatchTower's own
 * request API (POST /api/requests/). WatchTower applies its normal rules (duplicate check,
 * auto-approval, release dates) exactly as if the user pressed Request there. We send the
 * user's own WatchTower token, so there is no admin override and no `user_id` is ever sent.
 */

export type WtRequestItem = {
  title: string;
  mediaType: "movie" | "tv" | "season" | "episode";
  tmdbId: number;
  overview?: string | null;
  posterPath?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

export type WtRequestOutcome =
  | { ok: true; status: "requested"; requestId: number | null; wtStatus: string | null; message: string }
  | { ok: false; status: "duplicate"; requestId: number | null; message: string }
  | { ok: false; status: "no-token" | "unauthorized" | "rejected" | "unreachable"; message: string };

export const WT_NO_TOKEN_MESSAGE =
  "To request from here, sign out of 24/7 and sign in again once. Then 24/7 can send requests as you.";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function buildWtRequestBody(item: WtRequestItem): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: item.title,
    media_type: item.mediaType,
    tmdb_id: item.tmdbId,
  };
  if (item.overview) body.overview = item.overview;
  if (item.posterPath) body.poster_path = item.posterPath;
  if (item.seasonNumber != null) body.season_number = item.seasonNumber;
  if (item.episodeNumber != null) body.episode_number = item.episodeNumber;
  return body;
}

export async function sendWtRequest(
  opts: { baseUrl: string; userToken: string | null; item: WtRequestItem },
  fetchImpl: FetchLike = fetch,
): Promise<WtRequestOutcome> {
  if (!opts.userToken) return { ok: false, status: "no-token", message: WT_NO_TOKEN_MESSAGE };
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/requests/`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${opts.userToken}`,
      },
      body: JSON.stringify(buildWtRequestBody(opts.item)),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, status: "unreachable", message: "WatchTower could not be reached. Try again in a moment." };
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 201 || response.status === 200) {
    return {
      ok: true,
      status: "requested",
      requestId: typeof data.id === "number" ? data.id : null,
      wtStatus: typeof data.status === "string" ? data.status : null,
      message: typeof data.message === "string" ? data.message : `Requested ${opts.item.title}`,
    };
  }
  if (response.status === 409) {
    return {
      ok: false,
      status: "duplicate",
      requestId: typeof data.existing_request_id === "number" ? data.existing_request_id : null,
      message: typeof data.error === "string" ? data.error : `${opts.item.title} has already been requested`,
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: "unauthorized",
      message: "WatchTower did not accept your sign-in. Sign out of 24/7 and sign in again, then retry.",
    };
  }
  return {
    ok: false,
    status: "rejected",
    message: typeof data.error === "string" ? data.error : `WatchTower refused the request (${response.status})`,
  };
}
