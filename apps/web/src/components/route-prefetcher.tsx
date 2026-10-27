"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Loads a page's code before it is opened: the main pages when the browser is idle,
 * and any in-app link as soon as it is hovered or touched. It changes nothing on screen,
 * so existing loading spinners behave exactly as before.
 */
export default function RoutePrefetcher({ routes }: { routes: string[] }) {
  const router = useRouter();
  const key = routes.join("|");

  useEffect(() => {
    const idle: (cb: () => void) => void =
      typeof window.requestIdleCallback === "function"
        ? (cb) => window.requestIdleCallback(cb, { timeout: 3000 })
        : (cb) => void setTimeout(cb, 1500);
    let cancelled = false;
    idle(() => {
      if (cancelled) return;
      for (const r of key.split("|").filter(Boolean)) router.prefetch(r);
    });

    const seen = new Set<string>();
    const onIntent = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== window.location.origin) return;
      const href = a.pathname + a.search;
      if (seen.has(href)) return;
      seen.add(href);
      router.prefetch(href);
    };
    document.addEventListener("pointerover", onIntent, { passive: true });
    document.addEventListener("touchstart", onIntent, { passive: true });
    return () => {
      cancelled = true;
      document.removeEventListener("pointerover", onIntent);
      document.removeEventListener("touchstart", onIntent);
    };
  }, [key, router]);

  return null;
}
