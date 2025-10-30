import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";

/**
 * Hook to check if current user is admin
 * Fetches role from custom API endpoint since Better Auth doesn't include it in session
 */
export function useAdmin() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  // Fetch user role when session is available
  useEffect(() => {
    if (!session?.user?.id) {
      setRoleLoading(false);
      return;
    }

    // Fetch role from custom endpoint
    const fetchRole = async () => {
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
      } catch (error) {
        setUserRole(null);
      } finally {
        setRoleLoading(false);
      }
    };

    fetchRole();
  }, [session?.user?.id]);

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

