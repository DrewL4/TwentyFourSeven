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

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();

  // Core navigation items for mobile (limited to 5 for best UX)
  const navigationLinks = [
    { to: "/", label: "Home", icon: Home },
    { to: "/guide", label: "Guide", icon: Calendar },
    { to: "/channels", label: "Channels", icon: Radio },
    { to: "/library", label: "Library", icon: Library },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  if (!session) return null;

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t pb-safe"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-around px-2 py-2 max-w-screen-sm mx-auto">
        {navigationLinks.map(({ to, label, icon: Icon }) => {
          const isActive = pathname === to || (to !== "/" && pathname.startsWith(to));
          return (
            <Link
              key={to}
              href={to}
              className={`
                flex flex-col items-center justify-center min-h-[56px] min-w-[56px] px-2 py-2 rounded-lg
                transition-all duration-200 text-xs font-medium touch-manipulation
                hover:bg-accent/50 active:bg-accent active:scale-95
                ${isActive 
                  ? "text-primary bg-accent/30 shadow-sm" 
                  : "text-muted-foreground"
                }
              `}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="w-5 h-5 mb-1" />
              <span className="leading-none text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}