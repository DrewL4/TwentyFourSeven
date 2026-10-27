"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import Loader from "./loader";
import { useAdmin } from "@/hooks/use-admin";
import { canOpenPath, isStaffPath } from "@/lib/admin-routes";

interface AuthGuardProps {
  children: React.ReactNode;
}

// Pages that don't require authentication
const publicPaths = ["/login"];

export default function AuthGuard({ children }: AuthGuardProps) {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  const pathname = usePathname();

  const isPublicPath = publicPaths.some(path => pathname.startsWith(path));
  const { isAdmin, isManager, isLoading: roleLoading } = useAdmin();
  const role = isAdmin ? "ADMIN" : isManager ? "MANAGER" : "USER";
  const adminOnly = isStaffPath(pathname);
  const allowed = canOpenPath(role, pathname);
  const blockedForRole = !!session && adminOnly && !roleLoading && !allowed;

  useEffect(() => {
    if (!isPending) {
      // If user is not authenticated and trying to access protected route
      if (!session && !isPublicPath) {
        router.push("/login");
        return;
      }
      
      // If user is authenticated and trying to access login page, redirect to home
      if (session && pathname === "/login") {
        router.replace("/");
        return;
      }

      // Viewers can't open staff pages, and Managers can't open Admin-only pages
      if (blockedForRole) {
        router.replace("/");
        return;
      }
    }
  }, [session, isPending, isPublicPath, pathname, router, blockedForRole]);

  // Show loading while checking auth status
  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader />
      </div>
    );
  }

  // Show login page content if it's a public path
  if (isPublicPath) {
    return <>{children}</>;
  }

  // Show protected content only if authenticated (and, for admin pages, admin)
  if (session && adminOnly && (roleLoading || !allowed)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader />
      </div>
    );
  }
  if (session) {
    return <>{children}</>;
  }

  // This shouldn't happen due to the useEffect redirect, but just in case
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader />
    </div>
  );
} 