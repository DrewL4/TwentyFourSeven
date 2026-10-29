"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import UsersTabSource from "./users-tab";

import { PillTabs } from "./ui";
// The shared source is plain JS; give it loose props so the wrapper can pass its own.
const UsersTab = UsersTabSource as unknown as React.ComponentType<any>;


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
const sharedApi = {
  directory: async () => readJson(await fetch("/api/users-tab", { credentials: "include", cache: "no-store" })),
  action: async (body: unknown) =>
    readJson(
      await fetch("/api/users-tab/action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
};

function Spinner() {
  return (
    <div className="flex justify-center py-12" role="status" aria-label="Loading users">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  );
}

/**
 * The same Users tab as WatchTower and ESPG. Admins also get "Manage & logins" (24/7's own tools);
 * a Manager sees only the shared tab.
 */
export default function UsersTabPage({ showManage, children }: { showManage: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [view, setView] = useState<"users" | "manage">("users");
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4">
      {showManage && (
        <PillTabs
          label="Users views"
          className="w-fit max-w-full"
          items={[
            { id: "users", label: "Users" },
            { id: "manage", label: "Manage & logins" },
          ]}
          value={view}
          onChange={(id: string) => setView(id as "users" | "manage")}
        />
      )}
      {view === "users" || !showManage ? (
        <UsersTab api={sharedApi} Spinner={Spinner} onOpenUser={(row: { id: number | string }) => router.push(`/users/${row.id}/`)} />
      ) : (
        children
      )}
    </div>
  );
}
