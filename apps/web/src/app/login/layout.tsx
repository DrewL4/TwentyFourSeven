import type { Metadata } from "next";
import { ModeToggle } from "@/components/mode-toggle";

export const metadata: Metadata = {
  title: "Sign in - TwentyFour/Seven",
  description: "Sign in with your WatchTower account",
};

export default function LoginLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(251,146,60,0.18),transparent)] dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(251,146,60,0.12),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-orange-500/10 blur-3xl dark:bg-orange-500/5"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl dark:bg-amber-500/5"
      />

      <div className="absolute right-4 top-4 z-50">
        <ModeToggle />
      </div>

      <main className="relative flex min-h-svh items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
