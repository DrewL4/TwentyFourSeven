"use client";

import { useEffect, useState } from "react";
import WatchTowerLoginForm from "@/components/watchtower-login-form";
import { APP_LOGO_SRC } from "@/components/app-logo";
import { getServerUrl } from "@/utils/server-url";

const PRODUCT_NAME = "TwentyFour/Seven";

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
    <>
      <div>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={APP_LOGO_SRC} alt={PRODUCT_NAME} width={80} height={80} className="h-20 w-20 rounded-[16px] object-cover shadow-md" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold">{PRODUCT_NAME}</h2>
        <p className="mt-2 text-center text-sm text-[#4b5563] dark:text-[#9ca3af]">
          Live TV from your media library. Sign in below with your WatchTower account.
        </p>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-black/10 dark:border-white/15" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-[#f2f2f7] px-3 text-[#6b7280] dark:bg-black dark:text-[#9ca3af]">{PRODUCT_NAME} sign-in</span>
        </div>
      </div>

      <div>
        <h3 className="text-center text-lg font-semibold">Sign in to {PRODUCT_NAME}</h3>
        <p className="mt-1 text-center text-sm text-[#4b5563] dark:text-[#9ca3af]">
          WatchTower SSO is required. Use the same email (or username) and password as WatchTower.
        </p>
      </div>

      <WatchTowerLoginForm
        loading={status === null}
        configured={status?.configured ?? true}
        allowInitialSetup={status?.allowInitialSetup ?? false}
        watchTowerUrl={status?.url}
        connected={status?.connected ?? true}
        connectionError={status?.error}
      />
    </>
  );
}
