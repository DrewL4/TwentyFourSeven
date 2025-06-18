"use client";

import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { ModeToggle } from "./mode-toggle";
import Sidebar from "./sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  
  // Don't show app layout for login page
  if (pathname.startsWith("/login")) {
    return <>{children}</>;
  }

  // Show app layout with sidebar for authenticated users
  if (session) {
    return (
      <div className="flex h-svh">
        <Sidebar />
        <div className="flex-1 flex flex-col relative">
          <div className="absolute top-4 right-4 z-50">
            <ModeToggle />
          </div>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    );
  }

  // Fallback for edge cases - shouldn't normally be reached due to AuthGuard
  return <>{children}</>;
} 