// vF3 — Core Web Vitals field telemetry (adopted from GoogleChrome/web-vitals,
// Apache-2.0). Measures the REAL device (MacBook + iOS Safari), not a guess,
// and ships each metric to the seyir defteri via the ApiClient choke-point.
import { logClientEvent } from './apiClient';

// Lazy import keeps web-vitals out of the critical bundle until after load.
export async function reportWebVitals(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const { onCLS, onINP, onLCP, onFCP, onTTFB } = await import('web-vitals');
    const send = (name: string) => (m: { value: number; rating: string; id: string }) =>
      logClientEvent(`web-vital ${name}`, {
        metric: name,
        value: Math.round(m.value * 1000) / 1000,
        rating: m.rating,
        id: m.id,
        ua: navigator.userAgent,
      });
    onLCP(send('LCP'));
    onINP(send('INP'));
    onCLS(send('CLS'));
    onFCP(send('FCP'));
    onTTFB(send('TTFB'));
  } catch {
    /* web-vitals optional — never block boot */
  }
}
