"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronUp, Folder, Film, Tv, Loader2, X } from "lucide-react";
import { orpc } from "@/utils/orpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Guess = "movies" | "shows" | "mixed" | null;

const videoCount = (n: number, more: boolean) =>
  n < 0 ? "Not counted yet" : n === 0 && !more ? "No videos" : `${n.toLocaleString()}${more ? "+" : ""} ${n === 1 && !more ? "video" : "videos"}`;

function GuessTag({ guess }: { guess: Guess }) {
  if (!guess) return null;
  const label = guess === "movies" ? "Looks like Movies" : guess === "shows" ? "Looks like TV shows" : "Movies and TV mixed";
  const Icon = guess === "movies" ? Film : guess === "shows" ? Tv : Folder;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        guess === "movies" && "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
        guess === "shows" && "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
        guess === "mixed" && "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

/** Shown when the container can't see any media folder: click-by-click Unraid steps. */
export function MapFoldersHelp({ onCheckAgain, checking }: { onCheckAgain: () => void; checking: boolean }) {
  return (
    <div className="space-y-3 rounded-md border p-3 text-sm" data-testid="map-folders-help">
      <p className="font-medium">On Unraid (about a minute):</p>
      <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
        <li>
          Open the <b className="text-foreground">Docker</b> tab, click the <b className="text-foreground">TwentyFourSeven</b> icon and
          choose <b className="text-foreground">Edit</b>.
        </li>
        <li>
          Scroll to the bottom and click <b className="text-foreground">Add another Path, Port, Variable, Label or Device</b>.
        </li>
        <li>
          Leave <b className="text-foreground">Config Type</b> on <b className="text-foreground">Path</b>. Type <b className="text-foreground">Media</b> for
          Name, <code className="rounded bg-muted px-1">/media</code> for Container Path, and{" "}
          <code className="rounded bg-muted px-1">/mnt/user</code> for Host Path (or a narrower folder, like{" "}
          <code className="rounded bg-muted px-1">/mnt/user/Media</code>).
        </li>
        <li>
          Set <b className="text-foreground">Access Mode</b> to <b className="text-foreground">Read Only</b>, so TwentyFourSeven can never change
          your files. Click <b className="text-foreground">Add</b>, then <b className="text-foreground">Apply</b>.
        </li>
        <li>Come back here and press <b className="text-foreground">Check again</b>, then <b className="text-foreground">Find my videos</b>.</li>
      </ol>
      <details className="rounded border p-2">
        <summary className="cursor-pointer text-xs font-medium">Using Docker Compose instead?</summary>
        <p className="mt-2 text-xs text-muted-foreground">Add a read-only volume to the TwentyFourSeven service, then restart it:</p>
        <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{`services:
  twentyfourseven:
    volumes:
      - /path/to/your/videos:/media:ro`}</pre>
      </details>
      <Button size="sm" variant="outline" onClick={onCheckAgain} disabled={checking}>
        {checking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Check again
      </Button>
    </div>
  );
}

/** "Find my videos": suggestions to accept with one click. */
export function FindMyVideos({ onSave, saving, onBrowse }: { onSave: (folders: string[]) => void; saving: boolean; onBrowse: () => void }) {
  const find = useQuery({ ...orpc.settings.media.findVideos.queryOptions(), staleTime: 0, gcTime: 0, refetchOnWindowFocus: false });
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const suggestions = find.data?.suggestions ?? [];
  useEffect(() => {
    if (find.data) setTicked(new Set(find.data.suggestions.map((s) => s.path)));
  }, [find.data]);

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="find-my-videos">
      {find.isFetching && (
        <p className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Looking for your movies and TV shows…
        </p>
      )}
      {find.isError && <p className="text-sm text-red-600">Couldn&apos;t look through your folders: {(find.error as Error).message}</p>}
      {!find.isFetching && find.data && suggestions.length === 0 && (
        <p className="text-sm">
          No movie or TV folders turned up. Press <b>Browse</b> to look yourself.
        </p>
      )}
      {!find.isFetching && suggestions.length > 0 && (
        <>
          <p className="text-sm font-medium">
            Found {suggestions.length === 1 ? "this folder" : "these folders"}. Untick anything that isn&apos;t yours to stream:
          </p>
          <ul className="space-y-1.5">
            {suggestions.map((s) => (
              <li key={s.path}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md border p-2 hover:bg-muted">
                  <Checkbox
                    checked={ticked?.has(s.path) ?? true}
                    onCheckedChange={(v) =>
                      setTicked((prev) => {
                        const next = new Set(prev ?? []);
                        if (v) next.add(s.path);
                        else next.delete(s.path);
                        return next;
                      })
                    }
                    aria-label={s.path}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm">{s.path}</span>
                    <span className="text-xs text-muted-foreground">{videoCount(s.videos, s.more)}</span>
                  </span>
                  <GuessTag guess={s.kind} />
                </label>
              </li>
            ))}
          </ul>
          {find.data && !find.data.finished && (
            <p className="text-xs text-muted-foreground">Stopped early to stay quick. Use Browse if a folder is missing.</p>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {suggestions.length > 0 && (
          <Button size="sm" onClick={() => onSave([...(ticked ?? [])])} disabled={saving || !ticked || ticked.size === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Use {ticked && ticked.size === 1 ? "this folder" : "these folders"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onBrowse}>
          Browse instead
        </Button>
      </div>
    </div>
  );
}

/** Folder-by-folder picker. Only ever shows folders inside /movies, /tv and /media. */
export function FolderBrowser({
  initial,
  onSave,
  saving,
}: {
  initial: string[];
  onSave: (folders: string[]) => void;
  saving: boolean;
}) {
  const [at, setAt] = useState<string>("");
  const [picked, setPicked] = useState<string[]>(initial);
  const listing = useQuery({
    ...orpc.settings.media.browse.queryOptions({ input: { path: at || undefined } }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const data = listing.data;
  // With a single shared folder (the usual Unraid /media), open it right away.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || at || !data || data.path !== null) return;
    autoOpened.current = true;
    if (data.entries.length === 1 && data.entries[0].hasFolders) setAt(data.entries[0].path);
  }, [at, data]);
  const toggle = (p: string, on: boolean) =>
    setPicked((prev) => (on ? [...prev.filter((x) => x !== p), p] : prev.filter((x) => x !== p)));
  const crumbs = at ? at.split("/").filter(Boolean) : [];

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="folder-browser">
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" className="rounded px-1 hover:bg-muted" onClick={() => setAt("")}>
          All folders
        </button>
        {crumbs.map((c, i) => {
          const p = "/" + crumbs.slice(0, i + 1).join("/");
          return (
            <span key={p} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <button type="button" className="rounded px-1 font-mono hover:bg-muted" onClick={() => setAt(p)}>
                {c}
              </button>
            </span>
          );
        })}
      </div>
      {data && data.parent !== null && (
        <Button size="sm" variant="ghost" onClick={() => setAt(data.parent ?? "")}>
          <ChevronUp className="mr-1 h-4 w-4" /> Up one folder
        </Button>
      )}
      {listing.isFetching && !data && (
        <p className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Opening…
        </p>
      )}
      {listing.isError && <p className="text-sm text-red-600">{(listing.error as Error).message}</p>}
      {data && data.entries.length === 0 && (
        <p className="text-sm text-muted-foreground">{at ? "No folders in here." : "No video folders are shared with TwentyFourSeven yet."}</p>
      )}
      {data && data.entries.length > 0 && (
        <ul className={cn("max-h-80 space-y-1 overflow-y-auto", listing.isFetching && "opacity-60")}>
          {data.entries.map((e) => {
            const on = picked.includes(e.path);
            return (
              <li key={e.path} className="flex items-center gap-3 rounded-md border p-2" data-testid="folder-row">
                <Checkbox checked={on} onCheckedChange={(v) => toggle(e.path, !!v)} aria-label={`Use ${e.path}`} />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                  onClick={() => e.hasFolders && setAt(e.path)}
                  disabled={!e.hasFolders}
                  title={e.hasFolders ? "Open" : undefined}
                >
                  <Folder className="h-4 w-4 shrink-0 text-accent-text" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{e.name}</span>
                    <span className="text-xs text-muted-foreground">{videoCount(e.videos, e.more)}</span>
                  </span>
                </button>
                <GuessTag guess={e.guess} />
                {e.hasFolders && (
                  <Button size="sm" variant="ghost" onClick={() => setAt(e.path)} aria-label={`Open ${e.name}`}>
                    Open <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data?.truncated && <p className="text-xs text-muted-foreground">Showing the first 300 folders.</p>}
      <div className="space-y-2 border-t pt-3">
        <p className="text-sm font-medium">{picked.length ? "Folders TwentyFourSeven will use:" : "Tick the folders that have your movies or TV shows."}</p>
        {picked.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {picked.map((p) => (
              <li key={p} className="flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs">
                {p}
                <button type="button" onClick={() => toggle(p, false)} aria-label={`Remove ${p}`}>
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" onClick={() => onSave(picked)} disabled={saving || picked.length === 0}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save folders
        </Button>
      </div>
    </div>
  );
}


