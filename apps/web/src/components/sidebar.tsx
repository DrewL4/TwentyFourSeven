"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { 
  Radio, 
  Library, 
  Settings, 
  Calendar, 
  ChevronLeft,
  ChevronRight,
  User,
  LogOut,
  Home,
  Users,
  Eye
} from "lucide-react";
import { AppLogo } from "@/components/app-logo";
import { Button } from "./ui/button";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { Skeleton } from "./ui/skeleton";
import { useAdmin } from "@/hooks/use-admin";
import { isAdminOnlyPath } from "@/lib/admin-routes";
import { AppVersion } from "@/components/app-version";
import { ModeToggle } from "@/components/mode-toggle";

export default function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { isAdmin } = useAdmin();

  const navigationLinks = [
    { to: "/", label: "Home", icon: Home },
    { to: "/guide", label: "TV Guide", icon: Calendar },
    { to: "/channels", label: "Channels", icon: Radio },
    { to: "/library", label: "Library", icon: Library },
    { to: "/users", label: "Users", icon: Users },
    { to: "/viewers", label: "Viewers", icon: Eye },
    { to: "/settings", label: "Settings", icon: Settings },
  ].filter((link) => isAdmin || !isAdminOnlyPath(link.to));

  const handleSignOut = () => {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
  };

  const initial = (session?.user?.name || session?.user?.email || "?").trim().charAt(0).toUpperCase();

  // ESPG sidebar structure: h-12 brand row, p-3 rows with h-6 icons, a footer with
  // the account row, the theme cycle button and Sign out, then the version.
  return (
    <div
      className={`tfs-sidebar flex h-full shrink-0 flex-col gap-y-4 overflow-y-auto px-4 pb-4 transition-[width] duration-300 ease-in-out ${
        isCollapsed ? "w-[72px] px-2" : "w-64"
      }`}
    >
      {/* Brand row */}
      <div className={`flex h-12 shrink-0 items-center pt-4 ${isCollapsed ? "flex-col gap-2 h-auto" : "justify-between gap-2"}`}>
        <Link
          href="/"
          className={`flex min-w-0 items-center gap-x-3 touch-manipulation ${isCollapsed ? "justify-center" : ""}`}
          aria-label={isCollapsed ? "Home" : undefined}
        >
          <AppLogo size="sm" />
          {!isCollapsed && (
            <span className="truncate text-sm font-semibold text-foreground">TwentyFour/Seven</span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-accent hover:text-foreground dark:text-gray-500 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex flex-1 flex-col" role="navigation" aria-label="Main navigation">
        <ul role="list" className="flex flex-col gap-y-1">
          {navigationLinks.map(({ to, label, icon: Icon }) => {
            const isActive = pathname === to || (to !== "/" && pathname.startsWith(to));
            return (
              <li key={to}>
                <Link
                  href={to}
                  className={
                    isCollapsed
                      ? `group flex justify-center rounded-md p-2 text-sm font-medium leading-6 transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isActive ? "text-foreground" : "text-gray-700 hover:bg-accent hover:text-foreground dark:text-gray-300"
                        }`
                      : `group flex items-center gap-x-3 rounded-md p-3 text-sm font-medium leading-6 transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isActive ? "text-foreground" : "text-gray-700 hover:bg-accent hover:text-foreground dark:text-gray-300"
                        }`
                  }
                  title={isCollapsed ? label : undefined}
                  aria-current={isActive ? "page" : undefined}
                >
                  {isCollapsed ? (
                    <span className="flex h-9 w-9 items-center justify-center">
                      <Icon
                        className={`h-6 w-6 shrink-0 ${isActive ? "text-foreground" : "text-gray-400 group-hover:text-foreground dark:text-gray-500"}`}
                        aria-hidden="true"
                      />
                    </span>
                  ) : (
                    <>
                      <Icon
                        className={`h-6 w-6 shrink-0 ${isActive ? "text-foreground" : "text-gray-400 group-hover:text-foreground dark:text-gray-500"}`}
                        aria-hidden="true"
                      />
                      <span>{label}</span>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Account, theme, sign out */}
      <div className="border-t pt-2">
        {isPending ? (
          <div className="flex items-center gap-x-3 p-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            {!isCollapsed && <Skeleton className="h-4 flex-1" />}
          </div>
        ) : session ? (
          <div className="flex flex-col gap-y-1">
            <div
              className={`flex items-center gap-x-3 rounded-md p-2 ${isCollapsed ? "justify-center" : ""}`}
              title={isCollapsed ? session.user.name : undefined}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-500 bg-blue-600 text-sm font-semibold text-white">
                {initial}
              </span>
              {!isCollapsed && (
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={session.user.email}>
                  {session.user.name}
                </p>
              )}
            </div>
            <div className={`flex items-center ${isCollapsed ? "flex-col gap-1" : "justify-between"} px-1`}>
              <ModeToggle showLabel={!isCollapsed} />
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 rounded-md p-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent hover:text-foreground touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={isCollapsed ? "Sign out" : undefined}
                aria-label="Sign out"
              >
                <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
                {!isCollapsed && <span>Sign out</span>}
              </button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="w-full touch-manipulation" asChild>
            <Link href="/login">
              <User className="w-4 h-4 mr-2" />
              {!isCollapsed ? "Sign In" : ""}
            </Link>
          </Button>
        )}
        <AppVersion compact={isCollapsed} className="mt-1" />
      </div>
    </div>
  );
}
