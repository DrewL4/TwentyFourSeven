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

  // One layout for every screen size, so each page is rendered once (it used to be
  // rendered three times, once per breakpoint, with two copies hidden by CSS).
  if (session) {
    return (
      <div className="flex h-svh md:bg-background">
        {/* Tablet and desktop (768px and up): sidebar */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>
        <div className="flex-1 min-w-0 flex flex-col relative">
          {/* Phones (< 768px): top bar with the version; navigation is at the bottom */}
          <header className="md:hidden tfs-topbar flex h-14 shrink-0 items-center justify-between px-2">
            <div className="flex items-center gap-1 text-lg font-semibold tracking-[-0.03em]">
              <AppLogo size="sm" href="/" linkClassName="tfs-tap inline-flex items-center justify-center" />
              <span>24/7</span>
              {/* Phones have no sidebar: show the version next to the name. */}
              <AppVersion className="self-end pb-0.5 font-normal" />
            </div>
            <ModeToggle className="tfs-tap justify-center" />
          </header>
          {/* Tablets (768px - 1024px): title bar */}
          <header className="hidden md:flex lg:hidden tfs-topbar h-14 shrink-0 items-center justify-between px-4">
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
          <main className="flex-1 overflow-auto px-4 pt-4 pb-24 md:p-4 lg:px-8 lg:py-8">
            {children}
          </main>
          <div className="md:hidden">
            <MobileBottomNav />
          </div>
        </div>
      </div>
    );
  }

  // Fallback for edge cases - shouldn't normally be reached due to AuthGuard
  return <>{children}</>;
} 