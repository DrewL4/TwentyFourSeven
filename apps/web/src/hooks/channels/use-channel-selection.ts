import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Sync selected channel id with `?channelId=` in the URL */
export function useChannelSelectionUrl() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const channelIdFromUrl = searchParams.get("channelId");

  const updateChannelInUrl = useCallback(
    (channelId: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("channelId", channelId);
      router.replace(`/channels?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return { channelIdFromUrl, updateChannelInUrl };
}
