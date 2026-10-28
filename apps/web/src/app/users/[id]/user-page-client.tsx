"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import UserPage from "@/components/users/user-page";
import { useAdmin } from "@/hooks/use-admin";

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

const json = { "Content-Type": "application/json" };

// 24/7 asks its own server, which asks WatchTower (signed) on this person's behalf.
const pageApi = {
  page: async (id: string) => readJson(await fetch(`/api/users-tab/${id}`, { credentials: "include", cache: "no-store" })),
  // Save answers 200, 207, 403 or 422 with a body that says what happened to each section: never throw on those.
  save: async (id: string, changes: unknown) => {
    const response = await fetch(`/api/users-tab/${id}/save`, {
      method: "POST",
      credentials: "include",
      headers: json,
      body: JSON.stringify({ changes }),
    });
    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (![200, 207, 403, 422].includes(response.status)) {
      const error: any = new Error(data?.error || `The request failed (HTTP ${response.status}).`);
      error.response = { data };
      throw error;
    }
    return { status: response.status, data };
  },
  action: async (body: unknown) =>
    readJson(await fetch("/api/users-tab/action", { method: "POST", credentials: "include", headers: json, body: JSON.stringify(body) })),
  removePlaylist: async (userId: string, playlistId: number) =>
    readJson(
      await fetch("/api/users-tab/action", {
        method: "POST",
        credentials: "include",
        headers: json,
        body: JSON.stringify({ action: "remove_playlist", user_id: Number(userId), playlist_id: playlistId }),
      }),
    ),
};

export default function UserPageClient() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { isLoading } = useAdmin();
  const id = pathname.split("/").filter(Boolean)[1] || "";
  if (isLoading) return null;
  if (!/^\d+$/.test(id)) {
    return <p className="p-6 text-sm text-gray-700 dark:text-gray-300">Choose a person from the Users list.</p>;
  }
  return (
    <div className="mx-auto max-w-5xl p-4">
      <UserPage api={pageApi} userId={id} onBack={() => router.push("/users/")} />
    </div>
  );
}
