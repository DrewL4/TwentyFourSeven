"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Plus } from "lucide-react";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type PlayerKeyRow = { id: string; name: string; key: string; createdAt: string | Date; lastUsedAt: string | Date | null };

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <Input value={value} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`))}
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

/**
 * Each TV app or DVR gets its own link. Turning one off stops only that device.
 * Links never contain file paths or media-server passwords.
 */
export default function PlayerLinksCard({ showHdhr }: { showHdhr: boolean }) {
  const queryClient = useQueryClient();
  const listOptions = orpc.settings.playerKeys.list.queryOptions();
  const list = useQuery(listOptions);
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const reload = () => queryClient.invalidateQueries({ queryKey: listOptions.queryKey });

  const create = useMutation(
    orpc.settings.playerKeys.create.mutationOptions({
      onSuccess: (k) => {
        setName("");
        setOpenId(k.id);
        reload();
      },
      onError: (e: Error) => toast.error(e.message),
    }),
  );
  const revoke = useMutation(
    orpc.settings.playerKeys.revoke.mutationOptions({
      onSuccess: () => {
        reload();
        toast.success("That device's link is turned off");
      },
    }),
  );
  const lan = useMutation(
    orpc.settings.update.mutationOptions({ onSuccess: reload, onError: (e: Error) => toast.error(e.message) }),
  );

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const keys: PlayerKeyRow[] = list.data?.keys ?? [];

  return (
    <Card data-testid="player-links-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="w-5 h-5" />
          Links for TV apps
        </CardTitle>
        <CardDescription>
          Give each TV app or DVR (TiviMate, Plex DVR, Jellyfin, Channels…) its own link. If a device is lost
          or you stop using it, turn its link off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {keys.map((k) => (
          <div key={k.id} className="rounded-md border p-3" data-testid="player-key">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{k.name}</p>
                <p className="text-xs text-muted-foreground">
                  {k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleString()}` : "Not used yet"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpenId(openId === k.id ? null : k.id)}>
                  {openId === k.id ? "Hide links" : "Show links"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600"
                  disabled={revoke.isPending}
                  onClick={() => {
                    if (window.confirm(`Turn off the link for "${k.name}"? That device will stop playing until you give it a new link.`)) {
                      revoke.mutate({ id: k.id });
                    }
                  }}
                >
                  Turn off
                </Button>
              </div>
            </div>
            {openId === k.id && (
              <div className="mt-3 space-y-2">
                <CopyRow label="Playlist (M3U)" value={`${origin}/media.m3u?k=${k.key}`} />
                <CopyRow label="Guide (XMLTV)" value={`${origin}/media.xml?k=${k.key}`} />
                {showHdhr && <CopyRow label="HDHomeRun address" value={`${origin}/hdhr/${k.key}`} />}
              </div>
            )}
          </div>
        ))}

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate({ name: name.trim() });
          }}
        >
          <div className="min-w-[200px] flex-1 space-y-1">
            <Label htmlFor="new-device">Add a device</Label>
            <Input id="new-device" value={name} placeholder="Living room TV" onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            <Plus className="mr-2 h-4 w-4" />
            Make link
          </Button>
        </form>

        {list.data && (
          <div className="flex items-start justify-between gap-4 border-t pt-4">
            <div>
              <Label htmlFor="allow-lan" className="text-sm font-medium">
                Let devices at home play without a link
              </Label>
              <p className="text-xs text-muted-foreground">
                Keeps older setups working on your home network ({origin}/media.m3u). Devices outside your home
                always need a link. Turn this off for the strictest setup.
              </p>
            </div>
            <Switch
              id="allow-lan"
              checked={list.data.allowLanWithoutKey}
              disabled={lan.isPending}
              onCheckedChange={(v) => lan.mutate({ allowLanWithoutKey: v })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
