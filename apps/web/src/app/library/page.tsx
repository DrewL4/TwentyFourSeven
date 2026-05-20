"use client";

import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { HEAVY_QUERY_OPTIONS, LIBRARY_LIST_OPTIONS } from "@/utils/query-options";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  LibraryMediaCard,
  LIBRARY_MEDIA_GRID_CLASS,
} from "@/components/library/LibraryMediaCard";
import { LibraryActiveFilters } from "@/components/library/LibraryActiveFilters";
import {
  LibraryStatsRow,
  type CollectionSummaryItem,
  type LibrarySummaryItem,
  type ServerSummaryItem,
} from "@/components/library/LibraryStatsRow";
import type { LibraryContentView } from "@/types/library-filters";
import { Library, Plus, Video, Search, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useDebounce } from "use-debounce";

const PAGE_SIZE = 50;
const SEARCH_MIN_LENGTH = 2;

type LibraryListShow = {
  id: string;
  title: string;
  year: number | null;
  poster: string | null;
  library: { id: string; name: string };
  _count?: { episodes: number };
  episodes?: unknown[];
};

type LibraryListMovie = {
  id: string;
  title: string;
  year: number | null;
  poster: string | null;
  library: { id: string; name: string };
};

type LibraryServerRow = {
  id: string;
  name: string;
  type: string;
  active: boolean;
  libraries: {
    id: string;
    name: string;
    type: string;
    _count: { shows: number; movies: number };
  }[];
};

function getEpisodeCount(show: LibraryListShow): number {
  return show._count?.episodes ?? show.episodes?.length ?? 0;
}

function ContentGridSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div>
      <div className={`h-7 bg-muted rounded ${titleWidth} mb-3 animate-pulse`} />
      <div className={LIBRARY_MEDIA_GRID_CLASS}>
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-md border border-border/50">
            <div className="aspect-[2/3] bg-muted animate-pulse" />
            <div className="px-2 py-1.5 space-y-1">
              <div className="h-3 bg-muted rounded animate-pulse" />
              <div className="h-2.5 bg-muted rounded w-2/3 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 300);
  const [selectedLibrary, setSelectedLibrary] = useState<string>("");
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [contentView, setContentView] = useState<LibraryContentView>("all");
  const [collectionsMenuOpen, setCollectionsMenuOpen] = useState(false);
  const [showsLimit, setShowsLimit] = useState(PAGE_SIZE);
  const [moviesLimit, setMoviesLimit] = useState(PAGE_SIZE);
  const contentRef = useRef<HTMLDivElement>(null);

  const isSearchMode = debouncedSearch.trim().length >= SEARCH_MIN_LENGTH;
  const collectionFilter = selectedCollection ?? undefined;

  const filterInput = {
    libraryId: selectedLibrary || undefined,
    search: isSearchMode ? debouncedSearch.trim() : undefined,
    collection: collectionFilter,
  };

  const scrollToContent = useCallback(() => {
    contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const statsQuery = useQuery({
    ...orpc.library.stats.queryOptions({ input: filterInput }),
    ...LIBRARY_LIST_OPTIONS,
  });

  const serversQuery = useQuery({
    ...orpc.servers.listForLibrary.queryOptions(),
    ...LIBRARY_LIST_OPTIONS,
  });

  const showShowsSection = contentView === "all" || contentView === "shows";
  const showMoviesSection = contentView === "all" || contentView === "movies";

  const showsQuery = useQuery({
    ...orpc.library.shows.queryOptions({
      input: {
        libraryId: selectedLibrary || undefined,
        collection: collectionFilter,
        limit: showsLimit,
        offset: 0,
      },
    }),
    ...HEAVY_QUERY_OPTIONS,
    enabled: !isSearchMode && showShowsSection,
  });

  const moviesQuery = useQuery({
    ...orpc.library.movies.queryOptions({
      input: {
        libraryId: selectedLibrary || undefined,
        collection: collectionFilter,
        limit: moviesLimit,
        offset: 0,
      },
    }),
    ...HEAVY_QUERY_OPTIONS,
    enabled: !isSearchMode && showMoviesSection,
  });

  const searchQueryResult = useQuery({
    ...orpc.library.search.queryOptions({
      input: {
        query: debouncedSearch.trim(),
        libraryId: selectedLibrary || undefined,
        collection: collectionFilter,
        limit: 200,
      },
    }),
    ...HEAVY_QUERY_OPTIONS,
    enabled: isSearchMode,
  });

  const collectionsQuery = useQuery({
    ...orpc.library.collections.queryOptions({
      input: { limit: 200 },
    }),
    ...HEAVY_QUERY_OPTIONS,
    enabled:
      collectionsMenuOpen ||
      selectedCollection !== null ||
      (statsQuery.data?.collectionCount ?? 0) > 0,
  });

  const resetPagination = useCallback(() => {
    setShowsLimit(PAGE_SIZE);
    setMoviesLimit(PAGE_SIZE);
  }, []);

  const handleContentViewChange = useCallback(
    (view: LibraryContentView) => {
      setContentView(view);
      setSelectedCollection(null);
      resetPagination();
      scrollToContent();
    },
    [resetPagination, scrollToContent],
  );

  const handleLibrarySelect = useCallback(
    (libraryId: string) => {
      setSelectedLibrary(libraryId);
      resetPagination();
      scrollToContent();
    },
    [resetPagination, scrollToContent],
  );

  const handleCollectionSelect = useCallback(
    (collectionName: string | null) => {
      setSelectedCollection(collectionName);
      setContentView("all");
      resetPagination();
      scrollToContent();
    },
    [resetPagination, scrollToContent],
  );

  const clearAllFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedLibrary("");
    setSelectedCollection(null);
    setContentView("all");
    resetPagination();
  }, [resetPagination]);

  const servers = (serversQuery.data ?? []) as LibraryServerRow[];
  const allLibraries = servers.flatMap((server) => server.libraries ?? []);

  const stats = statsQuery.data ?? {
    showCount: 0,
    movieCount: 0,
    episodeCount: 0,
    libraryCount: 0,
    serverCount: 0,
    collectionCount: 0,
  };

  const librarySummaries: LibrarySummaryItem[] = allLibraries.map((library) => ({
    id: library.id,
    name: library.name,
    type: library.type,
    showCount: library._count?.shows ?? 0,
    movieCount: library._count?.movies ?? 0,
  }));

  const serverSummaries: ServerSummaryItem[] = servers
    .filter((server) => server.type === "PLEX")
    .map((server) => ({
      name: server.name,
      type: server.type,
      active: server.active,
      libraryCount: server.libraries?.length ?? 0,
    }));

  const collectionSummaries: CollectionSummaryItem[] =
    (collectionsQuery.data as CollectionSummaryItem[] | undefined) ?? [];

  const selectedLibraryName =
    allLibraries.find((lib) => lib.id === selectedLibrary)?.name ?? "";

  const browseShows = (showsQuery.data?.items ?? []) as LibraryListShow[];
  const browseMovies = (moviesQuery.data?.items ?? []) as LibraryListMovie[];
  const searchShows = (searchQueryResult.data?.shows ?? []) as LibraryListShow[];
  const searchMovies = (searchQueryResult.data?.movies ?? []) as LibraryListMovie[];

  const shows = isSearchMode
    ? searchShows
    : browseShows;
  const movies = isSearchMode
    ? searchMovies
    : browseMovies;

  const visibleShows = showShowsSection ? shows : [];
  const visibleMovies = showMoviesSection ? movies : [];

  const totalShows = isSearchMode ? shows.length : (showsQuery.data?.total ?? 0);
  const totalMovies = isSearchMode ? movies.length : (moviesQuery.data?.total ?? 0);
  const hasMoreShows = !isSearchMode && shows.length < totalShows;
  const hasMoreMovies = !isSearchMode && movies.length < totalMovies;

  const showsLoading = isSearchMode ? searchQueryResult.isLoading : showsQuery.isLoading;
  const moviesLoading = isSearchMode ? searchQueryResult.isLoading : moviesQuery.isLoading;

  const hasError =
    statsQuery.error ||
    serversQuery.error ||
    (isSearchMode ? searchQueryResult.error : showsQuery.error || moviesQuery.error);

  if (hasError) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
              <Library className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Media Library</h1>
              <p className="text-muted-foreground">Browse your synced Plex libraries and content</p>
            </div>
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <Library className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Error Loading Library</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              There was an error loading your media library. Please check your Plex server connection and try again.
            </p>
            <Button
              onClick={() => {
                statsQuery.refetch();
                serversQuery.refetch();
                if (isSearchMode) {
                  searchQueryResult.refetch();
                } else {
                  showsQuery.refetch();
                  moviesQuery.refetch();
                }
              }}
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
            <Library className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Media Library</h1>
            <p className="text-muted-foreground">Browse your synced Plex libraries and content</p>
          </div>
        </div>
      </div>

      <LibraryStatsRow
        stats={stats}
        libraries={librarySummaries}
        servers={serverSummaries}
        collections={collectionSummaries}
        collectionsLoading={collectionsQuery.isLoading}
        contentView={contentView}
        activeLibraryId={selectedLibrary}
        activeCollection={selectedCollection}
        isLoading={statsQuery.isLoading}
        onContentViewChange={handleContentViewChange}
        onLibrarySelect={handleLibrarySelect}
        onCollectionSelect={handleCollectionSelect}
        onCollectionsOpenChange={setCollectionsMenuOpen}
      />

      {allLibraries.length === 0 && !serversQuery.isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Library className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Libraries Found</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              Connect a Plex server and sync libraries to see your content here. Go to Settings → Plex to get started.
            </p>
            <Button asChild>
              <a href="/settings/plex">
                <Plus className="w-4 h-4 mr-2" />
                Add Plex Server
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <LibraryActiveFilters
            contentView={contentView}
            libraryName={selectedLibraryName}
            collectionName={selectedCollection}
            onClearContentView={() => handleContentViewChange("all")}
            onClearLibrary={() => handleLibrarySelect("")}
            onClearCollection={() => handleCollectionSelect(null)}
            onClearAll={clearAllFilters}
          />

          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search shows and movies..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  resetPagination();
                }}
                className="pl-10"
              />
            </div>
            <select
              value={selectedLibrary}
              onChange={(e) => {
                handleLibrarySelect(e.target.value);
              }}
              className="px-3 py-2 border rounded-md bg-background"
              disabled={serversQuery.isLoading}
            >
              <option value="">All Libraries</option>
              {allLibraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name} ({library.type})
                </option>
              ))}
            </select>
          </div>


          <div ref={contentRef} className="space-y-8 scroll-mt-4">
          {selectedCollection && (
            <p className="text-sm text-muted-foreground">
              Items in collection{" "}
              <span className="font-medium text-foreground">{selectedCollection}</span>
            </p>
          )}

          {showShowsSection && (showsLoading ? (
            <ContentGridSkeleton titleWidth="w-32" />
          ) : (
            visibleShows.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold">TV Shows</h2>
                  <span className="text-sm text-muted-foreground">
                    {isSearchMode
                      ? `${visibleShows.length} result${visibleShows.length === 1 ? "" : "s"}`
                      : `Showing ${visibleShows.length} of ${totalShows}`}
                  </span>
                </div>
                <div className={LIBRARY_MEDIA_GRID_CLASS}>
                  {visibleShows.map((show, index) => {
                    const yearPart = show.year ? `${show.year}` : "";
                    const episodePart = `${getEpisodeCount(show)} ep`;
                    const subtitle = [yearPart, episodePart].filter(Boolean).join(" · ");

                    return (
                      <LibraryMediaCard
                        key={show.id}
                        id={show.id}
                        title={show.title}
                        poster={show.poster}
                        type="show"
                        subtitle={subtitle || show.library?.name}
                        priority={index < 8}
                      />
                    );
                  })}
                </div>
                {hasMoreShows && (
                  <div className="mt-4 flex justify-center">
                    <Button
                      variant="outline"
                      onClick={() => setShowsLimit((l) => l + PAGE_SIZE)}
                      disabled={showsQuery.isFetching}
                    >
                      {showsQuery.isFetching ? "Loading…" : "Load more"}
                    </Button>
                  </div>
                )}
              </div>
            )
          ))}

          {showMoviesSection && (moviesLoading ? (
            <ContentGridSkeleton titleWidth="w-24" />
          ) : (
            visibleMovies.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold">Movies</h2>
                  <span className="text-sm text-muted-foreground">
                    {isSearchMode
                      ? `${visibleMovies.length} result${visibleMovies.length === 1 ? "" : "s"}`
                      : `Showing ${visibleMovies.length} of ${totalMovies}`}
                  </span>
                </div>
                <div className={LIBRARY_MEDIA_GRID_CLASS}>
                  {visibleMovies.map((movie, index) => (
                    <LibraryMediaCard
                      key={movie.id}
                      id={movie.id}
                      title={movie.title}
                      poster={movie.poster}
                      type="movie"
                      subtitle={movie.year ? String(movie.year) : movie.library?.name}
                      priority={index < 8}
                    />
                  ))}
                </div>
                {hasMoreMovies && (
                  <div className="mt-4 flex justify-center">
                    <Button
                      variant="outline"
                      onClick={() => setMoviesLimit((l) => l + PAGE_SIZE)}
                      disabled={moviesQuery.isFetching}
                    >
                      {moviesQuery.isFetching ? "Loading…" : "Load more"}
                    </Button>
                  </div>
                )}
              </div>
            )
          ))}

          {stats.collectionCount > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Collections</h2>
              {collectionsQuery.isLoading && collectionSummaries.length === 0 ? (
                <div className="flex items-center gap-2 text-muted-foreground py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading collections…</span>
                </div>
              ) : collectionSummaries.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {collectionSummaries.map((col) => (
                    <button
                      key={col.name}
                      type="button"
                      onClick={() => handleCollectionSelect(col.name)}
                      className="inline-flex"
                    >
                      <Badge
                        variant={selectedCollection === col.name ? "default" : "outline"}
                        className="px-3 py-1 text-sm cursor-pointer hover:bg-accent"
                      >
                        {col.name}{" "}
                        <span className="ml-1 opacity-80">({col.count})</span>
                      </Badge>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Click the collections icon above to browse collections.
                </p>
              )}
            </div>
          )}
          </div>

          {!showsLoading &&
            !moviesLoading &&
            visibleShows.length === 0 &&
            visibleMovies.length === 0 &&
            allLibraries.length > 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <Video className="w-16 h-16 text-muted-foreground mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No Content Found</h3>
                  <p className="text-muted-foreground text-center mb-6 max-w-md">
                    {searchQuery || selectedLibrary || selectedCollection || contentView !== "all"
                      ? "No shows or movies match your current filters. Try adjusting or clearing them."
                      : "Your libraries are connected but no content has been synced yet. Check your Plex server settings."}
                  </p>
                  {(searchQuery ||
                    selectedLibrary ||
                    selectedCollection ||
                    contentView !== "all") && (
                    <Button onClick={clearAllFilters}>Clear Filters</Button>
                  )}
                </CardContent>
              </Card>
            )}
        </div>
      )}
    </div>
  );
}
