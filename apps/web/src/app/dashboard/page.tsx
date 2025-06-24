"use client"
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, isPending } = authClient.useSession();
  const [isHandlingWatchTowerAuth, setIsHandlingWatchTowerAuth] = useState(false);

  const privateData = useQuery(orpc.privateData.queryOptions());

  useEffect(() => {
    // Check for pending WatchTower authentication
    const watchtowerAuth = searchParams.get('watchtower_auth');
    if (watchtowerAuth === 'pending' && !session && !isHandlingWatchTowerAuth) {
      setIsHandlingWatchTowerAuth(true);
      
      const pendingAuth = localStorage.getItem('watchtower_pending_auth');
      if (pendingAuth) {
        try {
          const authData = JSON.parse(pendingAuth);
          // Check if the auth data is recent (within 5 minutes)
          if (Date.now() - authData.timestamp < 5 * 60 * 1000) {
            // Clear the pending auth
            localStorage.removeItem('watchtower_pending_auth');
            
            // Show a message and refresh to try again
            alert('WatchTower authentication successful! The page will refresh to complete the login.');
            window.location.href = '/dashboard';
            return;
          }
        } catch (e) {
          console.error('Error parsing pending auth:', e);
        }
        localStorage.removeItem('watchtower_pending_auth');
      }
      setIsHandlingWatchTowerAuth(false);
    }
    
    // Normal session check
    if (!session && !isPending && !isHandlingWatchTowerAuth && watchtowerAuth !== 'pending') {
      router.push("/login");
    }
  }, [session, isPending, searchParams, isHandlingWatchTowerAuth]);

  if (isPending || isHandlingWatchTowerAuth) {
    return <div>Loading...</div>;
  }

  // Check for WatchTower pending auth
  const watchtowerAuth = searchParams.get('watchtower_auth');
  if (watchtowerAuth === 'pending') {
    const pendingAuth = localStorage.getItem('watchtower_pending_auth');
    if (pendingAuth) {
      try {
        const authData = JSON.parse(pendingAuth);
        return (
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-4">WatchTower Authentication Successful!</h1>
              <p className="mb-4">Welcome, {authData.user.name}!</p>
              <p className="text-gray-600 mb-4">Your WatchTower account has been linked successfully.</p>
              <button 
                onClick={() => {
                  localStorage.removeItem('watchtower_pending_auth');
                  window.location.href = '/dashboard';
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Continue to Dashboard
              </button>
            </div>
          </div>
        );
      } catch (e) {
        console.error('Error parsing pending auth:', e);
      }
    }
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome {session?.user.name}</p>
      <p>privateData: {privateData.data?.message}</p>
    </div>
  );
}
