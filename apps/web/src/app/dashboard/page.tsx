"use client"
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function Dashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, isPending } = authClient.useSession();

  // Debug logs removed for production cleanliness

  const privateData = useQuery(orpc.privateData.queryOptions());

  useEffect(() => {
    // Redirect unauthenticated users to login
    if (!session && !isPending) {
      router.push("/login");
    }
  }, [session, isPending, router]);

  if (isPending) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome {session?.user.name}</p>
      <p>privateData: {privateData.data?.message}</p>
    </div>
  );
}
