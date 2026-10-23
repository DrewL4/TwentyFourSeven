"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderOpen, RefreshCw, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Source = "LOCAL" | "PLEX" | "JELLYFIN" | "EMBY";

const CHOICES: Array<{ id: Source; title: string; hint: string; soon?: boolean }> = [
  { id: "LOCAL", title: "Local files (recommended)", hint: "Plays videos straight from your movie and TV folders. Fastest, and nothing else has to be running." },
  { id: "PLEX", title: "Plex", hint: "Plays videos through your Plex server." },
  { id: "JELLYFIN", title: "Jellyfin", hint: "Coming soon.", soon: true },
  { id: "EMBY", title: "Emby", hint: "Coming soon.", soon: true },
];

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export default function MediaSourceCard() {
  const queryClient = useQueryClient();
  const statusOptions = orpc.settings.media.status.queryOptions();
  const status = useQuery({
    ...statusOptions,
    // Keep the count moving while a scan runs.
    refetchInterval: (q) => (q.state.data?.local.scanning ? 2000 : false),
  });
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [paths, setPaths] = useState<string | null>(null);
  const [lastSwitch, setLastSwitch] = useState<null | {
    source: Source;
    moved: number;
    unmatched: Array<{ channel: string; title: string; kind: string }>;
  }>(null);

  const refresh = (data: unknown) => queryClient.setQueryData(statusOptions.queryKey, data as never);

  const setSource = useMutation(
    orpc.settings.media.setSource.mutationOptions({
      onSuccess: (r) => {
        refresh(r.status);
        setLastSwitch({ source: r.source, moved: r.movedShows + r.movedMovies, unmatched: r.unmatched });
        queryClient.invalidateQueries();
        toast.success(r.source === "LOCAL" ? "Now playing from your local files" : "Now playing from Plex");
      },
      onError: (e: Error) => toast.error(e.message),
    }),
  );
  const scanNow = useMutation(
    orpc.settings.media.scanNow.mutationOptions({ onSuccess: refresh, onError: (e: Error) => toast.error(e.message) }),
  );
  const saveFolders = useMutation(
    orpc.settings.media.update.mutationOptions({
      onSuccess: (data) => {
        refresh(data);
        setPaths(null);
        toast.success("Folders saved");
      },
      onError: (e: Error) => toast.error(e.message),
    }),
  );

  const data = status.data;
  const current: Source = data?.source ?? "LOCAL";
  const local = data?.local;
  const tone = local?.status.tone;

  return (
    <Card data-testid="media-source-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-orange-600" />
          Where should TwentyFourSeven get your videos?
        </CardTitle>
        <CardDescription>You can switch any time. Your channels stay the same.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="radiogroup" aria-label="Video source" className="grid gap-2 sm:grid-cols-2">
          {CHOICES.map((c) => {
            const selected = current === c.id;
            const busy = setSource.isPending && setSource.variables?.source === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={c.soon || setSource.isPending || !data}
                onClick={() => !selected && setSource.mutate({ source: c.id })}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  selected ? "border-orange-600 bg-orange-50 dark:bg-orange-950/30" : "hover:bg-muted",
                  c.soon && "opacity-60 cursor-not-allowed",
                )}
              >
                <span className="flex items-center gap-2 font-medium text-sm">
                  <span
                    className={cn(
                      "inline-block h-3.5 w-3.5 rounded-full border",
                      selected ? "border-orange-600 bg-orange-600" : "border-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                  {c.title}
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{c.hint}</span>
                {c.id === "PLEX" && data && !data.plex.connected && (
                  <span className="mt-1 block text-xs text-muted-foreground">Connect Plex below first.</span>
                )}
              </button>
            );
          })}
        </div>

        {current === "LOCAL" && local && (
          <div className="space-y-3" data-testid="local-status">
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border p-3 text-sm",
                tone === "problem" && "border-amber-500/60 bg-amber-50 dark:bg-amber-950/30",
              )}
            >
              {tone === "ok" && <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />}
              {tone === "working" && <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />}
              {tone === "problem" && <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />}
              <div className="space-y-1">
                <p className="font-medium">{local.status.message}</p>
                {local.status.fixes.map((f) => (
                  <p key={f} className="text-xs text-muted-foreground">{f}</p>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => scanNow.mutate({})} disabled={scanNow.isPending || local.scanning}>
                <RefreshCw className={cn("mr-2 h-4 w-4", (scanNow.isPending || local.scanning) && "animate-spin")} />
                Scan now
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFoldersOpen((v) => !v)}>
                {foldersOpen ? "Hide folders" : "Change folders"}
              </Button>
            </div>
            {foldersOpen && (
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor="local-paths">Video folders</Label>
                <Input
                  id="local-paths"
                  value={paths ?? local.paths}
                  placeholder={local.folders.join(", ") || "/movies, /tv"}
                  onChange={(e) => setPaths(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to use /movies and /tv. These are folders inside the container: map your
                  server&apos;s movie and TV folders to them in Docker or Unraid (read-only is fine).
                  Use the same folders ESPG or Plex use.
                </p>
                <Button size="sm" onClick={() => saveFolders.mutate({ paths: paths ?? local.paths })} disabled={saveFolders.isPending || paths === null}>
                  Save folders
                </Button>
              </div>
            )}
          </div>
        )}

        {current === "PLEX" && data && (
          <p className="text-sm text-muted-foreground" data-testid="plex-status">
            {data.plex.connected
              ? `Plex is connected: ${plural(data.plex.counts.movies, "movie", "movies")} and ${plural(data.plex.counts.shows, "show", "shows")}.`
              : "Plex isn't connected yet."}{" "}
            <Link href="/settings/plex" className="underline">Plex settings</Link>
          </p>
        )}

        {lastSwitch && (
          <div className="rounded-md border p-3 text-sm" data-testid="switch-report">
            <p>
              {lastSwitch.moved > 0
                ? `Moved ${plural(lastSwitch.moved, "item", "items")} on your channels to ${lastSwitch.source === "LOCAL" ? "local files" : "Plex"}.`
                : "Your channels didn't need any changes."}
            </p>
            {lastSwitch.unmatched.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  {plural(lastSwitch.unmatched.length, "item wasn't", "items weren't")} found in{" "}
                  {lastSwitch.source === "LOCAL" ? "your folders" : "Plex"}, so {lastSwitch.unmatched.length === 1 ? "it keeps" : "they keep"} playing from before:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {lastSwitch.unmatched.slice(0, 10).map((u) => (
                    <li key={`${u.channel}-${u.title}`}>
                      {u.title} <span className="opacity-70">({u.channel})</span>
                    </li>
                  ))}
                  {lastSwitch.unmatched.length > 10 && <li>and {lastSwitch.unmatched.length - 10} more</li>}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
