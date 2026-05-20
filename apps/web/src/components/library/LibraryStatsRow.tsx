"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Video, Folder, Server, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LibraryContentView } from "@/types/library-filters";

export interface LibraryStatsData {
  showCount: number;
  movieCount: number;
  episodeCount: number;
  libraryCount: number;
  serverCount: number;
  collectionCount: number;
}

export interface LibrarySummaryItem {
  id: string;
  name: string;
  type: string;
  showCount: number;
  movieCount: number;
}

export interface ServerSummaryItem {
  name: string;
  type: string;
  active: boolean;
  libraryCount: number;
}

export interface CollectionSummaryItem {
  name: string;
  count: number;
}

interface LibraryStatsRowProps {
  stats: LibraryStatsData;
  libraries?: LibrarySummaryItem[];
  servers?: ServerSummaryItem[];
  collections?: CollectionSummaryItem[];
  collectionsLoading?: boolean;
  contentView?: LibraryContentView;
  activeLibraryId?: string;
  activeCollection?: string | null;
  isLoading?: boolean;
  className?: string;
  onContentViewChange?: (view: LibraryContentView) => void;
  onLibrarySelect?: (libraryId: string) => void;
  onCollectionSelect?: (collectionName: string | null) => void;
  onCollectionsOpenChange?: (open: boolean) => void;
}

function StatPopover({
  icon: Icon,
  value,
  label,
  children,
  onOpenChange,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const formatted = value.toLocaleString();

  return (
    <div className="flex items-center gap-2 min-w-0">
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-foreground"
            aria-label={`${label}: ${formatted}. Click to filter.`}
          >
            <Icon className="w-5 h-5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 p-3 max-h-[min(24rem,70vh)] overflow-y-auto">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-xl font-bold tabular-nums">{formatted}</span>
    </div>
  );
}

function PopoverTitle({ children }: { children: ReactNode }) {
  return <p className="font-semibold text-sm mb-2">{children}</p>;
}

function FilterOption({
  label,
  detail,
  active,
  onClick,
}: {
  label: string;
  detail?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-md px-2 py-1.5 transition-colors",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium truncate">{label}</span>
        {detail ? (
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{detail}</span>
        ) : null}
      </div>
    </button>
  );
}

function StatSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-5 h-5 rounded bg-muted animate-pulse" aria-hidden />
      <div className="h-7 w-12 rounded bg-muted animate-pulse" />
    </div>
  );
}

export function LibraryStatsRow({
  stats,
  libraries = [],
  servers = [],
  collections = [],
  collectionsLoading = false,
  contentView = "all",
  activeLibraryId = "",
  activeCollection = null,
  isLoading,
  className,
  onContentViewChange,
  onLibrarySelect,
  onCollectionSelect,
  onCollectionsOpenChange,
}: LibraryStatsRowProps) {
  const totalVideos = stats.showCount + stats.movieCount;

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-4 md:gap-6 mb-6",
          className,
        )}
        aria-busy="true"
        aria-label="Loading library statistics"
      >
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-4 md:gap-6 mb-6",
        className,
      )}
      role="group"
      aria-label="Library statistics"
    >
      <StatPopover icon={Video} value={totalVideos} label="Total content">
        <PopoverTitle>Filter by type</PopoverTitle>
        <div className="space-y-0.5">
          <FilterOption
            label="All content"
            detail={totalVideos.toLocaleString()}
            active={contentView === "all" && !activeCollection}
            onClick={() => onContentViewChange?.("all")}
          />
          <FilterOption
            label="TV series"
            detail={stats.showCount.toLocaleString()}
            active={contentView === "shows" && !activeCollection}
            onClick={() => onContentViewChange?.("shows")}
          />
          <FilterOption
            label="Movies"
            detail={stats.movieCount.toLocaleString()}
            active={contentView === "movies" && !activeCollection}
            onClick={() => onContentViewChange?.("movies")}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/60">
          {stats.episodeCount.toLocaleString()} episodes across all series
        </p>
      </StatPopover>

      <StatPopover icon={Folder} value={stats.libraryCount} label="Libraries">
        <PopoverTitle>Filter by library</PopoverTitle>
        {libraries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No libraries synced yet.</p>
        ) : (
          <div className="space-y-0.5">
            <FilterOption
              label="All libraries"
              active={!activeLibraryId}
              onClick={() => onLibrarySelect?.("")}
            />
            {libraries.map((lib) => (
              <FilterOption
                key={lib.id}
                label={lib.name}
                detail={`${lib.showCount} series · ${lib.movieCount} movies`}
                active={activeLibraryId === lib.id}
                onClick={() => onLibrarySelect?.(lib.id)}
              />
            ))}
          </div>
        )}
      </StatPopover>

      <StatPopover icon={Server} value={stats.serverCount} label="Active Plex servers">
        <PopoverTitle>Active Plex servers</PopoverTitle>
        {servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Plex servers connected.</p>
        ) : (
          <div className="space-y-2">
            {servers.map((server) => (
              <div key={server.name} className="text-sm px-2">
                <p className="font-medium truncate">{server.name}</p>
                <p className="text-xs text-muted-foreground">
                  {server.active ? "Connected" : "Inactive"} · {server.libraryCount}{" "}
                  {server.libraryCount === 1 ? "library" : "libraries"}
                </p>
              </div>
            ))}
          </div>
        )}
      </StatPopover>

      <StatPopover
        icon={Layers}
        value={stats.collectionCount}
        label="Collections"
        onOpenChange={onCollectionsOpenChange}
      >
        <PopoverTitle>Filter by collection</PopoverTitle>
        {collectionsLoading ? (
          <p className="text-sm text-muted-foreground">Loading collections…</p>
        ) : collections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No collections found.</p>
        ) : (
          <div className="space-y-0.5">
            <FilterOption
              label="All collections"
              active={!activeCollection}
              onClick={() => onCollectionSelect?.(null)}
            />
            {collections.map((col) => (
              <FilterOption
                key={col.name}
                label={col.name}
                detail={`${col.count} items`}
                active={activeCollection === col.name}
                onClick={() => onCollectionSelect?.(col.name)}
              />
            ))}
          </div>
        )}
      </StatPopover>
    </div>
  );
}
