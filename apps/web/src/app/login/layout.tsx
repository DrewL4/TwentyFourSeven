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
      <div className="absolute right-4 top-4 z-50">
        <ModeToggle showLabel />
      </div>

      {/* ESPG liquid login: no card, content sits on the page gray. */}
      <main className="relative flex min-h-svh flex-col justify-center px-4 py-12">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
