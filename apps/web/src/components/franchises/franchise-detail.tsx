"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Radio, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orpc } from "@/utils/orpc";
import { useAdmin } from "@/hooks/use-admin";
import { OrderControls, type OrderMode } from "./order-controls";
import { EntryRow, type RowItem } from "./entry-row";
import { useRequestMissing } from "./use-request-missing";

type ShowPart = "SHOW" | "SEASON" | "EPISODES";

function useInvalidateFranchises() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: orpc.franchises.get.key() });
    queryClient.invalidateQueries({ queryKey: orpc.franchises.list.key() });
  };
}

export function FranchiseDetail(props: { id: string; onBack: () => void }) {
  const invalidate = useInvalidateFranchises();
  const queryClient = useQueryClient();
  const { canManage } = useAdmin();

  const detail = useQuery({ ...orpc.franchises.get.queryOptions({ input: { id: props.id } }), retry: false });
  const f = detail.data;
  const canEdit = !!f?.canEdit;

  const [addText, setAddText] = useState("");
  const [addTmdb, setAddTmdb] = useState(false);
  const [showPart, setShowPart] = useState<ShowPart>("SHOW");
  const [season, setSeason] = useState("1");
  const [epStart, setEpStart] = useState("1");
  const [epEnd, setEpEnd] = useState("1");
  const [afterId, setAfterId] = useState("");
  const q = addText.trim();

  const libraryQuery = useQuery({
    ...orpc.franchises.searchLibrary.queryOptions({ input: { query: q, includeShows: !!f?.includeShows } }),
    enabled: canEdit && q.length >= 2,
    retry: false,
  });
  const tmdbQuery = useQuery({
    ...orpc.franchises.searchTitles.queryOptions({ input: { query: q, includeShows: !!f?.includeShows } }),
    enabled: canEdit && addTmdb && q.length >= 2,
    retry: false,
  });

  const onError = (error: Error) => toast.error(error.message || "That did not work");
  const common = { retry: false as const, onError, onSuccess: () => invalidate() };

  const update = useMutation(orpc.franchises.update.mutationOptions(common));
  const addEntry = useMutation(
    orpc.franchises.addEntry.mutationOptions({ ...common, onSuccess: () => { invalidate(); toast.success("Added"); } }),
  );
  const removeEntry = useMutation(orpc.franchises.removeEntry.mutationOptions(common));
  const restoreEntry = useMutation(orpc.franchises.restoreEntry.mutationOptions(common));
  const moveEntry = useMutation(orpc.franchises.moveEntry.mutationOptions(common));
  const resetOrder = useMutation(
    orpc.franchises.resetOrder.mutationOptions({ ...common, onSuccess: () => { invalidate(); toast.success("Back to the chosen order"); } }),
  );
  const resync = useMutation(
    orpc.franchises.resync.mutationOptions({
      ...common,
      onSuccess: (out) => {
        invalidate();
        toast.success(out.result.skipped ? out.result.skipped : "Checked for new titles");
      },
    }),
  );
  const del = useMutation(
    orpc.franchises.delete.mutationOptions({
      ...common,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.franchises.list.key() });
        toast.success("Franchise deleted");
        props.onBack();
      },
    }),
  );
  const createChannel = useMutation(
    orpc.franchises.createChannel.mutationOptions({
      ...common,
      onSuccess: (result) => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: orpc.channels.list.queryOptions().queryKey });
        toast.success(
          result.created ? `Channel ${result.number} "${result.name}" created` : `Already on channel ${result.number} "${result.name}"`,
        );
      },
    }),
  );
  const requestMissing = useRequestMissing();

  const busy =
    update.isPending || addEntry.isPending || removeEntry.isPending || restoreEntry.isPending || moveEntry.isPending || resetOrder.isPending;

  if (detail.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!f) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={props.onBack}><ArrowLeft className="h-4 w-4 mr-1" />Franchises</Button>
        <p className="text-sm text-destructive">{(detail.error as Error | null)?.message ?? "Franchise not found"}</p>
      </div>
    );
  }

  const live = f.entries.filter((e) => !e.excluded);
  const hidden = f.entries.filter((e) => e.excluded);
  const missing = live.filter((e) => !e.available && !e.requestedAt);

  const toRow = (e: (typeof f.entries)[number]): RowItem => ({
    key: e.id,
    kind: e.kind as RowItem["kind"],
    label: e.label ?? e.movie?.title ?? e.show?.title ?? "Untitled",
    year: e.releaseDate ? new Date(e.releaseDate).getUTCFullYear() : (e.movie?.year ?? e.show?.year ?? null),
    posterPath: e.posterPath,
    available: e.available,
    requested: !!e.requestedAt,
    excluded: e.excluded,
    manual: e.manual,
    canRequest: e.tmdbId != null,
    note:
      e.kind !== "MOVIE" && !e.available && (e.haveEpisodes ?? 0) > 0
        ? `${e.haveEpisodes}${e.wantEpisodes != null ? ` of ${e.wantEpisodes}` : ""} episodes in your library`
        : null,
  });

  const addFromLibrary = (input: { kind: "MOVIE" | ShowPart; libraryMovieId?: string; libraryShowId?: string }) =>
    addEntry.mutate({
      franchiseId: f.id,
      kind: input.kind,
      libraryMovieId: input.libraryMovieId,
      libraryShowId: input.libraryShowId,
      ...showFields(input.kind),
      afterEntryId: afterId || undefined,
    });

  function showFields(kind: string) {
    if (kind === "SEASON") return { seasonNumber: Number(season) || 1 };
    if (kind === "EPISODES") {
      return { seasonNumber: Number(season) || 1, episodeStart: Number(epStart) || 1, episodeEnd: Number(epEnd) || 1 };
    }
    return {};
  }

  const addFromTmdb = (row: { id: number; title: string; releaseDate: string | null; posterPath: string | null }, kind: "MOVIE" | ShowPart) =>
    addEntry.mutate({
      franchiseId: f.id,
      kind,
      tmdbId: row.id,
      title: row.title,
      releaseDate: row.releaseDate ?? undefined,
      posterPath: row.posterPath,
      ...showFields(kind),
      afterEntryId: afterId || undefined,
    });

  return (
    <section className="space-y-4" aria-label={`Franchise ${f.name}`}>
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 shrink-0" onClick={props.onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Franchises
        </Button>
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">{f.name}</h2>
        <p className="text-xs text-muted-foreground">
          {f.ownerName ? `Made by ${f.ownerName}` : "Built in"} · {f.availableCount} of {f.entryCount} in your library
          {f.storyListName ? ` · story order: ${f.storyListName}` : ""}
          {!canEdit ? " · only the person who made it can change it" : ""}
        </p>
      </div>

      {canEdit ? (
        <OrderControls
          mode={f.sortMode as OrderMode}
          onMode={(sortMode) => update.mutate({ id: f.id, sortMode })}
          includeShows={f.includeShows}
          onIncludeShows={(includeShows) => update.mutate({ id: f.id, includeShows })}
          disabled={busy}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Order: {f.sortMode === "CHRONOLOGICAL" ? "story" : f.sortMode === "RELEASE" ? "release" : "recommended"} · {f.includeShows ? "movies and TV shows" : "movies only"}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {missing.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={requestMissing.isPending}
            onClick={() => requestMissing.mutate({ franchiseId: f.id })}
          >
            {requestMissing.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Request all missing (${missing.length})`}
          </Button>
        )}
        {canEdit && f.customOrder && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => resetOrder.mutate({ id: f.id })}>
            <RotateCcw className="h-4 w-4 mr-1" />Reset to chosen order
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="ghost" disabled={resync.isPending} onClick={() => resync.mutate({ id: f.id })}>
            {resync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RefreshCw className="h-4 w-4 mr-1" />Check for new titles</>}
          </Button>
        )}
        {canManage && (
          <Button
            size="sm"
            variant="ghost"
            disabled={createChannel.isPending || f.channels.length > 0}
            title={f.channels.length > 0 ? "This franchise already has a channel" : "Create a channel for this franchise"}
            onClick={() => createChannel.mutate({ franchiseId: f.id })}
          >
            {createChannel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Radio className="h-4 w-4 mr-1" />{f.channels.length > 0 ? `On channel ${f.channels[0].number}` : "Create channel"}</>}
          </Button>
        )}
      </div>

      {live.length === 0 && <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">Nothing in this franchise yet.</p>}
      <ul className="space-y-1.5">
        {live.map((e, i) => (
          <EntryRow
            key={e.id}
            item={toRow(e)}
            index={i}
            busy={busy}
            requesting={requestMissing.isPending}
            onRequest={() => requestMissing.mutate({ franchiseId: f.id, entryIds: [e.id] })}
            onMoveUp={canEdit && i > 0 ? () => moveEntry.mutate({ entryId: e.id, direction: "up" }) : undefined}
            onMoveDown={canEdit && i < live.length - 1 ? () => moveEntry.mutate({ entryId: e.id, direction: "down" }) : undefined}
            onRemove={canEdit ? () => removeEntry.mutate({ entryId: e.id }) : undefined}
          />
        ))}
      </ul>

      {canEdit && hidden.length > 0 && (
        <details className="rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer">Removed ({hidden.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {hidden.map((e, i) => (
              <EntryRow key={e.id} item={toRow(e)} index={i} busy={busy} onRestore={() => restoreEntry.mutate({ entryId: e.id })} />
            ))}
          </ul>
        </details>
      )}

      {canEdit && (
        <div className="space-y-2 rounded-lg border p-3">
          <h3 className="text-sm font-semibold">Add a title</h3>
          <Input value={addText} onChange={(e) => setAddText(e.target.value)} placeholder="Search your library" aria-label="Search titles to add" />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={addTmdb} onChange={(e) => setAddTmdb(e.target.checked)} />
              Also search titles that are not in the library
            </label>
            <label className="inline-flex items-center gap-1.5">
              Place after
              <select className="rounded border bg-background px-1.5 py-1" value={afterId} onChange={(e) => setAfterId(e.target.value)}>
                <option value="">Automatically</option>
                {live.map((e) => (
                  <option key={e.id} value={e.id}>{e.label ?? e.movie?.title ?? e.show?.title}</option>
                ))}
              </select>
            </label>
          </div>
          {f.includeShows && (
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <div>
                <Label className="text-xs">TV entry</Label>
                <select className="mt-1 block rounded border bg-background px-1.5 py-2" value={showPart} onChange={(e) => setShowPart(e.target.value as ShowPart)}>
                  <option value="SHOW">Whole show</option>
                  <option value="SEASON">One season</option>
                  <option value="EPISODES">Episode range</option>
                </select>
              </div>
              {showPart !== "SHOW" && (
                <div><Label className="text-xs">Season</Label><Input className="w-16" inputMode="numeric" value={season} onChange={(e) => setSeason(e.target.value)} /></div>
              )}
              {showPart === "EPISODES" && (
                <>
                  <div><Label className="text-xs">From ep.</Label><Input className="w-16" inputMode="numeric" value={epStart} onChange={(e) => setEpStart(e.target.value)} /></div>
                  <div><Label className="text-xs">To ep.</Label><Input className="w-16" inputMode="numeric" value={epEnd} onChange={(e) => setEpEnd(e.target.value)} /></div>
                </>
              )}
            </div>
          )}
          {q.length >= 2 && (libraryQuery.isFetching || tmdbQuery.isFetching) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <ul className="space-y-1">
            {libraryQuery.data?.movies.map((m) => (
              <li key={`lm-${m.id}`}>
                <button type="button" disabled={addEntry.isPending} className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm min-h-11 hover:bg-muted/60" onClick={() => addFromLibrary({ kind: "MOVIE", libraryMovieId: m.id })}>
                  <span className="truncate">{m.title}{m.year ? ` (${m.year})` : ""} <span className="text-xs text-muted-foreground">· in your library</span></span>
                  <Plus className="h-4 w-4 shrink-0" />
                </button>
              </li>
            ))}
            {f.includeShows && libraryQuery.data?.shows.map((s) => (
              <li key={`ls-${s.id}`}>
                <button type="button" disabled={addEntry.isPending} className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm min-h-11 hover:bg-muted/60" onClick={() => addFromLibrary({ kind: showPart, libraryShowId: s.id })}>
                  <span className="truncate">{s.title}{s.year ? ` (${s.year})` : ""} <span className="text-xs text-muted-foreground">· show in your library</span></span>
                  <Plus className="h-4 w-4 shrink-0" />
                </button>
              </li>
            ))}
            {addTmdb && tmdbQuery.data?.movies.map((m) => (
              <li key={`tm-${m.id}`}>
                <button type="button" disabled={addEntry.isPending} className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm min-h-11 hover:bg-muted/60" onClick={() => addFromTmdb(m, "MOVIE")}>
                  <span className="truncate">{m.title}{m.releaseDate ? ` (${m.releaseDate.slice(0, 4)})` : ""} <span className="text-xs text-muted-foreground">· not in library</span></span>
                  <Plus className="h-4 w-4 shrink-0" />
                </button>
              </li>
            ))}
            {addTmdb && f.includeShows && tmdbQuery.data?.shows.map((s) => (
              <li key={`ts-${s.id}`}>
                <button type="button" disabled={addEntry.isPending} className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm min-h-11 hover:bg-muted/60" onClick={() => addFromTmdb(s, showPart)}>
                  <span className="truncate">{s.title}{s.releaseDate ? ` (${s.releaseDate.slice(0, 4)})` : ""} <span className="text-xs text-muted-foreground">· show, not in library</span></span>
                  <Plus className="h-4 w-4 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
          {tmdbQuery.data?.error && <p className="text-xs text-amber-600 dark:text-amber-400">TMDB search is unavailable right now ({tmdbQuery.data.error}).</p>}
        </div>
      )}

      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={del.isPending}
          onClick={() => {
            if (confirm(`Delete "${f.name}"? Linked channels will be unlinked.`)) del.mutate({ id: f.id });
          }}
        >
          {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Trash2 className="h-4 w-4 mr-1" />Delete franchise</>}
        </Button>
      )}
    </section>
  );
}
