'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, Shield, ArrowLeft } from 'lucide-react';
import { getServerUrl } from '@/utils/server-url';

interface WatchTowerLoginFormProps {
  onBack?: () => void;
  onSuccess?: () => void;
  showBackButton?: boolean;
}

const WatchTowerLoginForm: React.FC<WatchTowerLoginFormProps> = ({ 
  onBack, 
  onSuccess,
  showBackButton = true 
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const serverUrl = getServerUrl();
      const response = await fetch(`${serverUrl}/api/auth/watchtower`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Store session token
      if (data.sessionToken) {
        document.cookie = `session-token=${data.sessionToken}; path=/; max-age=${30 * 24 * 60 * 60}`;
      }

      // Success callback or redirect
      if (onSuccess) {
        onSuccess();
      } else {
        router.push('/dashboard');
        router.refresh();
      }

    } catch (error) {
      setError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Shield className="h-6 w-6 text-blue-600" />
            <CardTitle>WatchTower Login</CardTitle>
          </div>
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            SSO
          </Badge>
        </div>
        <CardDescription>
          Sign in with your WatchTower account credentials to access TwentyFourSeven
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email Field */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your WatchTower email"
              required
              disabled={isLoading}
            />
          </div>

          {/* Password Field */}
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your WatchTower password"
                required
                disabled={isLoading}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-2 top-1/2 transform -translate-y-1/2"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Login Button */}
          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !email || !password}
          >
            {isLoading ? 'Signing in...' : 'Sign in with WatchTower'}
          </Button>

          {/* Back Button */}
          {showBackButton && onBack && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={onBack}
              disabled={isLoading}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Login Options
            </Button>
          )}
        </form>

        {/* Help Text */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Don't have a WatchTower account?{' '}
            <a 
              href="/contact" 
              className="text-blue-600 hover:text-blue-800 underline"
            >
              Contact administrator
            </a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default WatchTowerLoginForm; 