import {
  normalizePlexImageTarget,
  sameOrigin,
  verifyPlexImageSignature,
  type PlexImageTarget,
} from "./plex-image";

type ServerRow = { url: string; token: string | null };

export type PlexImageDecision =
  | { ok: true; upstreamUrl: string; token: string; via: "signature" | "session"; target: PlexImageTarget }
  | { ok: false; status: 400 | 401 | 404; error: string };

/**
 * Decide whether an /images/plex request may be served. Kept free of Next/Prisma so
 * it can be tested directly.
 */
export async function decidePlexImageAccess(input: {
  searchParams: URLSearchParams;
  servers: ServerRow[];
  hasSession: () => Promise<boolean>;
  /** Old never-expiring `sig` links. The route turns these off; links now carry a short-lived `t`. */
  acceptSignature?: boolean;
}): Promise<PlexImageDecision> {
  const { searchParams } = input;
  let target: PlexImageTarget | null = null;

  const rawUrl = searchParams.get("url");
  const origin = searchParams.get("origin");
  const path = searchParams.get("path");
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      parsed.searchParams.delete("X-Plex-Token");
      target = normalizePlexImageTarget(parsed.origin, parsed.pathname + parsed.search);
    } catch {
      target = null;
    }
  } else if (origin && path) {
    target = normalizePlexImageTarget(origin, path);
  }

  // Exact origin match: the token is only ever sent to the server it belongs to.
  const server = target
    ? input.servers.find((s) => s.token && sameOrigin(s.url, target!.origin))
    : undefined;

  let via: "signature" | "session" | null = null;
  if (input.acceptSignature !== false && target && server?.token && verifyPlexImageSignature(target, server.token, searchParams.get("sig"))) {
    via = "signature";
  } else if (await input.hasSession()) {
    via = "session";
  }
  // Without a session or a valid signature, refuse before saying anything else.
  if (!via) {
    return { ok: false, status: 401, error: "Sign in required" };
  }
  if (!target) {
    return { ok: false, status: 400, error: "Only Plex artwork paths can be loaded here" };
  }
  if (!server?.token) {
    return { ok: false, status: 404, error: "Plex server not found or not configured with token" };
  }

  return { ok: true, upstreamUrl: `${target.origin}${target.path}`, token: server.token, via, target };
}

export type PlexImageFetch =
  | { ok: true; contentType: string; body: ArrayBuffer }
  | { ok: false; status: 404 | 502; error: string };

/**
 * Fetch one artwork image from the configured Plex server. Redirects are not followed:
 * fetch() would resend the X-Plex-Token header to wherever the redirect points.
 */
export async function fetchPlexImage(
  upstreamUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlexImageFetch> {
  const res = await fetchImpl(upstreamUrl, {
    headers: { "X-Plex-Token": token, Accept: "image/*" },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status >= 300 && res.status < 400) {
    return { ok: false, status: 502, error: "Image not available (redirect not followed)" };
  }
  if (!res.ok) {
    return { ok: false, status: res.status === 404 ? 404 : 502, error: "Image not available" };
  }
  const contentType = res.headers.get("content-type") || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return { ok: false, status: 502, error: "Upstream did not return an image" };
  }
  return { ok: true, contentType, body: await res.arrayBuffer() };
}
