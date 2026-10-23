"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, Tv } from "lucide-react";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginRow = { playlist: string; username: string; password: string };

function copy(label: string, value: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Couldn't copy. Select the text and copy it yourself."),
  );
}

function Field({ label, value, secret, testId }: { label: string; value: string; secret?: boolean; testId?: string }) {
  const [show, setShow] = useState(false);
  const shown = secret && !show ? "•".repeat(Math.min(Math.max(value.length, 6), 12)) : value;
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <Input value={shown} readOnly className="font-mono text-xs" data-testid={testId} onFocus={(e) => e.currentTarget.select()} />
        {secret && (
          <Button variant="ghost" size="sm" aria-label={show ? `Hide ${label}` : `Show ${label}`} onClick={() => setShow(!show)}>
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => copy(label, value)}>
          Copy
        </Button>
      </div>
    </div>
  );
}

function LoginBlock({ login, origin, showHdhr }: { login: LoginRow; origin: string; showHdhr: boolean }) {
  const [links, setLinks] = useState(false);
  const u = encodeURIComponent(login.username);
  const p = encodeURIComponent(login.password);
  return (
    <div className="rounded-md border p-3 space-y-3" data-testid="playlist-login">
      {login.playlist && <div className="text-sm font-medium">{login.playlist}</div>}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Server" value={origin} />
        <Field label="Username" value={login.username} testId="playlist-login-username" />
        <Field label="Password" value={login.password} secret testId="playlist-login-password" />
      </div>
      <Button variant="link" size="sm" className="px-0" onClick={() => setLinks(!links)}>
        {links ? "Hide ready-made links" : "Show ready-made links"}
      </Button>
      {links && (
        <div className="space-y-3">
          <Field label="Playlist (M3U) link" value={`${origin}/get.php?username=${u}&password=${p}&type=m3u_plus`} secret />
          <Field label="Guide (XMLTV) link" value={`${origin}/xmltv.php?username=${u}&password=${p}`} secret />
          {showHdhr && <Field label="HDHomeRun address" value={`${origin}/hdhr/${u}/${p}`} secret />}
        </div>
      )}
    </div>
  );
}

/**
 * The login a viewer types into an IPTV app. With ESPG connected it is the
 * same playlist login they use for ESPG; otherwise TwentyFourSeven makes one.
 */
export default function PlaylistLoginCard({ showHdhr = true, admin = false }: { showHdhr?: boolean; admin?: boolean }) {
  const queryClient = useQueryClient();
  const mineOptions = orpc.settings.playlistLogin.mine.queryOptions();
  const mine = useQuery(mineOptions);
  const reset = useMutation(
    orpc.settings.playlistLogin.resetMine.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: mineOptions.queryKey });
        toast.success("New password made. Update it in your TV apps.");
      },
    }),
  );
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const data = mine.data;
  const logins: LoginRow[] = data?.logins ?? [];
  const espg = data?.mode === "espg";

  return (
    <Card data-testid="playlist-login-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tv className="w-5 h-5" />
          {espg ? "Use the same playlist login as ESPG" : "Your TV app login"}
        </CardTitle>
        <CardDescription>
          {espg
            ? "Your ESPG playlist username and password also work here. In your IPTV app (TiviMate, IPTV Smarters…) choose “Xtream Codes” or paste the playlist link."
            : "Type this into your IPTV app (TiviMate, IPTV Smarters…) as an “Xtream Codes” login, or paste the playlist link."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mine.isLoading && <div className="animate-pulse bg-muted h-10 rounded" />}
        {data?.problem && <p className="text-sm text-amber-600 dark:text-amber-400">{data.problem}</p>}
        {logins.map((login) => (
          <LoginBlock key={login.username} login={login} origin={origin} showHdhr={showHdhr} />
        ))}
        {!espg && logins.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => reset.mutate({})} disabled={reset.isPending}>
            Make a new password
          </Button>
        )}
        {admin && <EspgAddress />}
      </CardContent>
    </Card>
  );
}

function EspgAddress() {
  const queryClient = useQueryClient();
  const espgOptions = orpc.settings.playlistLogin.espg.queryOptions();
  const espg = useQuery(espgOptions);
  const [value, setValue] = useState<string | null>(null);
  const save = useMutation(
    orpc.settings.playlistLogin.setEspg.mutationOptions({
      onSuccess: (r) => {
        (r.ok ? toast.success : toast.warning)(r.message);
        setValue(null);
        queryClient.invalidateQueries();
      },
      onError: (e: Error) => toast.error(e.message),
    }),
  );
  const current = value ?? espg.data?.espgUrl ?? "";
  return (
    <div className="border-t pt-3 space-y-2">
      <Label htmlFor="espg-url">ESPG address (optional)</Label>
      <p className="text-xs text-muted-foreground">
        Add your ESPG address so everyone can use their ESPG playlist login here. Leave it empty to use
        TwentyFourSeven&apos;s own logins.
        {espg.data?.fromEnv && " Right now it comes from the ESPG_URL setting of the container."}
      </p>
      <div className="flex items-center gap-2">
        <Input
          id="espg-url"
          placeholder="http://192.168.1.10:9191"
          value={current}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button size="sm" onClick={() => save.mutate({ espgUrl: current })} disabled={save.isPending}>
          Save
        </Button>
      </div>
    </div>
  );
}
