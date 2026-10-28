"use client";

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { bundleIsStale, mayReload, scriptFiles, scriptPath } from "@/lib/stale-bundle";

const RELOAD_KEY = "tfs:bundle-reload-at";
const CHECK_EVERY_MS = 2 * 60 * 1000;

/**
 * Keeps a page that stays open (a TV browser, a pinned tab) honest:
 *  - after a deploy it reloads to pick up the new build, but never during playback or
 *    while the viewer is typing, and at most once a minute;
 *  - it re-reads the sign-in, so a session that ended elsewhere sends the page to the
 *    sign-in screen instead of looking signed in.
 * Runs when the tab becomes visible, on focus, and every two minutes while visible.
 */
export default function BundleWatch() {
  const { data: session, refetch } = authClient.useSession();
  const signedIn = !!session;

  useEffect(() => {
    let busy = false;

    const check = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        if (signedIn) void refetch();

        const res = await fetch(window.location.pathname + window.location.search, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return;
        const fresh = scriptFiles(await res.text());
        const running = Array.from(document.querySelectorAll("script[src]"))
          .map((s) => scriptPath(s.getAttribute("src") || ""))
          .filter((p): p is string => !!p);
        if (!bundleIsStale(running, fresh)) return;

        const playing = !!document.querySelector("video");
        const typing = Array.from(document.querySelectorAll("input, textarea")).some(
          (el) => el === document.activeElement || ((el as HTMLInputElement).type !== "hidden" && !!(el as HTMLInputElement).value),
        );
        if (playing || typing) return; // try again at the next check
        const last = Number(window.sessionStorage.getItem(RELOAD_KEY));
        if (!mayReload(Number.isFinite(last) && last > 0 ? last : null, Date.now())) return;
        window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
      } catch {
        // offline or server restarting: the next check tries again
      } finally {
        busy = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const first = window.setTimeout(() => void check(), 3000);
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [signedIn, refetch]);

  return null;
}
