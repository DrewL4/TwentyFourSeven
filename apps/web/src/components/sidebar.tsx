"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { 
  Tv, 
  Radio, 
  Library, 
  Settings, 
  Calendar, 
  ChevronLeft,
  ChevronRight,
  User,
  LogOut,
  Home,
  Rocket,
  Users
} from "lucide-react";
import { Button } from "./ui/button";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { Skeleton } from "./ui/skeleton";

export default function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const navigationLinks = [
    { to: "/", label: "Home", icon: Home },
    { to: "/guide", label: "TV Guide", icon: Calendar },
    { to: "/channels", label: "Channels", icon: Radio },
    { to: "/library", label: "Library", icon: Library },
    { to: "/users", label: "Users", icon: Users },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  const handleSignOut = () => {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
  };

  return (
    <div 
      className={`
        flex flex-col h-full bg-background border-r transition-all duration-300 ease-in-out
        ${isCollapsed ? "w-16" : "w-64"}
        lg:${isCollapsed ? "w-16" : "w-64"}
        md:${isCollapsed ? "w-16" : "w-56"}
      `}
    >
      {/* Header with logo and collapse toggle */}
      <div className={`flex items-center p-4 border-b ${isCollapsed ? "flex-col gap-2" : "justify-between"}`}>
        {!isCollapsed ? (
          <>
            <Link href="/" className="flex items-center gap-2 font-bold text-lg">
              <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
                <Rocket className="w-5 h-5 text-white" />
              </div>
              <span className="hidden lg:inline">TwentyFour/Seven</span>
              <span className="lg:hidden">24/7</span>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-2 shrink-0 hover:bg-accent touch-manipulation"
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </>
        ) : (
          <>
            <Link 
              href="/" 
              className="flex items-center justify-center touch-manipulation"
              aria-label="Home"
            >
              <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
                <Rocket className="w-5 h-5 text-white" />
              </div>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-2 hover:bg-accent touch-manipulation"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-2" role="navigation" aria-label="Main navigation">
        <ul className="space-y-1">
          {navigationLinks.map(({ to, label, icon: Icon }) => {
            const isActive = pathname === to || (to !== "/" && pathname.startsWith(to));
            return (
              <li key={to}>
                <Link
                  href={to}
                  className={`
                    flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors
                    hover:bg-accent hover:text-accent-foreground touch-manipulation
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                    ${isActive 
                      ? "bg-accent text-accent-foreground" 
                      : "text-muted-foreground"
                    }
                    ${isCollapsed ? "justify-center" : ""}
                  `}
                  title={isCollapsed ? label : undefined}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  {!isCollapsed && <span>{label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User Info and Sign Out */}
      <div className="p-2 border-t">
        {isPending ? (
          <div className="flex items-center gap-3 p-3">
            <Skeleton className="w-8 h-8 rounded-full" />
            {!isCollapsed && <Skeleton className="h-4 flex-1" />}
          </div>
        ) : session ? (
          <div className={`space-y-2 ${isCollapsed ? "flex flex-col items-center" : ""}`}>
            {/* User Info */}
            <div className={`flex items-center gap-3 p-2 rounded-md bg-accent/50 ${isCollapsed ? "justify-center" : ""}`}>
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-primary-foreground" />
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{session.user.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
                </div>
              )}
            </div>
            
            {/* Sign Out Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className={`w-full justify-start text-muted-foreground hover:text-foreground hover:bg-accent touch-manipulation ${
                isCollapsed ? "px-2" : ""
              }`}
              title={isCollapsed ? "Sign Out" : undefined}
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {!isCollapsed && <span className="ml-2">Sign Out</span>}
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="w-full touch-manipulation" asChild>
            <Link href="/login">
              <User className="w-4 h-4 mr-2" />
              {!isCollapsed ? "Sign In" : ""}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
} 