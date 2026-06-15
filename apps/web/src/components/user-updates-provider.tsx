"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useSocketContext } from "@/contexts/socket-context";
import { orpc } from "@/utils/orpc";
import { TFS_USER_UPDATES_EVENT } from "@/constants/userRealtime";

export default function UserUpdatesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { socket } = useSocketContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (!socket) return;

    const invalidateUserQueries = (detail?: { email?: string; action?: string }) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.viewers.getUsers.queryOptions().queryKey,
      });
      window.dispatchEvent(
        new CustomEvent(TFS_USER_UPDATES_EVENT, { detail: detail || {} }),
      );
    };

    const handleSelfSessionCheck = async (email: string) => {
      const sessionEmail = session?.user?.email?.toLowerCase();
      if (!sessionEmail || email.toLowerCase() !== sessionEmail) {
        return;
      }
      try {
        const response = await fetch("/api/user/session", { credentials: "include" });
        if (!response.ok) {
          await authClient.signOut();
          router.replace("/login");
          return;
        }
        const data = await response.json();
        if (data?.user?.isActive === false) {
          await authClient.signOut();
          router.replace("/login");
        }
      } catch {
        // Ignore transient network errors
      }
    };

    const handleUserUpdate = (data: { email: string; action: string }) => {
      invalidateUserQueries({ email: data.email, action: data.action });
      void handleSelfSessionCheck(data.email);
    };

    const handleUsersRefresh = () => {
      invalidateUserQueries();
    };

    socket.on("user:update", handleUserUpdate);
    socket.on("users:refresh", handleUsersRefresh);

    return () => {
      socket.off("user:update", handleUserUpdate);
      socket.off("users:refresh", handleUsersRefresh);
    };
  }, [socket, queryClient, router, session?.user?.email]);

  return <>{children}</>;
}
