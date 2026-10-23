"use client";

import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AppLogo } from "@/components/app-logo";
import { ModeToggle } from "./mode-toggle";
import Sidebar from "./sidebar";
import { AppVersion } from "./app-version";
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
          <header className="tfs-topbar flex h-14 shrink-0 items-center justify-between px-2">
            <div className="flex items-center gap-1 text-lg font-semibold tracking-[-0.03em]">
              <AppLogo size="sm" href="/" linkClassName="tfs-tap inline-flex items-center justify-center" />
              <span>24/7</span>
              {/* Phones have no sidebar: show the version next to the name. */}
              <AppVersion className="self-end pb-0.5 font-normal" />
            </div>
            <ModeToggle className="tfs-tap justify-center" />
          </header>
          <main className="flex-1 overflow-auto px-4 pt-4 pb-24">
            {children}
          </main>
          <MobileBottomNav />
        </div>

        {/* Tablet Layout (768px - 1024px) - Compact Sidebar */}
        <div className="hidden md:flex lg:hidden h-svh bg-background">
          <Sidebar />
          <div className="flex-1 flex flex-col relative">
            <header className="tfs-topbar flex h-14 shrink-0 items-center justify-between px-4">
              <h1 className="text-lg font-semibold tracking-[-0.03em] text-foreground">
                {pathname === "/" && "Dashboard"}
                {pathname === "/dashboard" && "Dashboard"}
                {pathname === "/guide" && "TV Guide"}
                {pathname === "/channels" && "Channels"}
                {pathname === "/library" && "Library"}
                {pathname === "/users" && "Users"}
                {pathname === "/settings" && "Settings"}
                {pathname.startsWith("/channels/") && "Channel Details"}
              </h1>
            </header>
            <main className="flex-1 overflow-auto p-4">
              {children}
            </main>
          </div>
        </div>

        {/* Desktop Layout (> 1024px) - Full Sidebar */}
        <div className="hidden lg:flex h-svh bg-background">
          <Sidebar />
          <div className="flex-1 flex flex-col relative">
            <main className="flex-1 overflow-auto px-6 py-8 lg:px-8">
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