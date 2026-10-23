"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Row = {
  userId: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  login: { username: string; password: string | null; custom: boolean; origin: string; updatedAt: string | Date } | null;
};

function originLabel(login: Row["login"]) {
  if (!login) return { text: "None yet", variant: "outline" as const };
  if (login.custom) return { text: "Set by admin", variant: "default" as const };
  if (login.origin === "default") return { text: "Default", variant: "secondary" as const };
  return { text: "Older login", variant: "outline" as const };
}

function Secret({ value }: { value: string | null }) {
  const [show, setShow] = useState(false);
  if (value == null) return <span className="text-xs text-amber-600">needs a reset</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs">{show ? value : "••••••••"}</span>
      <Button variant="ghost" size="sm" className="h-6 px-1" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>
        {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </Button>
    </span>
  );
}

function Editor({ row, onDone }: { row: Row; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(row.login?.username ?? "");
  const [password, setPassword] = useState(row.login?.password ?? "");
  const [first, setFirst] = useState(row.firstName);
  const [last, setLast] = useState(row.lastName);
  const done = (msg: string) => {
    toast.success(msg);
    queryClient.invalidateQueries();
    onDone();
  };
  const save = useMutation(orpc.settings.playlistLogin.adminSet.mutationOptions({ onSuccess: () => done("Login saved. It stays as set until you reset it."), onError: (e: Error) => toast.error(e.message) }));
  const names = useMutation(orpc.settings.playlistLogin.adminSetNames.mutationOptions({ onSuccess: (r) => done(r.message), onError: (e: Error) => toast.error(e.message) }));
  return (
    <div className="mt-3 grid gap-3 rounded-md border p-3 md:grid-cols-2" data-testid="playlist-login-editor">
      <div className="space-y-2">
        <div className="text-sm font-medium">Playlist login</div>
        <div>
          <Label htmlFor={`u-${row.userId}`} className="text-xs">Username</Label>
          <Input id={`u-${row.userId}`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <Label htmlFor={`p-${row.userId}`} className="text-xs">Password</Label>
          <Input id={`p-${row.userId}`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => save.mutate({ userId: row.userId, username, password })} disabled={save.isPending}>Save login</Button>
          <Button size="sm" variant="outline" onClick={onDone}>Cancel</Button>
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Names used for the default</div>
        <div>
          <Label htmlFor={`f-${row.userId}`} className="text-xs">First name</Label>
          <Input id={`f-${row.userId}`} value={first} onChange={(e) => setFirst(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`l-${row.userId}`} className="text-xs">Last name</Label>
          <Input id={`l-${row.userId}`} value={last} onChange={(e) => setLast(e.target.value)} />
        </div>
        <Button size="sm" variant="outline" onClick={() => names.mutate({ userId: row.userId, firstName: first, lastName: last })} disabled={names.isPending}>Save names</Button>
      </div>
    </div>
  );
}

/** Admin: every person's playlist login (Xtream Codes + M3U). Editable only when 24/7 runs on its own. */
export default function PlaylistLoginsAdmin() {
  const queryClient = useQueryClient();
  const listOptions = orpc.settings.playlistLogin.list.queryOptions();
  const list = useQuery(listOptions);
  const [editing, setEditing] = useState<string | null>(null);
  const reset = useMutation(
    orpc.settings.playlistLogin.adminReset.mutationOptions({
      onSuccess: (r) => {
        toast.success(`Reset to the default: ${r.username}`);
        queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
      },
      onError: (e: Error) => toast.error(e.message),
    }),
  );
  const d = list.data;
  return (
    <Card id="playlist-logins" data-testid="playlist-logins-admin">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="w-5 h-5" /> Playlist logins
        </CardTitle>
        <CardDescription>
          The username and password each person types into a TV app (Xtream Codes or the M3U link).
          {d && !d.readOnly && ` New and reset logins are “${d.playlistName}” + first name, with the last name as the password.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {d?.readOnly && (
          <p className="rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm" data-testid="playlist-logins-readonly">
            Linked to ESPG: these logins come from ESPG. Edit or reset them in ESPG (Users → Playlist login). The list below shows the logins 24/7 kept for itself, which don&apos;t work while linked.
          </p>
        )}
        {list.isLoading && <div className="animate-pulse bg-muted h-10 rounded" />}
        {d?.users.map((row) => {
          const label = originLabel(row.login);
          return (
            <div key={row.userId} className="rounded-md border p-3" data-testid="playlist-login-row">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-[12rem] flex-1">
                  <div className="text-sm font-medium">{row.name || row.email}</div>
                  <div className="text-xs text-muted-foreground">{row.email}</div>
                </div>
                <div className="min-w-[10rem]">
                  <div className="text-xs text-muted-foreground">Username</div>
                  <div className="font-mono text-xs">{row.login?.username ?? "—"}</div>
                </div>
                <div className="min-w-[8rem]">
                  <div className="text-xs text-muted-foreground">Password</div>
                  {row.login ? <Secret value={row.login.password} /> : <span>—</span>}
                </div>
                <Badge variant={label.variant}>{label.text}</Badge>
                {!d.readOnly && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(editing === row.userId ? null : row.userId)}>
                      {row.login ? "Edit" : "Add"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reset.mutate({ userId: row.userId })} disabled={reset.isPending}>
                      Reset to default
                    </Button>
                  </div>
                )}
              </div>
              {editing === row.userId && !d.readOnly && <Editor row={row} onDone={() => setEditing(null)} />}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
