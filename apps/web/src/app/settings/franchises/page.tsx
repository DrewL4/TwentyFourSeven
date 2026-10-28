"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { FRANCHISES_PATH } from "@/lib/nav-links";

// Franchises moved to their own page that every signed-in user can open.
// This address stays so old bookmarks keep working.
export default function LegacyFranchisesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(FRANCHISES_PATH);
  }, [router]);
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}
