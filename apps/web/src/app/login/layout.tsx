import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in - TwentyFour/Seven",
  description: "Sign in with your WatchTower account",
};

/** Same frame as the ESPG sign-in page: no card, no theme button, content centered on the page gray. */
export default function LoginLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="tfs-login flex min-h-dvh flex-col justify-center px-4 py-12 text-[#111827] dark:text-[#f3f4f6]">
      <div className="mx-auto w-full max-w-md space-y-8">{children}</div>
    </div>
  );
}
