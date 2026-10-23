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
  const [more, setMore] = useState(false);
  const u = encodeURIComponent(login.username);
  const p = encodeURIComponent(login.password);
  return (
    <div className="rounded-md border p-3 space-y-3" data-testid="playlist-login">
      {login.playlist && <div className="text-sm font-medium">{login.playlist}</div>}
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Xtream Codes</div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Server" value={origin} testId="playlist-login-server" />
        <Field label="Username" value={login.username} testId="playlist-login-username" />
        <Field label="Password" value={login.password} secret testId="playlist-login-password" />
      </div>
      <Field label="Or paste this playlist (M3U) link" value={`${origin}/get.php?username=${u}&password=${p}&type=m3u_plus`} secret testId="playlist-login-m3u" />
      <Button variant="link" size="sm" className="px-0" onClick={() => setMore(!more)}>
        {more ? "Hide guide and HDHomeRun links" : "Show guide and HDHomeRun links"}
      </Button>
      {more && (
        <div className="space-y-3">
          <Field label="Guide (XMLTV) link" value={`${origin}/xmltv.php?username=${u}&password=${p}`} secret />
          {showHdhr && <Field label="HDHomeRun address" value={`${origin}/hdhr/${u}/${p}`} secret />}
        </div>
      )}
    </div>
  );
}

/**
 * The login a viewer types into an IPTV app. The same username and password work
 * as an Xtream Codes login and in the M3U link. Linked to ESPG it is the ESPG
 * playlist login; on its own TwentyFourSeven keeps one per person.
 */
export default function PlaylistLoginCard({ showHdhr = true, admin = false }: { showHdhr?: boolean; admin?: boolean }) {
  const queryClient = useQueryClient();
  const mineOptions = orpc.settings.playlistLogin.mine.queryOptions();
  const mine = useQuery(mineOptions);
  const reset = useMutation(
    orpc.settings.playlistLogin.resetMine.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: mineOptions.queryKey });
        toast.success("Login reset to the default. Update it in your TV apps.");
      },
      onError: (e: Error) => toast.error(e.message),
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
          {espg ? "Your TV app login (from ESPG)" : "Your TV app login"}
        </CardTitle>
        <CardDescription>
          {espg
            ? "This is your ESPG playlist login; it works here too. In your IPTV app (TiviMate, IPTV Smarters…) choose “Xtream Codes” and type the server, username and password, or paste the M3U link. To change it, change it in ESPG."
            : "In your IPTV app (TiviMate, IPTV Smarters…) choose “Xtream Codes” and type the server, username and password below, or paste the M3U link. Both use the same login."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mine.isLoading && <div className="animate-pulse bg-muted h-10 rounded" />}
        {data?.problem && <p className="text-sm text-amber-600 dark:text-amber-400" data-testid="playlist-login-problem">{data.problem}</p>}
        {logins.map((login) => (
          <LoginBlock key={login.username} login={login} origin={origin} showHdhr={showHdhr} />
        ))}
        {!espg && logins.length > 0 && !data?.custom && (
          <Button variant="outline" size="sm" onClick={() => reset.mutate({})} disabled={reset.isPending}>
            Reset to default
          </Button>
        )}
        {!espg && data?.custom && (
          <p className="text-xs text-muted-foreground">Your admin set this login. Ask them if you need it changed.</p>
        )}
        {admin && <PlaylistLoginModeCard />}
      </CardContent>
    </Card>
  );
}

/** Admin: where logins come from, the playlist name for new logins, and the ESPG address. */
export function PlaylistLoginModeCard() {
  const queryClient = useQueryClient();
  const settingsOptions = orpc.settings.playlistLogin.settings.queryOptions();
  const s = useQuery(settingsOptions);
  const [pending, setPending] = useState<"tfs" | "espg" | null>(null);
  const [name, setName] = useState<string | null>(null);
  const setMode = useMutation(
    orpc.settings.playlistLogin.setMode.mutationOptions({
      onSuccess: (r) => {
        (r.ok ? toast.success : toast.warning)(r.message);
        setPending(null);
        queryClient.invalidateQueries();
      },
      onError: (e: Error) => toast.error(e.message),
    }),
  );
  const saveName = useMutation(
    orpc.settings.playlistLogin.setPlaylistName.mutationOptions({
      onSuccess: (r) => {
        toast.success(r.message);
        setName(null);
        queryClient.invalidateQueries({ queryKey: settingsOptions.queryKey });
      },
      onError: (e: Error) => toast.error(e.message),
    }),
  );
  const d = s.data;
  if (!d) return <div className="animate-pulse bg-muted h-10 rounded" />;
  const options = [
    { id: "tfs" as const, title: "On its own", text: "24/7 manages its own playlist logins." },
    { id: "espg" as const, title: "Linked to ESPG", text: "Logins come from ESPG and are edited there." },
  ];
  const warning =
    pending === "espg"
      ? `${d.localLogins} TwentyFourSeven login${d.localLogins === 1 ? "" : "s"} will stop working, with every TV app and device set up with them. People then use their ESPG playlist login. The 24/7 logins are kept, so switching back brings them back.`
      : pending === "tfs"
        ? "ESPG playlist logins will stop working here, with every TV app and device set up with them. Everyone gets a 24/7 login instead (Settings shows it to them). ESPG keeps its logins."
        : null;
  const nameValue = name ?? d.playlistName;
  return (
    <div className="border-t pt-3 space-y-4" data-testid="playlist-login-mode">
      <div className="space-y-2">
        <Label>Playlist logins</Label>
        {!d.chosen && (
          <p className="text-xs text-muted-foreground">
            Not chosen yet; using “{d.mode === "espg" ? "Linked to ESPG" : "On its own"}” because {d.mode === "espg" ? "an ESPG address is saved" : "no ESPG address is saved"}.
          </p>
        )}
        <div className="grid gap-2 md:grid-cols-2" role="radiogroup" aria-label="Playlist logins">
          {options.map((o) => {
            const on = d.mode === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`login-mode-${o.id}`}
                onClick={() => (on ? setPending(null) : setPending(o.id))}
                className={`rounded-md border p-3 text-left transition-colors ${on ? "border-primary bg-primary/10" : "hover:bg-muted"} ${pending === o.id ? "ring-2 ring-amber-500" : ""}`}
              >
                <div className="text-sm font-medium">{o.title}{on && " (in use)"}</div>
                <div className="text-xs text-muted-foreground">{o.text}</div>
              </button>
            );
          })}
        </div>
        {warning && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2" data-testid="login-mode-warning">
            <p className="text-sm">{warning}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => pending && setMode.mutate({ mode: pending })} disabled={setMode.isPending}>
                Switch to {pending === "espg" ? "Linked to ESPG" : "On its own"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {d.problem && <p className="text-sm text-red-600 dark:text-red-400" data-testid="login-mode-problem">{d.problem}</p>}
      </div>
      {d.mode === "tfs" && (
        <div className="space-y-2">
          <Label htmlFor="playlist-name">Playlist name</Label>
          <p className="text-xs text-muted-foreground">
            New logins are this name plus the first name (like ESPG), with the last name as the password. Existing logins don&apos;t change.
          </p>
          <div className="flex items-center gap-2">
            <Input id="playlist-name" value={nameValue} maxLength={40} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
            <Button size="sm" onClick={() => saveName.mutate({ playlistName: nameValue })} disabled={saveName.isPending || !nameValue.trim()}>
              Save
            </Button>
          </div>
        </div>
      )}
      <EspgAddress />
      <a href="/users#playlist-logins" className="text-sm underline underline-offset-2">
        See and edit everyone&apos;s playlist login
      </a>
    </div>
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
    <div className="space-y-2">
      <Label htmlFor="espg-url">ESPG address</Label>
      <p className="text-xs text-muted-foreground">
        Needed for “Linked to ESPG” and for 24/7 channels inside ESPG playlists. Saving it doesn&apos;t change where logins come from.
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
