import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import {
  signInWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
  User as FirebaseUser,
} from 'firebase/auth';
import { firebaseAuthClient } from '../lib/firebaseClient';
import type { UserProfile } from './ui/user-avatar';

type AuthenticatedUser = UserProfile & {
  uid: string;
  roles: string[];
  departments: string[];
  status: string;
  mfaEnforced?: boolean;
};

interface UserContextType {
  currentUser: AuthenticatedUser | null;
  loading: boolean;
  error: string | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithProvider: (provider: 'google' | 'apple') => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  users: AuthenticatedUser[];
}

const UserContext = createContext<UserContextType | undefined>(undefined);

async function exchangeSession(idToken: string) {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Failed to establish session');
  }
}

async function fetchProfile(): Promise<AuthenticatedUser | null> {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Profile request failed');
  }

  const payload = await response.json();
  return mapProfile(payload?.user);
}

function mapProfile(user: any): AuthenticatedUser | null {
  if (!user) return null;
  const name = user.displayName || user.name || user.email || user.uid;
  const email = user.email || '';
  const primaryRole = Array.isArray(user.roles) && user.roles.length ? user.roles[0] : 'BondClient';
  const initials = typeof name === 'string'
    ? name
        .split(' ')
        .map((part: string) => part.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'BB';

  return {
    uid: user.uid,
    id: user.uid,
    name,
    email,
    role: primaryRole,
    initials,
    avatarIcon: user.avatarIcon || 'user',
    avatarColor: user.avatarColor || 'blue',
    roles: Array.isArray(user.roles) ? user.roles : [primaryRole],
    departments: Array.isArray(user.departments) ? user.departments : [],
    status: user.status || 'active',
    mfaEnforced: Boolean(user.mfaEnforced),
    displayName: user.displayName || name,
    profileImage: user.profileImage || undefined,
  };
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const handleFirebaseUser = useCallback(async (fbUser: FirebaseUser | null) => {
    if (!fbUser) {
      setCurrentUser(null);
      setLoading(false);
      return;
    }

    try {
      const idToken = await fbUser.getIdToken(true);
      await exchangeSession(idToken);
      const profile = await fetchProfile();
      setCurrentUser(profile);
      setError(null);
    } catch (err) {
      console.error('Failed to sync Firebase session:', err);
      setError(err instanceof Error ? err.message : String(err));
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuthClient, (fbUser) => {
      setLoading(true);
      handleFirebaseUser(fbUser);
    });
    return () => unsubscribe();
  }, [handleFirebaseUser]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const credential = await signInWithEmailAndPassword(firebaseAuthClient, email, password);
      const idToken = await credential.user.getIdToken(true);
      await exchangeSession(idToken);
      const profile = await fetchProfile();
      setCurrentUser(profile);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign in';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signInWithProvider = useCallback(async (provider: 'google' | 'apple') => {
    setLoading(true);
    setError(null);
    try {
      const providerInstance = provider === 'google'
        ? new GoogleAuthProvider()
        : new OAuthProvider('apple.com');

      if (provider === 'apple') {
        providerInstance.addScope?.('email');
        providerInstance.addScope?.('name');
      }

      const credential = await signInWithPopup(firebaseAuthClient, providerInstance);
      const idToken = await credential.user.getIdToken(true);
      await exchangeSession(idToken);
      const profile = await fetchProfile();
      setCurrentUser(profile);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign in with provider';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      await firebaseSignOut(firebaseAuthClient);
      setCurrentUser(null);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const profile = await fetchProfile();
      setCurrentUser(profile);
    } catch (err) {
      console.error('Failed to refresh profile:', err);
    }
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      const actionCodeSettings = {
        url: `${window.location.origin}/auth/login`,
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(firebaseAuthClient, email, actionCodeSettings);
      window.localStorage.setItem('asapAuthEmail', email);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send magic link';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSignInWithEmailLink(firebaseAuthClient, window.location.href)) {
      const storedEmail = window.localStorage.getItem('asapAuthEmail') || window.prompt('Confirm your email');
      if (storedEmail) {
        signInWithEmailLink(firebaseAuthClient, storedEmail, window.location.href)
          .then(async (credential) => {
            const idToken = await credential.user.getIdToken(true);
            await exchangeSession(idToken);
            const profile = await fetchProfile();
            setCurrentUser(profile);
            window.localStorage.removeItem('asapAuthEmail');
          })
          .catch((err) => {
            console.error('Magic link sign-in failed:', err);
            setError(err instanceof Error ? err.message : String(err));
          });
      }
    }
  }, []);

  const value = useMemo<UserContextType>(() => ({
    currentUser,
    loading,
    error,
    signInWithEmail,
    signInWithProvider,
    sendMagicLink,
    signOut,
    refreshProfile,
    users: currentUser ? [currentUser] : [],
  }), [currentUser, loading, error, signInWithEmail, signInWithProvider, sendMagicLink, signOut, refreshProfile]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

export type { AuthenticatedUser };
