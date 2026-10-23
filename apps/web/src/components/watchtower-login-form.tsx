"use client";

import { useState } from "react";
import { getServerUrl } from "@/utils/server-url";
import { EyeIcon, EyeSlashIcon, ShieldCheckIcon } from "@/components/login/family-icons";

interface WatchTowerLoginFormProps {
  /** Still asking the server whether WatchTower is set up. The form shows; submit waits. */
  loading?: boolean;
  configured: boolean;
  allowInitialSetup: boolean;
  watchTowerUrl?: string;
  /** Status check reached WatchTower with the saved token. */
  connected?: boolean;
  /** Why the status check could not reach WatchTower. */
  connectionError?: string;
}

/* ESPG sign-in field and button, class for class (Tailwind 3 gray/red/green values written out). */
const FIELD =
  "tfs-login-field relative block w-full px-3 py-2.5 text-base placeholder-[#6b7280] focus:outline-none focus:ring-2 focus:ring-[#90A8C0] md:text-sm";
const SUBMIT =
  "group relative flex w-full justify-center rounded-[12px] bg-[#90A8C0] px-4 py-2.5 text-sm font-medium text-[#030712] transition-colors hover:bg-[#7e96b3] focus:outline-none focus:ring-2 focus:ring-[#90A8C0] focus:ring-offset-2 focus:ring-offset-[#f2f2f7] disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-black";

function Notice({ tone, title, children }: { tone: "error" | "ok"; title: string; children: React.ReactNode }) {
  const box = tone === "error" ? "bg-[#fef2f2] dark:bg-[#450a0a]/40" : "bg-[#f0fdf4] dark:bg-[#052e16]/40";
  const head = tone === "error" ? "text-[#991b1b] dark:text-[#fecaca]" : "text-[#166534] dark:text-[#bbf7d0]";
  const body = tone === "error" ? "text-[#b91c1c] dark:text-[#fca5a5]" : "text-[#15803d] dark:text-[#86efac]";
  return (
    <div className={`rounded-[12px] p-4 ${box}`} role={tone === "error" ? "alert" : "status"}>
      <h3 className={`text-sm font-medium ${head}`}>{title}</h3>
      <div className={`mt-2 text-sm ${body}`}>{children}</div>
    </div>
  );
}

function SecretField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  disabled: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <label htmlFor={props.id} className="sr-only">
        {props.label}
      </label>
      <input
        id={props.id}
        name={props.id}
        type={shown ? "text" : "password"}
        autoComplete={props.autoComplete}
        required
        disabled={props.disabled}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={`${FIELD} pr-10`}
        placeholder={props.label}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="absolute inset-y-0 right-0 z-20 flex items-center pr-3"
        aria-label={shown ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`}
      >
        {shown ? (
          <EyeSlashIcon className="h-5 w-5 text-[#9ca3af] hover:text-[#4b5563] dark:hover:text-[#e5e7eb]" />
        ) : (
          <EyeIcon className="h-5 w-5 text-[#9ca3af] hover:text-[#4b5563] dark:hover:text-[#e5e7eb]" />
        )}
      </button>
    </div>
  );
}

export default function WatchTowerLoginForm({
  loading = false,
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  const showSetupFields = !loading && !configured && allowInitialSetup;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
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

      setSignedIn(true);
      // Full navigation so the session cookie is included before AuthGuard runs
      window.location.href = data.redirectTo || "/";
      return;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!loading && !configured && !allowInitialSetup) {
    return (
      <Notice tone="error" title="Sign-in unavailable">
        <p>
          WatchTower is not configured on this server yet. Ask your administrator to complete setup in
          Settings before you can sign in.
        </p>
      </Notice>
    );
  }

  return (
    <>
      {configured && initialUrl && connected === false && (
        <Notice tone="error" title="Can’t reach WatchTower">
          <p>{connectionError || `TwentyFourSeven can't reach WatchTower at ${initialUrl}.`}</p>
        </Notice>
      )}

      {error && (
        <Notice tone="error" title="Authentication Error">
          <p>{error}</p>
        </Notice>
      )}

      {signedIn && (
        <Notice tone="ok" title="Authentication Successful">
          <p>✓ Signed in with WatchTower SSO</p>
          <p className="mt-1 text-xs">Redirecting...</p>
        </Notice>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        {showSetupFields && (
          <div className="space-y-4 rounded-[16px] border border-black/10 bg-white/60 p-5 shadow-sm dark:border-white/15 dark:bg-white/10">
            <div>
              <p className="text-center text-sm font-medium">First-time server setup</p>
              <p className="mt-1 text-center text-xs text-[#6b7280] dark:text-[#9ca3af]">
                In WatchTower open Admin → Connections → WatchTower Guide &amp; TFS Connect, enter this
                app&rsquo;s address on the TwentyFourSeven card and click Connect. Or click Create App
                Tokens there and paste the TwentyFourSeven token below.
              </p>
            </div>
            <div>
              <label htmlFor="watchTowerUrl" className="sr-only">
                WatchTower server URL
              </label>
              <input
                id="watchTowerUrl"
                type="url"
                value={watchTowerUrl}
                onChange={(e) => setWatchTowerUrl(e.target.value)}
                placeholder="WatchTower server URL (https://…)"
                autoComplete="off"
                disabled={isLoading}
                required
                className={FIELD}
              />
            </div>
            <SecretField
              id="apiToken"
              label="Integration API token"
              value={apiToken}
              onChange={setApiToken}
              autoComplete="off"
              disabled={isLoading}
            />
          </div>
        )}

        <div>
          <label htmlFor="login" className="sr-only">
            WatchTower email or username
          </label>
          <input
            id="login"
            name="login"
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="WatchTower email or username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            disabled={isLoading}
            required
            className={FIELD}
          />
        </div>

        <SecretField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={isLoading}
        />

        <button type="submit" disabled={isLoading || loading} className={SUBMIT}>
          <span className="absolute inset-y-0 left-0 flex items-center pl-3">
            <ShieldCheckIcon className="h-5 w-5 text-[#030712]/70" />
          </span>
          {isLoading ? (showSetupFields ? "Setting up & signing in..." : "Signing in...") : "Sign in with WatchTower SSO"}
        </button>
      </form>
    </>
  );
}
