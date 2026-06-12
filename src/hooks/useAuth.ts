import { useEffect, useState } from 'react';
import { googleSignIn, initAuth, logout } from '../lib/firebase.ts';
import { User } from 'firebase/auth';

export function useAuth() {
  const [needsAuth, setNeedsAuth] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setNeedsAuth(false);
        setUser(user);
        setToken(token);
        setIsReady(true);
      },
      () => {
        setNeedsAuth(true);
        setUser(null);
        setToken(null);
        setIsReady(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err) {
      console.error('Login failed:', err);
      // Wait for user to decide what to do
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setNeedsAuth(true);
    setUser(null);
    setToken(null);
  }

  return { needsAuth, token, user, isLoggingIn, handleLogin, handleLogout, isReady };
}
