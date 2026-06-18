import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

// Render an element with RTL. Thin wrapper so future providers (theme/i18n in
// vF5/vF9) are added in one place.
export function renderUI(ui: ReactElement) {
  return render(ui);
}

type RouteMap = Record<string, unknown>;

// Mock global.fetch from a path->body map. Matching is substring on the URL so
// callers pass the meaningful path fragment (e.g. '/api/health'). Unmatched
// routes resolve to empty-ok {} so mount fetches never reject.
export function mockFetch(routes: RouteMap = {}) {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const hit = Object.keys(routes).find((key) => url.includes(key));
    const body = hit ? routes[hit] : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return spy;
}
