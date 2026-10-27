"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Plus, Radio, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function statusText(s: { lastStatus: string | null; lastError: string | null; lastRunAt: Date | string | null }) {
  if (s.lastStatus === "running") return "Downloading…";
  if (!s.lastRunAt) return "Not downloaded yet";
  const when = new Date(s.lastRunAt).toLocaleString();
  if (s.lastStatus === "failed") return `Failed ${when}: ${s.lastError ?? "unknown error"}`;
  if (s.lastStatus === "ok-with-skips") return `Done ${when} (some videos were unavailable)`;
  return `Done ${when}`;
}

export default function YoutubeSettingsPage() {
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    ...orpc.youtube.list.queryOptions(),
    // Poll while any download is running.
    refetchInterval: (q) => (q.state.data?.some((s) => s.lastStatus === "running") ? 4000 : false),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.youtube.list.queryOptions().queryKey });
  const fail = (e: Error) => toast.error(e.message || "Something went wrong");

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [maxVideos, setMaxVideos] = useState("10");

  const createMutation = useMutation(
    orpc.youtube.create.mutationOptions({
      onSuccess: () => {
        setName("");
        setUrl("");
        refresh();
        toast.success("Added. Press Download to fetch the newest videos.");
      },
      onError: fail,
    }),
  );
  const runMutation = useMutation(
    orpc.youtube.runNow.mutationOptions({ onSuccess: refresh, onError: fail }),
  );
  const deleteMutation = useMutation(
    orpc.youtube.delete.mutationOptions({ onSuccess: refresh, onError: fail }),
  );
  const toggleMutation = useMutation(
    orpc.youtube.update.mutationOptions({ onSuccess: refresh, onError: fail }),
  );
  const channelMutation = useMutation(
    orpc.youtube.createChannel.mutationOptions({
      onSuccess: (r) => {
        refresh();
        toast.success(`Channel ${r.number} "${r.name}" created`);
      },
      onError: fail,
    }),
  );

  return (
    <div className="container mx-auto max-w-2xl px-4 py-4 pb-6 md:py-6 md:px-6 space-y-4 md:space-y-6">
      <div className="flex items-center gap-2 min-w-0">
        <Button variant="ghost" size="sm" className="shrink-0 -ml-2 touch-manipulation" asChild>
          <Link href="/settings">
            <ArrowLeft className="w-4 h-4 mr-1" />
            <span className="sr-only sm:not-sr-only sm:inline">Settings</span>
          </Link>
        </Button>
        <h1 className="text-lg md:text-xl font-semibold tracking-[-0.03em] truncate">YouTube channels</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Add a YouTube channel or playlist. The server downloads the newest videos into your TV folder, checks again every
        few hours, and they appear in your library as a show you can turn into a channel. Only download videos you have
        the right to keep.
      </p>

      <form
        className="rounded-lg border p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate({ name, url, maxVideos: Number(maxVideos) || 10 });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="yt-name">Channel name</Label>
          <Input id="yt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kurzgesagt" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="yt-url">YouTube address</Label>
          <Input
            id="yt-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/@kurzgesagt"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="yt-max">Newest videos to keep per check</Label>
          <Input id="yt-max" type="number" min={1} max={200} value={maxVideos} onChange={(e) => setMaxVideos(e.target.value)} />
        </div>
        <Button type="submit" disabled={createMutation.isPending} className="touch-manipulation">
          <Plus className="w-4 h-4 mr-1.5" />
          Add
        </Button>
      </form>

      <ul className="space-y-2">
        {(listQuery.data ?? []).map((s) => (
          <li key={s.id} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{s.name}</div>
                <div className="text-xs text-muted-foreground truncate">{s.url}</div>
              </div>
              <label className="flex items-center gap-1.5 text-xs shrink-0">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => toggleMutation.mutate({ id: s.id, enabled: e.target.checked })}
                />
                Auto-check
              </label>
            </div>
            <div className="text-xs text-muted-foreground">{statusText(s)}</div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="touch-manipulation"
                disabled={s.lastStatus === "running" || runMutation.isPending}
                onClick={() => runMutation.mutate({ id: s.id })}
              >
                <Download className="w-4 h-4 mr-1.5" />
                Download now
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="touch-manipulation"
                disabled={!!s.channelId || channelMutation.isPending}
                onClick={() => channelMutation.mutate({ id: s.id })}
                title={s.channelId ? "This source already has a channel" : "Make a channel from the downloaded videos"}
              >
                <Radio className="w-4 h-4 mr-1.5" />
                {s.channelId ? "Has a channel" : "Create channel"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive touch-manipulation"
                onClick={() => {
                  if (confirm(`Remove "${s.name}"? Downloaded videos stay on disk.`)) deleteMutation.mutate({ id: s.id });
                }}
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Remove
              </Button>
            </div>
          </li>
        ))}
        {listQuery.data?.length === 0 && <li className="text-sm text-muted-foreground">No YouTube channels yet.</li>}
      </ul>
    </div>
  );
}
