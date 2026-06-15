import { authClient } from "@/lib/auth-client";
import { useEffect, useState, useCallback } from "react";
import { TFS_USER_UPDATES_EVENT } from "@/constants/userRealtime";

/**
 * Hook to check if current user is admin
 * Fetches role from custom API endpoint since Better Auth doesn't include it in session
 */
export function useAdmin() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  const fetchRole = useCallback(async () => {
    if (!session?.user?.id) {
      setRoleLoading(false);
      return;
    }
    try {
      const response = await fetch('/api/user/session', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        const role = data?.user?.role || null;
        setUserRole(role);
      } else {
        setUserRole(null);
      }
    } catch {
      setUserRole(null);
    } finally {
      setRoleLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void fetchRole();
  }, [fetchRole]);

  useEffect(() => {
    const handler = () => {
      void fetchRole();
    };
    window.addEventListener(TFS_USER_UPDATES_EVENT, handler);
    return () => window.removeEventListener(TFS_USER_UPDATES_EVENT, handler);
  }, [fetchRole]);

  const isAdmin = userRole === 'ADMIN';

  return {
    isAdmin,
    isLoading: sessionPending || roleLoading,
    session: session ? {
      ...session,
      user: {
        ...session.user,
        role: userRole || 'USER'
      }
    } : null,
  };
}

