"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import WatchTowerLoginForm from "@/components/watchtower-login-form";
import { AppBrandHeader } from "@/components/app-logo";
import { getServerUrl } from "@/utils/server-url";

interface WatchTowerStatus {
  configured: boolean;
  url?: string;
  connected?: boolean;
  error?: string;
  allowInitialSetup?: boolean;
}

export default function LoginPage() {
  const [status, setStatus] = useState<WatchTowerStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const serverUrl = getServerUrl();
        const response = await fetch(`${serverUrl}/api/admin/watchtower/status`, {
          credentials: "include",
        });

        if (!response.ok) {
          if (!cancelled) {
            setStatus({ configured: false, allowInitialSetup: false });
          }
          return;
        }

        const data = await response.json();
        if (cancelled) return;

        setStatus({
          configured: Boolean(data.configured),
          url: data.url,
          connected: Boolean(data.connected),
          error: typeof data.error === "string" ? data.error : undefined,
          allowInitialSetup: Boolean(data.allowInitialSetup),
        });
      } catch {
        if (!cancelled) {
          setStatus({ configured: false, allowInitialSetup: false });
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/80 p-8 shadow-xl shadow-black/5 backdrop-blur-sm dark:shadow-black/20">
      <AppBrandHeader className="mb-8" />

      {status === null ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Checking sign-in…</p>
        </div>
      ) : (
        <>
          <div className="mb-6 text-center">
            <h2 className="text-lg font-semibold text-foreground">Sign in with WatchTower</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use the same email (or username) and password as your WatchTower account
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              WatchTower is the shared sign-in for your media apps, so TwentyFourSeven doesn&apos;t have a separate password.
            </p>
          </div>

          <WatchTowerLoginForm
            configured={status.configured}
            allowInitialSetup={status.allowInitialSetup ?? false}
            watchTowerUrl={status.url}
            connected={status.connected}
            connectionError={status.error}
          />
        </>
      )}
    </div>
  );
}
