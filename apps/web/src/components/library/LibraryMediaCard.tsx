"use client";

import { OptimizedPoster } from "@/components/ui/optimized-poster";
import { cn } from "@/lib/utils";

/** Responsive poster grid — ~130–150px tiles at typical library widths. */
export const LIBRARY_MEDIA_GRID_CLASS =
  "grid gap-3 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]";

interface LibraryMediaCardProps {
  id: string;
  title: string;
  poster: string | null;
  type: "show" | "movie";
  subtitle: string;
  priority?: boolean;
}

export function LibraryMediaCard({
  title,
  poster,
  type,
  subtitle,
  priority = false,
}: LibraryMediaCardProps) {
  return (
    <article
      className={cn(
        "group overflow-hidden rounded-md border border-border/50 bg-card/40",
        "transition-colors hover:border-border hover:bg-card hover:shadow-sm",
      )}
    >
      <OptimizedPoster
        src={poster}
        alt={`${title} poster`}
        title={title}
        type={type}
        priority={priority}
        className="rounded-b-none"
        compact
      />
      <div className="px-2 py-1.5 space-y-0.5">
        <h3 className="text-xs font-medium leading-snug line-clamp-2" title={title}>
          {title}
        </h3>
        <p className="text-[11px] text-muted-foreground line-clamp-1">{subtitle}</p>
      </div>
    </article>
  );
}
