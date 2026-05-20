"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LibraryContentView } from "@/types/library-filters";

interface LibraryActiveFiltersProps {
  contentView: LibraryContentView;
  libraryName?: string;
  collectionName?: string | null;
  onClearContentView: () => void;
  onClearLibrary: () => void;
  onClearCollection: () => void;
  onClearAll: () => void;
}

export function LibraryActiveFilters({
  contentView,
  libraryName,
  collectionName,
  onClearContentView,
  onClearLibrary,
  onClearCollection,
  onClearAll,
}: LibraryActiveFiltersProps) {
  const hasContentView = contentView !== "all";
  const hasLibrary = Boolean(libraryName);
  const hasCollection = Boolean(collectionName);

  if (!hasContentView && !hasLibrary && !hasCollection) {
    return null;
  }

  let contentLabel = "";
  if (contentView === "shows") {
    contentLabel = "TV series only";
  } else if (contentView === "movies") {
    contentLabel = "Movies only";
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <span className="text-xs text-muted-foreground">Filters:</span>
      {hasContentView && (
        <Badge variant="secondary" className="gap-1 pr-1">
          {contentLabel}
          <button
            type="button"
            onClick={onClearContentView}
            className="rounded-sm hover:bg-muted p-0.5"
            aria-label="Clear content type filter"
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      )}
      {hasLibrary && libraryName && (
        <Badge variant="secondary" className="gap-1 pr-1">
          Library: {libraryName}
          <button
            type="button"
            onClick={onClearLibrary}
            className="rounded-sm hover:bg-muted p-0.5"
            aria-label="Clear library filter"
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      )}
      {hasCollection && collectionName && (
        <Badge variant="secondary" className="gap-1 pr-1">
          Collection: {collectionName}
          <button
            type="button"
            onClick={onClearCollection}
            className="rounded-sm hover:bg-muted p-0.5"
            aria-label="Clear collection filter"
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      )}
      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClearAll}>
        Clear all
      </Button>
    </div>
  );
}
