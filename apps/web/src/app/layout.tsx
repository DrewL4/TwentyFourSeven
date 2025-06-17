import type { Metadata } from "next";
import "../index.css";
import Providers from "@/components/providers";
import { ModeToggle } from "@/components/mode-toggle";
import Sidebar from "@/components/sidebar";

export const metadata: Metadata = {
  title: "TwentyFour/Seven",
  description: "Live TV from your media library",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          <div className="flex h-svh">
            <Sidebar />
            <div className="flex-1 flex flex-col relative">
              <div className="absolute top-4 right-4 z-50">
                <ModeToggle />
              </div>
              <main className="flex-1 overflow-auto">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
