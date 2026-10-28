"use client";

import { ArrowDown, ArrowUp, CalendarClock, Check, Clock, Film, Loader2, Trash2, Tv, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { releaseText, statusView, TONE_CLASS, type ReleaseView, type WtView } from "./request-status";

export type RowItem = {
  key: string;
  kind: "MOVIE" | "SHOW" | "SEASON" | "EPISODES";
  label: string;
  year?: number | null;
  posterPath?: string | null;
  available: boolean;
  /** Extra line, e.g. "2 of 6 episodes in your library". */
  note?: string | null;
  requested?: boolean;
  /** What WatchTower says about a request for this title (null: nobody asked, or it could not be checked). */
  wt?: WtView | null;
  /** WatchTower answered for this title, so its answer (even "nobody asked") replaces 24/7's own note. */
  wtChecked?: boolean;
  /** Theatrical / digital / premiere info for a title that is not out yet. */
  release?: ReleaseView | null;
  excluded?: boolean;
  manual?: boolean;
};

export function EntryRow(props: {
  item: RowItem;
  index: number;
  requesting?: boolean;
  onRequest?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  onRestore?: () => void;
  busy?: boolean;
}) {
  const { item } = props;
  const Icon = item.kind === "MOVIE" ? Film : Tv;
  const status = statusView(item.wt, !!item.requested && !item.wtChecked);
  const coming = item.available || item.excluded ? "" : releaseText(item.release);
  return (
    <li
      className={cn("flex items-center gap-3 rounded-lg border px-2 py-2 text-sm", item.excluded && "opacity-50")}
      data-testid="franchise-entry"
      data-available={item.available ? "yes" : "no"}
    >
      <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">{props.index + 1}</span>
      {item.posterPath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://image.tmdb.org/t/p/w92${item.posterPath}`}
          alt=""
          loading="lazy"
          className="h-12 w-8 shrink-0 rounded object-cover bg-muted"
        />
      ) : (
        <span className="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{item.label}</span>
          {item.year ? <span className="shrink-0 text-xs text-muted-foreground">({item.year})</span> : null}
        </div>
        <div className="text-xs mt-0.5">
          {item.excluded ? (
            <span className="text-muted-foreground">Hidden from this franchise</span>
          ) : item.available ? (
            <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
              <Check className="h-3 w-3" /> In your library
            </span>
          ) : (
            <span
              className={cn("inline-flex items-center gap-1", TONE_CLASS[status.tone])}
              data-testid="franchise-status"
              data-state={item.wt?.state ?? (item.requested && !item.wtChecked ? "requested-local" : "missing")}
            >
              {status.tone === "amber" ? null : <Clock className="h-3 w-3" />}
              {status.text}
            </span>
          )}
          {item.note ? <span className="text-muted-foreground"> · {item.note}</span> : null}
        </div>
        {coming ? (
          <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="franchise-release">
            <CalendarClock className="h-3 w-3" /> {coming}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        {!item.excluded && !item.available && status.canRequest && props.onRequest && (
          <Button size="sm" variant="outline" className="min-h-9" data-testid="request-item" disabled={props.requesting || props.busy} onClick={props.onRequest}>
            {props.requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : status.requestLabel}
          </Button>
        )}
        {props.onMoveUp && !item.excluded && (
          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Move ${item.label} up`} disabled={props.busy} onClick={props.onMoveUp}>
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
        {props.onMoveDown && !item.excluded && (
          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Move ${item.label} down`} disabled={props.busy} onClick={props.onMoveDown}>
            <ArrowDown className="h-4 w-4" />
          </Button>
        )}
        {props.onRemove && !item.excluded && (
          <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" aria-label={`Remove ${item.label}`} disabled={props.busy} onClick={props.onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        {props.onRestore && item.excluded && (
          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Put ${item.label} back`} disabled={props.busy} onClick={props.onRestore}>
            <Undo2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </li>
  );
}
