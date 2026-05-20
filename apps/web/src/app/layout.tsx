import type { Metadata } from "next";
import "../index.css";
import Providers from "@/components/providers";
import AuthGuard from "@/components/auth-guard";
import AppLayout from "@/components/app-layout";
import { APP_LOGO_SRC } from "@/components/app-logo";

export const metadata: Metadata = {
  title: "TwentyFour/Seven",
  description: "Live TV from your media library",
  icons: {
    icon: APP_LOGO_SRC,
    apple: APP_LOGO_SRC,
  },
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
