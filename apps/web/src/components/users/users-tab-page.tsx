"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import UsersTab from "./users-tab";
import type { UsersTabApi } from "@/lib/users-tab-helpers";

async function readJson(response: Response) {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error: any = new Error(body?.error || `The request failed (HTTP ${response.status}).`);
    error.response = { data: body };
    throw error;
  }
  return body;
}

// 24/7 asks its own server, which asks WatchTower (signed) on this person's behalf.
const sharedApi: UsersTabApi = {
  directory: async () => readJson(await fetch("/api/users-tab", { credentials: "include", cache: "no-store" })),
  action: async (body) =>
    readJson(
      await fetch("/api/users-tab/action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
};

/**
 * The same Users tab as WatchTower and ESPG. Admins also get "Manage & logins" (24/7's own tools);
 * a Manager sees only the shared tab.
 */
export default function UsersTabPage({ showManage, children }: { showManage: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [view, setView] = useState<"users" | "manage">("users");
  const tabCls = (on: boolean) =>
    `px-4 py-2 text-sm font-medium border-b-2 ${
      on
        ? "border-blue-600 text-blue-700 dark:text-blue-300"
        : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
    }`;
  return (
    <div className="space-y-4 p-4">
      {showManage && (
        <div role="tablist" aria-label="Users views" className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
          <button type="button" role="tab" aria-selected={view === "users"} onClick={() => setView("users")} className={tabCls(view === "users")}>
            Users
          </button>
          <button type="button" role="tab" aria-selected={view === "manage"} onClick={() => setView("manage")} className={tabCls(view === "manage")}>
            Manage &amp; logins
          </button>
        </div>
      )}
      {view === "users" || !showManage ? <UsersTab api={sharedApi} onOpenUser={(row) => router.push(`/users/${row.id}/`)} /> : children}
    </div>
  );
}
