import type { Metadata } from "next";
import "../index.css";
import Providers from "@/components/providers";
import AuthGuard from "@/components/auth-guard";
import AppLayout from "@/components/app-layout";

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
          <AuthGuard>
            <AppLayout>
              {children}
            </AppLayout>
          </AuthGuard>
        </Providers>
      </body>
    </html>
  );
}
