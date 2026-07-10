// O0 Faz 4 (02-o0-foundation.md §3 FAZ 4) — the frontend's SINGLE module-tab
// registration path. GET /api/modules is the choke-point: enabled modules and
// their tab manifests come from the backend, never a static list. Deny-by-default
// (capabilities.ts parity): a fetch error / 403 (SaaS mode) → NO tabs, silently.
import { useEffect, useState } from 'react';
import { api } from './apiClient';
import type { Capability } from './capabilities';

export interface ModuleTabInfo {
  id: string;
  tab?: { labelKey: string; icon: string; requiresCap?: Capability };
}

interface ModulesResponse {
  modules: ModuleTabInfo[];
}

/** Fetch the enabled modules once on mount. Honest-empty on any failure — an
 *  offline/guarded backend yields no module tabs rather than a thrown render. */
export function useModuleTabs(): ModuleTabInfo[] {
  const [modules, setModules] = useState<ModuleTabInfo[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const body = await api.get<ModulesResponse>('/api/modules');
        if (alive && Array.isArray(body?.modules)) setModules(body.modules);
      } catch {
        // Deny-by-default: 403 (SaaS) / network error → no module tabs, no noise.
        if (alive) setModules([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  // Only modules that declare a tab appear in the sidebar (headless modules exist).
  return modules.filter((m) => m.tab);
}
