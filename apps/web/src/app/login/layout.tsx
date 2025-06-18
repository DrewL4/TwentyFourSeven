import type { Metadata } from "next";
import { ModeToggle } from "@/components/mode-toggle";

export const metadata: Metadata = {
  title: "Login - TwentyFour/Seven",
  description: "Sign in to your TwentyFour/Seven account",
};

export default function LoginLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="absolute top-4 right-4 z-50">
        <ModeToggle />
      </div>
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="w-full max-w-md">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8">
            <div className="flex items-center justify-center mb-8">
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
                <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-8">
              TwentyFour/Seven
            </h1>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
} 