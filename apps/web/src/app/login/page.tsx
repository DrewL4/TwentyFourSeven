"use client"

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield, Users, ArrowLeft } from 'lucide-react';
import { getServerUrl } from '@/utils/server-url';

export default function LoginPage() {
  const [loginMethod, setLoginMethod] = useState<'select' | 'local' | 'watchtower'>('select');
  
  // Local login state
  const [localEmail, setLocalEmail] = useState('');
  const [localPassword, setLocalPassword] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  
  // WatchTower login state
  const [watchTowerUrl, setWatchTowerUrl] = useState('http://127.0.0.1:8000');
  const [apiToken, setApiToken] = useState('');
  const [watchTowerEmail, setWatchTowerEmail] = useState('');
  const [watchTowerPassword, setWatchTowerPassword] = useState('');
  const [watchTowerLoading, setWatchTowerLoading] = useState(false);
  const [watchTowerConfigured, setWatchTowerConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  // Check if WatchTower is already configured
  const checkWatchTowerConfig = async () => {
    try {
      // Use the server URL for API calls
      const serverUrl = getServerUrl();
      const response = await fetch(`${serverUrl}/api/admin/watchtower/status`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setWatchTowerConfigured(data.configured);
        if (data.configured && data.url) {
          setWatchTowerUrl(data.url);
        }
      } else {
        // If we can't check status (not admin), assume not configured
        setWatchTowerConfigured(false);
      }
    } catch (error) {
      console.error('Error checking WatchTower config:', error);
      setWatchTowerConfigured(false);
    }
  };

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalLoading(true);
    setError('');
    
    try {
      // TODO: Implement local login
      console.log('Local login:', { localEmail, localPassword });
      setError('Local login not implemented yet');
    } catch (error) {
      setError('Login failed');
    } finally {
      setLocalLoading(false);
    }
  };

  const handleWatchTowerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setWatchTowerLoading(true);
    setError('');
    
    try {
      console.log('Starting WatchTower login process...');
      
      // Get server URL for API calls
      const serverUrl = getServerUrl();
      
      // Only save configuration if WatchTower is not already configured
      if (!watchTowerConfigured) {
        console.log('Saving WatchTower configuration...');
        const configResponse = await fetch(`${serverUrl}/api/admin/watchtower/save-config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            watchTowerUrl, 
            apiToken 
          })
        });

        if (!configResponse.ok) {
          console.error('Failed to save WatchTower configuration:', await configResponse.text());
          throw new Error('Failed to save WatchTower configuration');
        }
        console.log('WatchTower configuration saved successfully');
      }

      // Attempt to login with WatchTower credentials
      console.log('Attempting WatchTower authentication...');
      const loginResponse = await fetch(`${serverUrl}/api/auth/watchtower`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies for session management
        body: JSON.stringify({
          email: watchTowerEmail,
          password: watchTowerPassword
        })
      });

      console.log('Login response status:', loginResponse.status);
      console.log('Login response ok:', loginResponse.ok);

      if (loginResponse.ok) {
        const data = await loginResponse.json();
        console.log('Login response data:', data);
        
        if (data.success) {
          console.log('Login successful, redirecting to dashboard...');
          
          if (data.requiresRefresh) {
            // Show a message and then refresh
            alert('Login successful! The page will refresh to complete the process.');
            window.location.reload();
          } else {
            // For local development, use full URL to ensure proper redirect
            const dashboardUrl = process.env.NODE_ENV === 'development' 
              ? `${window.location.origin}/dashboard`
              : '/dashboard';
            
            console.log('Redirecting to:', dashboardUrl);
            
            // Use window.location.href for a full page redirect
            window.location.href = dashboardUrl;
          }
        } else {
          console.error('Login response indicates failure:', data);
          setError(data.error || data.message || 'WatchTower login failed');
        }
      } else {
        const errorData = await loginResponse.json().catch(() => ({ error: 'Failed to parse error response' }));
        console.error('Login failed with status:', loginResponse.status, 'Error:', errorData);
        setError(errorData.error || `Login failed (Status: ${loginResponse.status})`);
      }
    } catch (error) {
      console.error('WatchTower login error:', error);
      setError('Failed to connect to WatchTower. Please check your settings.');
    } finally {
      setWatchTowerLoading(false);
    }
  };

  // Login method selection screen
  if (loginMethod === 'select') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md mx-auto space-y-6">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900">Welcome to TwentyFourSeven</h1>
            <p className="text-gray-600 mt-2">Choose how you'd like to sign in</p>
          </div>

          {/* Login Options */}
          <div className="space-y-4">
            {/* Local Login Option */}
            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setLoginMethod('local')}>
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                    <Users className="h-6 w-6 text-gray-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">Local Account</h3>
                    <p className="text-sm text-gray-600">Sign in with your TwentyFourSeven email and password</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* WatchTower Login Option */}
            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={async () => {
              await checkWatchTowerConfig();
              setLoginMethod('watchtower');
            }}>
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Shield className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">WatchTower Account</h3>
                    <p className="text-sm text-gray-600">Sign in using your WatchTower server and credentials</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Footer */}
          <div className="text-center text-sm text-gray-500">
            <p>
              Need help? <a href="/contact" className="text-blue-600 hover:text-blue-800 underline">Contact support</a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Local login form
  if (loginMethod === 'local') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md mx-auto">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLoginMethod('select')}
                className="p-1"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <CardTitle className="flex items-center space-x-2">
                  <Users className="h-6 w-6 text-gray-600" />
                  <span>Local Login</span>
                </CardTitle>
                <CardDescription>
                  Sign in with your TwentyFourSeven account
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLocalLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={localEmail}
                  onChange={(e) => setLocalEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={localPassword}
                  onChange={(e) => setLocalPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                />
              </div>

              {error && (
                <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={localLoading}
                className="w-full"
              >
                {localLoading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // WatchTower login form
  if (loginMethod === 'watchtower') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md mx-auto">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLoginMethod('select')}
                className="p-1"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <CardTitle className="flex items-center space-x-2">
                  <Shield className="h-6 w-6 text-blue-600" />
                  <span>WatchTower Login</span>
                </CardTitle>
                <CardDescription>
                  {watchTowerConfigured === null 
                    ? 'Loading...'
                    : watchTowerConfigured 
                      ? 'Sign in with your WatchTower credentials'
                      : 'Connect to your WatchTower server and sign in'
                  }
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {watchTowerConfigured === null ? (
              <div className="text-center py-4">
                <p className="text-gray-600">Checking WatchTower configuration...</p>
              </div>
            ) : (
              <form onSubmit={handleWatchTowerLogin} className="space-y-4">
                {/* Show setup fields only if not configured */}
                {!watchTowerConfigured && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="watchTowerUrl">WatchTower Server URL</Label>
                      <Input
                        id="watchTowerUrl"
                        type="url"
                        value={watchTowerUrl}
                        onChange={(e) => setWatchTowerUrl(e.target.value)}
                        placeholder="http://127.0.0.1:8000"
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="apiToken">API Token</Label>
                      <Input
                        id="apiToken"
                        type="password"
                        value={apiToken}
                        onChange={(e) => setApiToken(e.target.value)}
                        placeholder="Enter your WatchTower API token"
                        required
                      />
                      <p className="text-xs text-gray-500">
                        Get this from your WatchTower admin panel → Integration Management
                      </p>
                    </div>
                    
                    <div className="border-t pt-4">
                      <p className="text-sm text-gray-600 mb-4">
                        Now enter your WatchTower login credentials:
                      </p>
                    </div>
                  </>
                )}

                {/* Always show login fields */}
                <div className="space-y-2">
                  <Label htmlFor="watchTowerEmail">WatchTower Email</Label>
                  <Input
                    id="watchTowerEmail"
                    type="email"
                    value={watchTowerEmail}
                    onChange={(e) => setWatchTowerEmail(e.target.value)}
                    placeholder="Your WatchTower email"
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="watchTowerPassword">WatchTower Password</Label>
                  <Input
                    id="watchTowerPassword"
                    type="password"
                    value={watchTowerPassword}
                    onChange={(e) => setWatchTowerPassword(e.target.value)}
                    placeholder="Your WatchTower password"
                    required
                  />
                </div>

              {error && (
                <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
                  {error}
                </div>
              )}

                              <Button
                  type="submit"
                  disabled={watchTowerLoading}
                  className="w-full"
                >
                  {watchTowerLoading ? (
                    watchTowerConfigured ? 'Signing in...' : 'Setting up & signing in...'
                  ) : (
                    watchTowerConfigured ? 'Sign In with WatchTower' : 'Setup & Sign In'
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
