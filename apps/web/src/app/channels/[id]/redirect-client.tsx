"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ChannelRedirectClient() {
  const params = useParams();
  const router = useRouter();
  const channelId = params.id as string;

  useEffect(() => {
    router.replace(`/channels?channelId=${channelId}`);
  }, [router, channelId]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-lg">Loading channel configuration...</div>
    </div>
  );
}
