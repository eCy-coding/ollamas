import { useEffect, useState } from 'react';

// vF15 — browser network status (navigator.onLine + online/offline events).
// Pairs with the Workbox GET-API cache: when offline, cached responses still
// resolve, and this drives the "Offline" badge so the user knows data is stale.
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
