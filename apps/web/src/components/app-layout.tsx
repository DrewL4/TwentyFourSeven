"use client";

import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { ModeToggle } from "./mode-toggle";
import { Rocket } from "lucide-react";
import Sidebar from "./sidebar";
import MobileBottomNav from "./mobile-bottom-nav";

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

  // Show app layout with responsive navigation for authenticated users
  if (session) {
    return (
      <>
        {/* Mobile Layout (< 768px) - Bottom Navigation */}
        <div className="md:hidden flex flex-col h-svh">
          <header className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-2 font-bold text-lg">
              <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
                <Rocket className="w-5 h-5 text-white" />
              </div>
              <span>24/7</span>
            </div>
            <ModeToggle />
          </header>
          <main className="flex-1 overflow-auto pb-16 px-4 py-4">
            {children}
          </main>
          <MobileBottomNav />
        </div>

        {/* Tablet Layout (768px - 1024px) - Compact Sidebar */}
        <div className="hidden md:flex lg:hidden h-svh">
          <Sidebar />
          <div className="flex-1 flex flex-col relative">
            <header className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <h1 className="text-lg font-semibold text-foreground">
                {pathname === "/" && "Dashboard"}
                {pathname === "/guide" && "TV Guide"}
                {pathname === "/channels" && "Channels"}
                {pathname === "/library" && "Library"}
                {pathname === "/users" && "Users"}
                {pathname === "/settings" && "Settings"}
                {pathname.startsWith("/channels/") && "Channel Details"}
              </h1>
              <ModeToggle />
            </header>
            <main className="flex-1 overflow-auto p-4">
              {children}
            </main>
          </div>
        </div>

        {/* Desktop Layout (> 1024px) - Full Sidebar */}
        <div className="hidden lg:flex h-svh">
          <Sidebar />
          <div className="flex-1 flex flex-col relative">
            <div className="absolute top-4 right-4 z-50">
              <ModeToggle />
            </div>
            <main className="flex-1 overflow-auto p-6">
              {children}
            </main>
          </div>
        </div>
      </>
    );
  }

  // Fallback for edge cases - shouldn't normally be reached due to AuthGuard
  return <>{children}</>;
} 