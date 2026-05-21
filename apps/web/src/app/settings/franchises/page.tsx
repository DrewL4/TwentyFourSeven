"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { orpc } from "@/utils/orpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { cn } from "@/lib/utils";

export default function FranchisesSettingsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editName, setEditName] = useState("");
  const [collectionSearch, setCollectionSearch] = useState("");
  const [debouncedCollectionSearch] = useDebounce(collectionSearch, 350);
  const [pickedCollectionId, setPickedCollectionId] = useState<number | null>(null);
  const [tmdbKeyOpen, setTmdbKeyOpen] = useState(false);
  const [tmdbApiKey, setTmdbApiKey] = useState("");
  const [showTmdbApiKey, setShowTmdbApiKey] = useState(false);
  const [watchOrderMode, setWatchOrderMode] = useState<"CHRONOLOGICAL" | "RELEASE">(
    "CHRONOLOGICAL",
  );

  const franchisesQuery = useQuery(orpc.franchises.list.queryOptions());
  const settingsQuery = useQuery(orpc.settings.get.queryOptions());

  const detailQuery = useQuery({
    ...orpc.franchises.get.queryOptions({ input: { id: selectedId ?? "" } }),
    enabled: !!selectedId && !isAdding,
  });

  const savedTmdbApiKey = settingsQuery.data?.tmdbApiKey?.trim() ?? "";
  const hasSavedTmdbKey = savedTmdbApiKey.length > 0;
  const isReplacingTmdbKey = tmdbApiKey.length > 0;
  const isTmdbKeyReadOnly = hasSavedTmdbKey && !showTmdbApiKey && !isReplacingTmdbKey;

  const tmdbKeyDisplayValue = useMemo(() => {
    if (isReplacingTmdbKey) return tmdbApiKey;
    if (!hasSavedTmdbKey) return "";
    if (showTmdbApiKey) return savedTmdbApiKey;
    return "•".repeat(savedTmdbApiKey.length);
  }, [isReplacingTmdbKey, tmdbApiKey, hasSavedTmdbKey, showTmdbApiKey, savedTmdbApiKey]);

  const collectionSearchQuery = useQuery({
    ...orpc.franchises.searchTmdbCollection.queryOptions({
      input: { query: debouncedCollectionSearch },
    }),
    enabled: debouncedCollectionSearch.trim().length >= 2 && hasSavedTmdbKey,
  });

  const previewCollectionId =
    pickedCollectionId ??
    (detailQuery.data?.tmdbCollectionId != null ? detailQuery.data.tmdbCollectionId : null);

  const previewQuery = useQuery({
    ...orpc.franchises.previewTmdbCollection.queryOptions({
      input: { collectionId: previewCollectionId ?? 0, sortMode: watchOrderMode },
    }),
    enabled: previewCollectionId != null && previewCollectionId > 0 && hasSavedTmdbKey,
  });

  const deleteMutation = useMutation(
    orpc.franchises.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.franchises.list.queryOptions().queryKey });
        setSelectedId(null);
        setIsAdding(false);
        toast.success("Franchise deleted");
      },
    }),
  );

  const importTmdbMutation = useMutation(
    orpc.franchises.importFromTmdbCollection.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.franchises.list.queryOptions().queryKey });
        setSelectedId(null);
        setIsAdding(false);
        setEditName("");
        setPickedCollectionId(null);
        setCollectionSearch("");
        toast.success("Franchise saved — order synced from TMDB");
      },
      onError: (err: Error) => toast.error(err.message || "Failed to save franchise"),
    }),
  );

  const updateSettingsMutation = useMutation(
    orpc.settings.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.settings.get.queryOptions().queryKey });
        setTmdbApiKey("");
        setShowTmdbApiKey(false);
        toast.success("TMDB API key saved");
      },
      onError: (err: Error) => toast.error(err.message || "Failed to save TMDB API key"),
    }),
  );

  const selectedSummary = franchisesQuery.data?.find((f) => f.id === selectedId);
  const showEditor = isAdding || !!selectedId;

  useEffect(() => {
    if (!selectedId || isAdding || !detailQuery.data) return;
    setEditName(detailQuery.data.name);
    setPickedCollectionId(detailQuery.data.tmdbCollectionId);
    setWatchOrderMode(
      detailQuery.data.sortMode === "RELEASE" ? "RELEASE" : "CHRONOLOGICAL",
    );
    setCollectionSearch("");
  }, [selectedId, isAdding, detailQuery.data]);

  const startAdd = () => {
    setIsAdding(true);
    setSelectedId(null);
    setEditName("");
    setPickedCollectionId(null);
    setWatchOrderMode("CHRONOLOGICAL");
    setCollectionSearch("");
  };

  const startEdit = (id: string) => {
    setIsAdding(false);
    setSelectedId(id);
    setPickedCollectionId(null);
    setCollectionSearch("");
  };

  const pickCollection = (row: { id: number; name: string }) => {
    setPickedCollectionId(row.id);
    if (!editName.trim() || isAdding) {
      setEditName(row.name);
    }
    setCollectionSearch("");
  };

  const saveFranchise = () => {
    const collectionId = pickedCollectionId ?? detailQuery.data?.tmdbCollectionId;
    if (!collectionId) {
      toast.error("Search TMDB and select a collection first");
      return;
    }
    const payload = {
      collectionId,
      sortMode: watchOrderMode,
    };
    if (isAdding) {
      importTmdbMutation.mutate({
        ...payload,
        franchiseName: editName.trim() || undefined,
      });
      return;
    }
    if (!selectedId) return;
    importTmdbMutation.mutate({
      ...payload,
      franchiseId: selectedId,
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? Linked channels will be unlinked.`)) return;
    deleteMutation.mutate({ id });
  };

  const closeEditor = () => {
    setIsAdding(false);
    setSelectedId(null);
  };

  const orderRows = previewQuery.data?.parts ?? [];
  const lastSyncedAt = detailQuery.data?.lastSyncedAt;
  const editorTitle = isAdding
    ? "New franchise"
    : (selectedSummary?.name ?? "Edit franchise");

  return (
    <div className="container mx-auto max-w-2xl px-4 py-4 pb-6 md:py-6 md:px-6 space-y-4 md:space-y-6">
      {/* Page header — hidden on mobile when editor is open */}
      <div className={cn("space-y-3", showEditor && "max-md:hidden")}>
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" className="shrink-0 -ml-2 touch-manipulation" asChild>
            <Link href="/settings">
              <ArrowLeft className="w-4 h-4 mr-1" />
              <span className="sr-only sm:not-sr-only sm:inline">Settings</span>
            </Link>
          </Button>
          <h1 className="text-lg md:text-xl font-bold truncate">Franchise watch order</h1>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Link TMDB collections to a fixed movie order for channels; lists refresh daily and match your Plex library.
        </p>
      </div>

      {/* Mobile editor header */}
      {showEditor && (
        <div className="md:hidden sticky top-0 z-20 -mx-4 px-4 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 -ml-2 touch-manipulation"
              onClick={closeEditor}
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Franchises
            </Button>
            <h2 className="text-base font-semibold truncate flex-1">{editorTitle}</h2>
          </div>
        </div>
      )}

      <details
        className={cn(
          "rounded-lg border group",
          showEditor && "max-md:hidden",
        )}
        open={tmdbKeyOpen}
        onToggle={(e) => setTmdbKeyOpen(e.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 min-h-11 text-sm font-medium touch-manipulation [&::-webkit-details-marker]:hidden">
          {tmdbKeyOpen ? (
            <ChevronDown className="w-4 h-4 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0" />
          )}
          <span className="flex-1">TMDB API key</span>
          <span className="text-xs font-normal text-muted-foreground">
            {hasSavedTmdbKey ? "Configured" : "Required to search"}
          </span>
        </summary>
        <div className="border-t px-4 pb-4 pt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Powers collection search and keeps franchise movie lists in sync with TMDB.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 min-w-0">
              <Input
                type={showTmdbApiKey && (isReplacingTmdbKey || hasSavedTmdbKey) ? "text" : "password"}
                autoComplete="off"
                className="pr-10 font-mono text-sm"
                placeholder={hasSavedTmdbKey ? "" : "Paste TMDB v3 API key"}
                value={tmdbKeyDisplayValue}
                readOnly={isTmdbKeyReadOnly}
                onChange={(e) => setTmdbApiKey(e.target.value)}
                onFocus={() => {
                  if (isTmdbKeyReadOnly) setTmdbApiKey("");
                }}
              />
              {hasSavedTmdbKey && (
                <button
                  type="button"
                  onClick={() => setShowTmdbApiKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showTmdbApiKey ? "Hide API key" : "Show API key"}
                >
                  {showTmdbApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
            <Button
              variant="outline"
              className="shrink-0 w-full sm:w-auto min-h-11 touch-manipulation"
              disabled={!tmdbApiKey.trim() || updateSettingsMutation.isPending}
              onClick={() => updateSettingsMutation.mutate({ tmdbApiKey: tmdbApiKey.trim() })}
            >
              {hasSavedTmdbKey ? "Replace" : "Save"}
            </Button>
          </div>
        </div>
      </details>

      <section
        className={cn("space-y-3", showEditor && "max-md:hidden")}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Franchises</h2>
          <Button
            size="sm"
            variant="outline"
            className="min-h-10 touch-manipulation"
            onClick={startAdd}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </div>

        {franchisesQuery.isLoading && (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {franchisesQuery.data?.length === 0 && !franchisesQuery.isLoading && (
          <p className="text-sm text-muted-foreground py-4 text-center rounded-lg border border-dashed">
            No franchises yet. Add one to get started.
          </p>
        )}

        <ul className="space-y-2">
          {franchisesQuery.data?.map((f) => (
            <li
              key={f.id}
              className={cn(
                "flex items-stretch gap-0.5 rounded-lg border text-sm overflow-hidden",
                selectedId === f.id && !isAdding
                  ? "border-primary bg-primary/5"
                  : "border-border",
              )}
            >
              <button
                type="button"
                onClick={() => startEdit(f.id)}
                className="flex-1 min-w-0 text-left px-3 py-3 min-h-[3.25rem] touch-manipulation active:bg-muted/60"
              >
                <div className="font-medium truncate">{f.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {f.entryCount} movies
                  {f.tmdbCollectionId != null ? ` · TMDB ${f.tmdbCollectionId}` : ""}
                </div>
              </button>
              <div className="flex items-center shrink-0 border-l">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 rounded-none touch-manipulation"
                  aria-label={`Edit ${f.name}`}
                  onClick={() => startEdit(f.id)}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 rounded-none text-destructive hover:text-destructive touch-manipulation"
                  aria-label={`Delete ${f.name}`}
                  onClick={() => handleDelete(f.id, f.name)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {showEditor && (
        <section
          className={cn(
            "rounded-lg border p-4 space-y-4 max-md:border-0 max-md:rounded-none max-md:px-0 max-md:pt-2",
            "max-md:pb-28",
          )}
        >
          <h2 className="text-sm font-semibold hidden md:block">{editorTitle}</h2>

          {!hasSavedTmdbKey && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Open TMDB API key above and save a key before searching.
            </p>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Display name</Label>
            <Input
              className="min-h-11 text-base md:text-sm"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Uses collection name if empty"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Search TMDB collection</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                className="pl-8 min-h-11 text-base md:text-sm"
                placeholder="e.g. Avengers, Star Wars, Pixar"
                value={collectionSearch}
                onChange={(e) => setCollectionSearch(e.target.value)}
                disabled={!hasSavedTmdbKey}
              />
            </div>
            {collectionSearchQuery.isFetching && (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-2" />
            )}
            {collectionSearchQuery.data && collectionSearchQuery.data.length > 0 && (
              <ul className="mt-2 max-h-48 overflow-y-auto overscroll-contain rounded-md border divide-y text-sm -webkit-overflow-scrolling-touch">
                {collectionSearchQuery.data.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={cn(
                        "w-full text-left px-3 py-3 min-h-11 hover:bg-muted touch-manipulation active:bg-muted",
                        pickedCollectionId === row.id && "bg-primary/10",
                      )}
                      onClick={() => pickCollection(row)}
                    >
                      <span className="block font-medium">{row.name}</span>
                      <span className="text-muted-foreground text-xs">#{row.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {previewCollectionId != null && (
            <div className="space-y-2">
              <Label className="text-xs">How to watch</Label>
              <div className="flex rounded-lg border p-1 text-sm">
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-md px-3 py-2.5 min-h-11 transition-colors touch-manipulation",
                    watchOrderMode === "CHRONOLOGICAL"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground active:bg-muted",
                  )}
                  onClick={() => setWatchOrderMode("CHRONOLOGICAL")}
                >
                  Story order
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-md px-3 py-2.5 min-h-11 transition-colors touch-manipulation",
                    watchOrderMode === "RELEASE"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground active:bg-muted",
                  )}
                  onClick={() => setWatchOrderMode("RELEASE")}
                >
                  Release order
                </button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-500" />
                  In Plex
                </span>
                <span className="inline-flex items-center gap-1">
                  <X className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
                  Missing
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <Label className="text-xs">Watch order</Label>
                {previewQuery.isFetching && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              {previewQuery.data && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">{previewQuery.data.name}</span>
                  {" · "}
                  {previewQuery.data.partCount} movies
                  <span className="hidden sm:inline">
                    {" "}
                    (
                    {watchOrderMode === "CHRONOLOGICAL"
                      ? "story order"
                      : "release order"}
                    )
                  </span>
                  <br className="sm:hidden" />
                  <span className="text-green-600 dark:text-green-500">
                    {previewQuery.data.inLibraryCount ?? 0} in Plex
                  </span>
                </p>
              )}
              <ol className="max-h-[min(50dvh,20rem)] md:max-h-64 overflow-y-auto overscroll-contain rounded-md border text-sm divide-y -webkit-overflow-scrolling-touch">
                {orderRows.length === 0 && !previewQuery.isFetching && (
                  <li className="px-3 py-4 text-muted-foreground text-center text-xs">
                    Select a collection to preview order
                  </li>
                )}
                {orderRows.map((part, index) => {
                  const year = part.release_date?.slice(0, 4);
                  const inLibrary = part.inLibrary === true;
                  return (
                    <li
                      key={`${part.id}-${index}`}
                      className="flex items-start gap-2.5 px-3 py-2.5 min-h-11"
                    >
                      {inLibrary ? (
                        <Check
                          className="w-5 h-5 shrink-0 text-green-600 dark:text-green-500 mt-0.5"
                          aria-label="In Plex library"
                        />
                      ) : (
                        <X
                          className="w-5 h-5 shrink-0 text-red-500 dark:text-red-400 mt-0.5"
                          aria-label="Not in Plex library"
                        />
                      )}
                      <span className="w-6 text-xs text-muted-foreground tabular-nums shrink-0 pt-0.5">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 text-sm leading-snug break-words">
                        <span className="font-medium">{part.title}</span>
                        {year ? (
                          <span className="text-muted-foreground"> ({year})</span>
                        ) : null}
                        {inLibrary && part.libraryTitle && part.libraryTitle !== part.title ? (
                          <span className="block text-xs text-muted-foreground mt-0.5">
                            Plex: {part.libraryTitle}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          <p className="text-xs text-muted-foreground leading-relaxed hidden md:block">
            {lastSyncedAt
              ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}. `
              : ""}
            Saved franchises re-sync from TMDB every 24 hours and after Plex library updates.
          </p>

          {/* Desktop actions */}
          <div className="hidden md:flex flex-wrap items-center gap-2 pt-1">
            <Button
              className="min-h-10"
              onClick={saveFranchise}
              disabled={
                importTmdbMutation.isPending ||
                !hasSavedTmdbKey ||
                previewCollectionId == null
              }
            >
              {importTmdbMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Save className="w-4 h-4 mr-1" />
                  Save franchise
                </>
              )}
            </Button>
            <Button variant="ghost" size="sm" className="min-h-10" onClick={closeEditor}>
              Cancel
            </Button>
          </div>

          {/* Mobile sticky actions */}
          <div className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
            <div className="flex gap-2 max-w-2xl mx-auto">
              <Button
                className="flex-1 min-h-11 touch-manipulation"
                onClick={saveFranchise}
                disabled={
                  importTmdbMutation.isPending ||
                  !hasSavedTmdbKey ||
                  previewCollectionId == null
                }
              >
                {importTmdbMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-1" />
                    Save
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="min-h-11 px-4 touch-manipulation"
                onClick={closeEditor}
              >
                Cancel
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
