import { useEffect, useState } from 'react';
import { googleSignIn, logout, auth, clearAccessToken, getAccessToken, isFirebaseConfigured } from '../lib/firebase.ts';
import { User, onAuthStateChanged } from 'firebase/auth';

export function useAuth() {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isReady, setIsReady] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    try {
      const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          // Rehydrate a persisted Drive token (sessionStorage) so a page reload
          // doesn't force re-sign-in. A stale token self-heals via the 401→resetAuth path.
          const stored = await getAccessToken();
          if (stored) {
            setToken(stored);
            setNeedsAuth(false);
          }
        } else {
          setUser(null);
          setToken(null);
          setNeedsAuth(true);
        }
      }, (err) => {
        console.error("onAuthStateChanged error:", err);
      });
      return () => unsubscribe();
    } catch (e: any) {
      console.error("Auth state subscription failed:", e);
    }
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
      } else {
        setAuthError("Failed to authenticate or retrieve access credentials.");
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      let errMsg = err.message || "Login process failed.";
      if (err.code === "auth/popup-blocked") {
        errMsg = "Sign-in popup was blocked by your browser. Please check your browser's pop-up blocker settings and try again.";
      } else if (err.code === "auth/popup-closed-by-user") {
        errMsg = "Sign-in window was closed before completing authentication.";
      } else if (err.code === "auth/unauthorized-domain") {
        errMsg = "This domain isn't authorized for sign-in. Open the app at http://localhost:3000, or add this domain under Firebase Console → Authentication → Settings → Authorized domains.";
      }
      setAuthError(errMsg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Called when a Drive request returns 401 (token expired ~1h). Drop the stale
  // token and surface the sign-in card instead of silently failing.
  const resetAuth = (message?: string) => {
    clearAccessToken();
    setToken(null);
    setNeedsAuth(true);
    if (message) setAuthError(message);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {}
    setNeedsAuth(true);
    setUser(null);
    setToken(null);
    setAuthError(null);
  };

  return { needsAuth, token, user, isLoggingIn, handleLogin, handleLogout, resetAuth, isReady, isConfigured: isFirebaseConfigured, authError };
}
