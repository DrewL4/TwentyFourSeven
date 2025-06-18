"use client"

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import FirstTimeSetup from "@/components/first-time-setup";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [showSignIn, setShowSignIn] = useState(true);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null); // null = loading
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkSetupStatus();
  }, []);

  const checkSetupStatus = async () => {
    try {
      const response = await fetch("http://localhost:3000/api/admin/setup-status");
      if (response.ok) {
        const data = await response.json();
        setNeedsSetup(data.needsSetup);
      } else {
        // If API fails, assume setup is not needed
        setNeedsSetup(false);
      }
    } catch (error) {
      console.error("Failed to check setup status:", error);
      // If check fails, assume setup is not needed
      setNeedsSetup(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSetupComplete = () => {
    // After setup is complete, redirect to main app
    router.push("/dashboard");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Checking setup status...</p>
        </div>
      </div>
    );
  }

  // Show first-time setup if database is empty
  if (needsSetup) {
    return <FirstTimeSetup onComplete={handleSetupComplete} />;
  }

  // Show normal login/signup forms
  return (
    <>
      {showSignIn ? (
        <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
      ) : (
        <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
      )}
    </>
  );
}
