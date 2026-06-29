import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  signInWithPopup,
  GoogleAuthProvider,
  User,
  onAuthStateChanged
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Surfaces a clear "configure Firebase" state instead of an opaque throw when
// the applet config is a placeholder (missing the fields auth actually needs).
export const isFirebaseConfigured = Boolean(
  (firebaseConfig as { apiKey?: string }).apiKey &&
  (firebaseConfig as { authDomain?: string }).authDomain
);

const app = initializeApp(firebaseConfig);

// Safe auth boot supporting sandboxed iframes.
// initializeAuth() — unlike getAuth() — does NOT register a default popup/redirect
// resolver, so signInWithPopup() would throw auth/argument-error. Register it here.
let auth: any;
try {
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
    popupRedirectResolver: browserPopupRedirectResolver
  });
} catch (e) {
  auth = getAuth(app);
}

export { auth };

const provider = new GoogleAuthProvider();
// Request Workspace scopes
provider.addScope('https://www.googleapis.com/auth/drive');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    // Pass the resolver explicitly too — works regardless of which boot path
    // (initializeAuth vs the getAuth fallback) produced `auth`.
    const result = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

// Drop the cached Google access token (e.g. after a 401) so the next sign-in
// re-issues a fresh one. Lighter than logout(): keeps the Firebase session.
export const clearAccessToken = (): void => {
  cachedAccessToken = null;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
