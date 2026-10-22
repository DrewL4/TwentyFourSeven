"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Settings2 } from "lucide-react";
import { AppBrandHeader } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getServerUrl } from "@/utils/server-url";

interface WatchTowerLoginFormProps {
  configured: boolean;
  allowInitialSetup: boolean;
  watchTowerUrl?: string;
  /** Status check reached WatchTower with the saved token. */
  connected?: boolean;
  /** Why the status check could not reach WatchTower. */
  connectionError?: string;
}

export default function WatchTowerLoginForm({
  configured,
  allowInitialSetup,
  watchTowerUrl: initialUrl,
  connected,
  connectionError,
}: WatchTowerLoginFormProps) {
  const [watchTowerUrl, setWatchTowerUrl] = useState(initialUrl ?? "");
  const [apiToken, setApiToken] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showApiToken, setShowApiToken] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const showSetupFields = !configured && allowInitialSetup;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const serverUrl = getServerUrl();

      if (showSetupFields) {
        if (!watchTowerUrl.trim()) {
          setError("WatchTower server URL is required.");
          return;
        }
        if (!apiToken.trim()) {
          setError("WatchTower API token is required.");
          return;
        }

        const configResponse = await fetch(`${serverUrl}/api/admin/watchtower/save-config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            watchTowerUrl: watchTowerUrl.trim(),
            apiToken: apiToken.trim(),
          }),
        });

        if (!configResponse.ok) {
          const errorData = await configResponse.json().catch(() => ({}));
          setError(errorData.error || "Failed to save WatchTower configuration.");
          return;
        }
      }

      const loginResponse = await fetch(`${serverUrl}/api/auth/watchtower`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ login, password }),
      });

      const data = await loginResponse.json().catch(() => ({}));

      if (!loginResponse.ok) {
        if (data.expirationDateFormatted) {
          setError(
            `${data.error} Your subscription expired on ${data.expirationDateFormatted}. Please renew to continue.`,
          );
        } else {
          setError(data.error || "Sign in failed. Check your WatchTower email or username and password.");
        }
        return;
      }

      if (!data.success) {
        setError(data.error || data.message || "Sign in failed.");
        return;
      }

      toast.success("Signed in successfully.");

      // Full navigation so the session cookie is included before AuthGuard runs
      window.location.href = data.redirectTo || "/";
      return;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!configured && !allowInitialSetup) {
    return (
      <Alert variant="destructive">
        <Settings2 className="h-4 w-4" />
        <AlertTitle>Sign-in unavailable</AlertTitle>
        <AlertDescription>
          WatchTower is not configured on this server yet. Ask your administrator to
          complete setup in Settings before you can sign in.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {showSetupFields && (
        <div className="space-y-4 rounded-lg border border-border/60 bg-muted/30 p-4">
          <div>
            <p className="text-sm font-medium text-foreground">First-time server setup</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect this TwentyFour/Seven instance to your WatchTower server once. After
              that, only your WatchTower login is needed here.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Easiest: in WatchTower open Admin → Connections → WatchTower Guide &amp; TFS Connect
              (the &ldquo;Connect apps&rdquo; button on the Admin home page), enter this app&rsquo;s
              address on the TwentyFourSeven card and click Connect. WatchTower fills this in for
              you. Or click Create App Tokens there and paste the TwentyFourSeven token below.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="watchTowerUrl">WatchTower server URL</Label>
            <Input
              id="watchTowerUrl"
              type="url"
              value={watchTowerUrl}
              onChange={(e) => setWatchTowerUrl(e.target.value)}
              placeholder="https://watchtower.example.com"
              autoComplete="off"
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiToken">Integration API token</Label>
            <div className="relative">
              <Input
                id="apiToken"
                type={showApiToken ? "text" : "password"}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="WatchTower: Admin → Connections → WatchTower Guide & TFS Connect"
                autoComplete="off"
                disabled={isLoading}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
                aria-label={showApiToken ? "Hide API token" : "Show API token"}
              >
                {showApiToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {configured && initialUrl && (
        connected ? (
          <p className="text-center text-xs text-muted-foreground">
            Connected to WatchTower at <span className="font-medium">{initialUrl}</span>
          </p>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Can&rsquo;t reach WatchTower</AlertTitle>
            <AlertDescription>
              {connectionError || `TwentyFourSeven can't reach WatchTower at ${initialUrl}.`}
            </AlertDescription>
          </Alert>
        )
      )}

      <div className="space-y-4">
        {showSetupFields && (
          <p className="text-sm text-muted-foreground">Sign in with your WatchTower account</p>
        )}

        <div className="space-y-2">
          <Label htmlFor="login">WatchTower email or username</Label>
          <Input
            id="login"
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="you@example.com or your username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            disabled={isLoading}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your WatchTower password"
              autoComplete="current-password"
              disabled={isLoading}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {showSetupFields ? "Setting up & signing in…" : "Signing in…"}
          </>
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}