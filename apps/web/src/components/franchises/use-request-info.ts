"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { orpc } from "@/utils/orpc";
import type { ReleaseView, WtState, WtView } from "./request-status";

export type InfoEntry = {
  key: string;
  kind: "MOVIE" | "SHOW" | "SEASON" | "EPISODES";
  tmdbId: number | null;
  seasonNumber: number | null;
  releaseDate: string | null;
};

type Outcome = { ok: boolean; status: string; wtStatus?: string | null };

const KNOWN: WtState[] = ["pending", "approved", "downloading", "available", "denied", "failed"];
const stateOf = (s: string | null | undefined): WtState => (KNOWN as string[]).includes(s ?? "") ? (s as WtState) : "requested";

/**
 * WatchTower request status and release dates for the rows that are not in the library: one query
 * for the whole view. A row flips to the status WatchTower returned the moment it is requested,
 * and the next answer from the server replaces it.
 */
export function useRequestInfo(entries: InfoEntry[], enabled = true) {
  const items = entries.filter((e) => e.tmdbId != null).slice(0, 100);
  const query = useQuery({
    ...orpc.franchises.requestInfo.queryOptions({ input: { items } }),
    enabled: enabled && items.length > 0,
    retry: false,
    staleTime: 20_000,
  });
  const [overrides, setOverrides] = useState<Record<string, { wt: WtView; at: number }>>({});
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  /** Call with the results of a request so those rows show WatchTower's answer straight away. */
  const noteRequested = useCallback((results: Array<{ key: string | null; outcome: Outcome }>) => {
    const at = Date.now();
    setOverrides((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (!r.key) continue;
        if (r.outcome.ok || r.outcome.status === "duplicate") {
          next[r.key] = { wt: { state: stateOf(r.outcome.wtStatus), requestedByMe: r.outcome.ok }, at };
        }
      }
      return next;
    });
  }, []);

  const byKey = new Map((query.data?.items ?? []).map((i) => [i.key, i]));
  const watchtowerOk = !!query.data?.watchtower.ok;
  const infoFor = (key: string): { wt: WtView | null; release: ReleaseView | null; checked: boolean } => {
    const override = overrides[key];
    const server = byKey.get(key);
    // An answer fetched after the request wins; until then show what the request itself returned.
    const wt = override && override.at > query.dataUpdatedAt ? override.wt : (server?.wt ?? null);
    // `checked`: WatchTower itself answered for this title, so 24/7's own "requested" note is not needed.
    return { wt, release: (server?.release as ReleaseView | null | undefined) ?? null, checked: !!wt || (watchtowerOk && !!server) };
  };

  const problem = query.data && !query.data.watchtower.ok ? query.data.watchtower.message : null;
  return { infoFor, noteRequested, checking: query.isLoading && items.length > 0, problem };
}
