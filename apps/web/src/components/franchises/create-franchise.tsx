"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Save, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orpc } from "@/utils/orpc";
import { OrderControls, type OrderMode } from "./order-controls";
import { EntryRow, type RowItem } from "./entry-row";
import { useRequestMissing } from "./use-request-missing";

type Source =
  | { type: "story"; key: string; name: string }
  | { type: "collection"; id: number; name: string }
  | { type: "keyword"; id: number; name: string };

function useDebounced(value: string, ms = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function CreateFranchise(props: { onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<OrderMode>("RECOMMENDED");
  const [includeShows, setIncludeShows] = useState(false); // movies only by default
  const [source, setSource] = useState<Source | null>(null);
  const [searchText, setSearchText] = useState("");
  const [libText, setLibText] = useState("");
  const [pickedMovies, setPickedMovies] = useState<Array<{ id: string; title: string; year: number | null }>>([]);
  const [pickedShows, setPickedShows] = useState<Array<{ id: string; title: string; year: number | null }>>([]);

  const search = useDebounced(searchText.trim());
  const lib = useDebounced(libText.trim());

  const searchQuery = useQuery({
    ...orpc.franchises.search.queryOptions({ input: { query: search } }),
    enabled: search.length >= 2,
    retry: false,
  });
  const libraryQuery = useQuery({
    ...orpc.franchises.searchLibrary.queryOptions({ input: { query: lib, includeShows } }),
    enabled: lib.length >= 1,
    retry: false,
  });
  const previewQuery = useQuery({
    ...orpc.franchises.preview.queryOptions({
      input: {
        collectionId: source?.type === "collection" ? source.id : null,
        keywordId: source?.type === "keyword" ? source.id : null,
        storyListKey: source?.type === "story" ? source.key : null,
        includeShows,
        sortMode: mode,
      },
    }),
    enabled: !!source,
    retry: false,
  });

  const requestMissing = useRequestMissing();
  const [requestedLabels, setRequestedLabels] = useState<Set<string>>(new Set());

  const create = useMutation(
    orpc.franchises.create.mutationOptions({
      retry: false,
      onSuccess: (franchise) => {
        queryClient.invalidateQueries({ queryKey: orpc.franchises.list.queryOptions().queryKey });
        toast.success(`Franchise "${franchise.name}" created`, {
          description: franchise.syncNote ?? undefined,
        });
        props.onCreated(franchise.id);
      },
      onError: (error: Error) => toast.error(error.message || "Could not create the franchise"),
    }),
  );

  const items = previewQuery.data?.items ?? [];
  const missing = items.filter((i) => !i.inLibrary);

  const chooseSource = (s: Source) => {
    setSource(s);
    if (!name.trim()) setName(s.name);
    setSearchText("");
  };

  const save = () => {
    if (!name.trim()) return toast.error("Give the franchise a name first");
    if (!source && pickedMovies.length + pickedShows.length === 0) {
      return toast.error("Search for a franchise, or pick some titles from your library");
    }
    create.mutate({
      name: name.trim(),
      sortMode: mode,
      includeShows,
      tmdbCollectionId: source?.type === "collection" ? source.id : null,
      tmdbKeywordId: source?.type === "keyword" ? source.id : null,
      storyListKey: source?.type === "story" ? source.key : null,
      libraryMovieIds: pickedMovies.map((m) => m.id),
      libraryShowIds: includeShows ? pickedShows.map((s) => s.id) : [],
    });
  };

  const rows: RowItem[] = items.map((i) => ({
    key: i.entryKey,
    kind: i.kind,
    label: i.label,
    year: i.releaseDate ? Number.parseInt(i.releaseDate.slice(0, 4), 10) || null : null,
    posterPath: i.posterPath,
    available: i.inLibrary,
    requested: requestedLabels.has(i.label),
    note: i.libraryTitle && i.libraryTitle !== i.label ? `as "${i.libraryTitle}"` : null,
    canRequest: i.tmdbId != null,
  }));

  const sendRequests = (list: typeof items) =>
    requestMissing.mutate(
      { items: requestItems(list.filter((i) => i.tmdbId != null).slice(0, 60)) },
      {
        onSuccess: (out) =>
          setRequestedLabels((prev) => {
            const next = new Set(prev);
            for (const r of out.results) if (r.outcome.ok || r.outcome.status === "duplicate") next.add(r.label);
            return next;
          }),
      },
    );

  const requestItems = (list: typeof items) =>
    list.map((i) => ({
      kind: i.kind,
      label: i.label,
      tmdbId: i.tmdbId,
      seasonNumber: i.seasonNumber ?? null,
      posterPath: i.posterPath ?? null,
    }));

  return (
    <section className="rounded-lg border p-4 space-y-4" aria-label="Create a franchise">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">New franchise</h2>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={props.onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="franchise-name" className="text-xs">Name</Label>
        <Input id="franchise-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Avengers" maxLength={120} />
      </div>

      <OrderControls mode={mode} onMode={setMode} includeShows={includeShows} onIncludeShows={setIncludeShows} />

      <div className="space-y-2">
        <Label htmlFor="franchise-search" className="text-xs">Search franchises</Label>
        {source ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary bg-primary/5 px-3 py-2 text-sm">
            <span className="truncate">
              {source.name}
              <span className="text-xs text-muted-foreground">
                {" "}· {source.type === "story" ? "curated list" : source.type === "collection" ? "collection" : "keyword"}
              </span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setSource(null)}>Change</Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="franchise-search"
                className="pl-9"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Avengers, Lord of the Rings, Star Wars…"
              />
            </div>
            {searchText.trim().length >= 2 && searchQuery.isFetching && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            {searchQuery.data?.error && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Search is unavailable right now ({searchQuery.data.error}). You can still pick titles from your library below.
              </p>
            )}
            {searchQuery.data && (
              <ul className="space-y-1">
                {searchQuery.data.storyLists.map((l) => (
                  <li key={`s-${l.key}`}>
                    <button type="button" className="w-full text-left rounded-lg border px-3 py-2 text-sm hover:bg-muted/60 min-h-11" onClick={() => chooseSource({ type: "story", key: l.key, name: l.name })}>
                      {l.name} <span className="text-xs text-muted-foreground">· curated story order · {l.itemCount} titles</span>
                    </button>
                  </li>
                ))}
                {searchQuery.data.collections.map((c) => (
                  <li key={`c-${c.id}`}>
                    <button type="button" className="w-full text-left rounded-lg border px-3 py-2 text-sm hover:bg-muted/60 min-h-11" onClick={() => chooseSource({ type: "collection", id: c.id, name: c.name })}>
                      {c.name} <span className="text-xs text-muted-foreground">· collection</span>
                    </button>
                  </li>
                ))}
                {searchQuery.data.keywords.map((k) => (
                  <li key={`k-${k.id}`}>
                    <button type="button" className="w-full text-left rounded-lg border px-3 py-2 text-sm hover:bg-muted/60 min-h-11" onClick={() => chooseSource({ type: "keyword", id: k.id, name: k.name })}>
                      {k.name} <span className="text-xs text-muted-foreground">· everything tagged this</span>
                    </button>
                  </li>
                ))}
                {!searchQuery.isFetching &&
                  !searchQuery.data.error &&
                  searchQuery.data.storyLists.length + searchQuery.data.collections.length + searchQuery.data.keywords.length === 0 && (
                    <li className="text-xs text-muted-foreground">No matches. Try another name, or pick titles from your library below.</li>
                  )}
              </ul>
            )}
          </>
        )}
      </div>

      {source && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {previewQuery.data
                ? `${previewQuery.data.inLibraryCount} of ${previewQuery.data.total} in your library`
                : "Preview"}
            </h3>
            {missing.filter((m) => !requestedLabels.has(m.label)).length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={requestMissing.isPending}
                onClick={() => sendRequests(missing.filter((m) => !requestedLabels.has(m.label)))}
              >
                {requestMissing.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Request all missing (${missing.filter((m) => !requestedLabels.has(m.label)).length})`}
              </Button>
            )}
          </div>
          {previewQuery.isLoading && (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          )}
          {previewQuery.error && (
            <p className="text-sm text-destructive">{(previewQuery.error as Error).message}</p>
          )}
          <ul className="space-y-1.5">
            {rows.map((row, i) => (
              <EntryRow
                key={row.key}
                item={row}
                index={i}
                requesting={requestMissing.isPending}
                onRequest={() => sendRequests([items[i]])}
              />
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="franchise-lib" className="text-xs">Or pick from your library</Label>
        <Input id="franchise-lib" value={libText} onChange={(e) => setLibText(e.target.value)} placeholder="Search your library" />
        {libText.trim() && libraryQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <ul className="space-y-1">
          {libraryQuery.data?.movies
            .filter((m) => !pickedMovies.some((p) => p.id === m.id))
            .map((m) => (
              <li key={m.id}>
                <button type="button" className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm min-h-11 hover:bg-muted/60" onClick={() => setPickedMovies((p) => [...p, { id: m.id, title: m.title, year: m.year ?? null }])}>
                  <span className="truncate">{m.title}{m.year ? ` (${m.year})` : ""}</span>
                  <Plus className="h-4 w-4 shrink-0" />
                </button>
              </li>
            ))}
          {includeShows &&
            libraryQuery.data?.shows
              .filter((s) => !pickedShows.some((p) => p.id === s.id))
              .map((s) => (
                <li key={s.id}>
                  <button type="button" className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm min-h-11 hover:bg-muted/60" onClick={() => setPickedShows((p) => [...p, { id: s.id, title: s.title, year: s.year ?? null }])}>
                    <span className="truncate">{s.title}{s.year ? ` (${s.year})` : ""} <span className="text-xs text-muted-foreground">· show</span></span>
                    <Plus className="h-4 w-4 shrink-0" />
                  </button>
                </li>
              ))}
        </ul>
        {pickedMovies.length + pickedShows.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Chosen from your library">
            {[...pickedMovies, ...(includeShows ? pickedShows : [])].map((p) => (
              <li key={p.id} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
                {p.title}
                <button
                  type="button"
                  aria-label={`Remove ${p.title}`}
                  onClick={() => {
                    setPickedMovies((l) => l.filter((x) => x.id !== p.id));
                    setPickedShows((l) => l.filter((x) => x.id !== p.id));
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={create.isPending} className="min-h-10">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" />Create franchise</>}
        </Button>
        <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
      </div>
    </section>
  );
}
