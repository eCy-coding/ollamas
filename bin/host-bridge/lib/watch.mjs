// @ts-check
// Watch dev-loop core (scripts lane, v13) — PURE helpers, no fs/timers bound here.
// gate.mjs --watch uses these to drive an autonomous "save → gate re-runs" loop
// with zero external deps (no chokidar). The pure parts are unit-tested; the
// fs.watch wiring is a thin shell in gate.mjs.
//
// Adopts the yuanchuan/node-watch (MIT) debounce + ignore pattern, reimplemented
// zero-dep on node:fs.watch {recursive:true} (works on macOS, our target).

// Paths the loop must ignore — build output, VCS, deps, caches. Matching any
// segment means "don't rebuild" (avoids a self-trigger storm: the gate writes
// .build/coverage, which must NOT re-arm the watcher → RISK-SCR-017).
export const IGNORE = ["node_modules", ".git", "dist", ".build", "coverage", ".swiftpm", ".DS_Store"];

export function isWatchable(path) {
  if (!path) return false;
  const segs = String(path).split("/");
  if (segs.some((s) => IGNORE.includes(s))) return false;
  // only source-ish files matter; ignore editor temp/swap
  return !/(~|\.swp|\.tmp)$/.test(path);
}

// Trailing-edge debounce: collapse a burst of change events into ONE call after
// `ms` of quiet. `setTimer`/`clearTimer` injectable for deterministic tests.
export function debounce(fn, ms = 300, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let t = null;
  const debounced = (...args) => {
    if (t) clearTimer(t);
    t = setTimer(() => { t = null; fn(...args); }, ms);
  };
  debounced.cancel = () => { if (t) { clearTimer(t); t = null; } };
  return debounced;
}
