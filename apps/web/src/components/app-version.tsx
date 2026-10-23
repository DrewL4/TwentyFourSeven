"use client";

import { useEffect, useState } from "react";
import { getServerUrl } from "@/utils/server-url";

type BuildInfo = { version: string; revision: string; build_date: string };

// Read from the server at runtime (CI build args -> env), so it is not baked into the bundle.
// One request per page load, shared by every <AppVersion>.
const DEV: BuildInfo = { version: "dev", revision: "", build_date: "" };
let buildInfoPromise: Promise<BuildInfo> | null = null;

function loadBuildInfo(): Promise<BuildInfo> {
  if (!buildInfoPromise) {
    buildInfoPromise = fetch(`${getServerUrl()}/api/version`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : DEV))
      .then((d) => ({
        version: typeof d?.version === "string" && d.version ? d.version : "dev",
        revision: typeof d?.revision === "string" ? d.revision : "",
        build_date: typeof d?.build_date === "string" ? d.build_date : "",
      }))
      .catch(() => DEV);
  }
  return buildInfoPromise;
}

export function formatBuildInfo(info: BuildInfo, compact = false): string {
  if (info.version === "dev") return "dev";
  const v = `v${info.version}`;
  return compact || !info.revision ? v : `${v} · ${info.revision}`;
}

export function AppVersion({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const [info, setInfo] = useState<BuildInfo | null>(null);
  useEffect(() => {
    let alive = true;
    loadBuildInfo().then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, []);
  if (!info) return null;
  const title = [`Version ${info.version}`, info.revision && `commit ${info.revision}`, info.build_date && `built ${info.build_date}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <p
      className={`select-text truncate text-[0.65rem] leading-4 text-muted-foreground/80 ${compact ? "text-center" : "px-2"} ${className}`}
      title={title}
      data-testid="app-version"
    >
      {formatBuildInfo(info, compact)}
    </p>
  );
}
