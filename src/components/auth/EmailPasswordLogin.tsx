import React, { useState } from 'react';
import { Eye, EyeOff, AlertCircle, ArrowLeft, Chrome, Apple } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { Alert, AlertDescription } from '../ui/alert';
import type { AuthScreen } from './types';
import { useUser } from '../UserContext';

interface EmailPasswordLoginProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function EmailPasswordLogin({ onNavigate }: EmailPasswordLoginProps) {
  const { signInWithEmail, signInWithProvider, error: authError, loading } = useUser();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [errors, setErrors] = useState<{email?: string; password?: string; form?: string}>({});

  const validateForm = () => {
    const newErrors: {email?: string; password?: string} = {};
    
    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    
    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      try {
        await signInWithEmail(email, password);
        onNavigate('auth-success');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to sign in';
        setErrors(prev => ({ ...prev, form: message }));
      }
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <button 
            onClick={() => onNavigate('landing')}
            className="flex items-center text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to landing
          </button>
        </div>

        <Card className="shadow-lg border-0">
          <CardHeader className="text-center">
            <CardTitle>Sign in to your account</CardTitle>
            <CardDescription>
              Enter your credentials to access the BailBonds Dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(errors.form || authError) && (
              <Alert className="mb-6 border-destructive/50 bg-destructive/5">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <AlertDescription className="text-destructive">
                  {errors.form || authError}
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="agent@bailbonds.com"
                  className={errors.email ? 'border-destructive' : ''}
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className={errors.password ? 'border-destructive pr-10' : 'pr-10'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password}</p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="remember" 
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                  />
                  <Label htmlFor="remember" className="text-sm">Remember me</Label>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('forgot-password')}
                  className="text-sm text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              <PillButton type="submit" className="w-full h-12" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </PillButton>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-muted" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <div className="space-y-3">
              <PillButton 
                variant="outline" 
                className="w-full h-12"
                onClick={() => onNavigate('magic-link')}
              >
                Sign in with magic link
              </PillButton>
              
              <div className="grid grid-cols-2 gap-3">
              <PillButton 
                variant="outline" 
                className="h-12"
                onClick={async () => {
                  try {
                    setErrors({});
                    await signInWithProvider('google');
                    onNavigate('auth-success');
                  } catch (err) {
                    const message = err instanceof Error ? err.message : 'Unable to sign in with Google';
                    setErrors((prev) => ({ ...prev, form: message }));
                  }
                }}
                disabled={loading}
              >
                <Chrome className="h-4 w-4 mr-2" />
                Google
              </PillButton>
              <PillButton 
                variant="outline" 
                className="h-12"
                onClick={async () => {
                  try {
                    setErrors({});
                    await signInWithProvider('apple');
                    onNavigate('auth-success');
                  } catch (err) {
                    const message = err instanceof Error ? err.message : 'Unable to sign in with Apple';
                    setErrors((prev) => ({ ...prev, form: message }));
                  }
                }}
                disabled={loading}
              >
                <Apple className="h-4 w-4 mr-2" />
                Apple
              </PillButton>
            </div>
            </div>

            <div className="text-center mt-6 pt-6 border-t border-muted">
              <p className="text-sm text-muted-foreground">
                Don't have an account?{' '}
                <button 
                  onClick={() => onNavigate('login')}
                  className="text-primary hover:underline"
                >
                  Create one here
                </button>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
