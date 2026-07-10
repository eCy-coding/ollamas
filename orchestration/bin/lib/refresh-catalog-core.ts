// orchestration/bin/lib/refresh-catalog-core.ts — pure output contract for refresh-catalog.ts (IO-free).
//
// refresh-catalog.ts spawns gen-catalog → build-tasks (IO) then reports the fresh TASKS.json count. The
// human/JSON result formatting is a pure transform over the outcome — extracted here so the tool's stdout
// contract is asserted without spawning subprocesses.

export interface RefreshResult { ok: boolean; count?: number; error?: string; }

/** Format the refresh outcome. `json` → machine line ({ok,count} | {ok:false,error}); else human line. */
export function formatRefresh(res: RefreshResult, json: boolean): string {
  if (json) return JSON.stringify(res.ok ? { ok: true, count: res.count } : { ok: false, error: res.error });
  return res.ok
    ? `[refresh-catalog] TASKS.json = ${res.count} tasks (fresh)`
    : `[refresh-catalog] hata: ${res.error}`;
}
