"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, Plus, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { orpc } from "@/utils/orpc";
import { cn } from "@/lib/utils";
import { FRANCHISES_BLURB, FRANCHISES_LABEL } from "@/lib/nav-links";
import { CreateFranchise } from "@/components/franchises/create-franchise";
import { FranchiseDetail } from "@/components/franchises/franchise-detail";
import { TmdbAttribution } from "@/components/franchises/tmdb-attribution";

function FranchisesInner() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const franchisesQuery = useQuery({ ...orpc.franchises.list.queryOptions(), retry: false });

  return (
    <div className="container mx-auto max-w-2xl px-4 py-4 pb-8 md:py-6 md:px-6 space-y-4 md:space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" className="shrink-0 -ml-2 touch-manipulation" asChild>
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span className="sr-only sm:not-sr-only sm:inline">Home</span>
            </Link>
          </Button>
          <h1 className="text-lg md:text-xl font-semibold tracking-[-0.03em] truncate">{FRANCHISES_LABEL}</h1>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{FRANCHISES_BLURB}.</p>
      </div>

      {selectedId ? (
        <FranchiseDetail id={selectedId} onBack={() => setSelectedId(null)} />
      ) : creating ? (
        <CreateFranchise
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelectedId(id);
          }}
        />
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">All franchises</h2>
            <Button size="sm" variant="outline" className="min-h-10 touch-manipulation" onClick={() => setCreating(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Create franchise
            </Button>
          </div>

          {franchisesQuery.isLoading && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {franchisesQuery.error && <p className="text-sm text-destructive">{(franchisesQuery.error as Error).message}</p>}
          {franchisesQuery.data?.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center rounded-lg border border-dashed">
              No franchises yet. Create the first one.
            </p>
          )}
          <ul className="space-y-2">
            {franchisesQuery.data?.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(f.id)}
                  className={cn("w-full text-left rounded-lg border px-3 py-3 min-h-[3.25rem] touch-manipulation active:bg-muted/60 hover:bg-muted/40")}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{f.name}</span>
                    {f.includeShows && <Tv className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Includes TV shows" />}
                    {f.channelCount > 0 && <Check className="h-3.5 w-3.5 shrink-0 text-green-600" aria-label="Has a channel" />}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {f.inLibraryCount} of {f.entryCount} in your library
                    {f.canEdit ? " · you can edit" : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <TmdbAttribution />
    </div>
  );
}

export default function FranchisesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <FranchisesInner />
    </Suspense>
  );
}
