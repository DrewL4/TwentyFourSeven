"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Home,
  Calendar, 
  Radio, 
  Library, 
  Settings,
  User
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useAdmin } from "@/hooks/use-admin";
import { isAdminOnlyPath } from "@/lib/admin-routes";

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const { isAdmin } = useAdmin();

  // Core navigation items for mobile (limited to 5 for best UX)
  const navigationLinks = [
    { to: "/", label: "Home", icon: Home },
    { to: "/guide", label: "Guide", icon: Calendar },
    { to: "/channels", label: "Channels", icon: Radio },
    { to: "/library", label: "Library", icon: Library },
    { to: "/settings", label: "Settings", icon: Settings },
  ].filter((link) => isAdmin || !isAdminOnlyPath(link.to));

  if (!session) return null;

  return (
    <nav 
      className="tfs-tabbar fixed bottom-0 left-0 right-0 z-50 pb-safe"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="flex h-16 items-center justify-around px-2 max-w-screen-sm mx-auto">
        {navigationLinks.map(({ to, label, icon: Icon }) => {
          const isActive = pathname === to || (to !== "/" && pathname.startsWith(to));
          return (
            <Link
              key={to}
              href={to}
              className={`
                flex flex-col items-center justify-center gap-1 min-h-[56px] min-w-[56px] px-2 py-1.5 rounded-xl
                transition-colors duration-200 touch-manipulation active:scale-95
                ${isActive
                  ? "text-accent-text"
                  : "text-muted-foreground hover:text-foreground"
                }
              `}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="leading-none text-[0.65rem] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}