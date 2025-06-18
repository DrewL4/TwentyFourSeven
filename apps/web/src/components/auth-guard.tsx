"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import Loader from "./loader";

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

  useEffect(() => {
    if (!isPending) {
      // If user is not authenticated and trying to access protected route
      if (!session && !isPublicPath) {
        router.push("/login");
        return;
      }
      
      // If user is authenticated and trying to access login page, redirect to home
      if (session && pathname === "/login") {
        router.push("/");
        return;
      }
    }
  }, [session, isPending, isPublicPath, pathname, router]);

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

  // Show protected content only if authenticated
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