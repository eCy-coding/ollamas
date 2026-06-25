// Host-bridge security guards (scripts lane, v14) — PURE, no http/fs side effects.
// terminal-bridge.mjs starts an HTTP server at import, so the security logic lives
// here to stay unit-testable. North Star §0-2: secure the host op before iOS/LAN
// exposure (#3). Adopts the in-repo path-confinement pattern (server/files.ts:31,
// server/commander.ts:31): resolve() + startsWith(root + sep).
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Roots /write may target. Legit host authoring = the workspace + bridge scratch +
// the mission-control data dir. Anything else is an escape (RISK: ERR-SCR-001 family).
export function defaultWriteRoots() {
  const env = process.env.BRIDGE_WRITE_ROOTS;
  if (env) return env.split(":").filter(Boolean).map((p) => path.resolve(p));
  return [
    path.resolve(process.env.OLLAMAS_REPO || process.cwd()),
    path.join(os.tmpdir(), "llm-bridge"),
    path.join(os.homedir(), ".llm-mission-control"),
  ].map((p) => path.resolve(p));
}

// Canonicalize via the deepest EXISTING ancestor: realpathSync resolves SYMLINKS that
// path.resolve does NOT, then re-append the not-yet-created tail. Without this, a symlink
// inside an allowed root (<root>/sub -> /etc) passes the prefix check and escapes the
// write confinement (BRIDGE_WRITE_ROOTS bypass).
function realParent(p) {
  const tail = [];
  let cur = p;
  for (let i = 0; i < 64; i++) {
    try { return tail.length ? path.join(fs.realpathSync(cur), ...tail) : fs.realpathSync(cur); }
    catch { /* doesn't exist yet — walk up */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  return p;
}

// Confine a write target to an allowed root. Returns {ok:true,resolved} only when the
// CANONICAL (symlink-resolved) path is inside one of allowedRoots; traversal / absolute
// escape / symlink-escape / outside-scope → {ok:false}.
export function safeWritePath(allowedRoots, target) {
  if (typeof target !== "string" || !target) return { ok: false, error: "empty path" };
  const resolved = path.resolve(target);          // returned as-is (display/compat)
  const canonical = realParent(resolved);          // symlink-resolved — used for the check
  for (const root of allowedRoots) {
    const r = realParent(path.resolve(root));
    if (canonical === r || canonical.startsWith(r + path.sep)) return { ok: true, resolved };
  }
  return { ok: false, error: "path outside allowed roots", resolved };
}

// Payload bound — true while within the cap (false = reject/413).
export function withinLimit(len, max) {
  return Number(len) <= Number(max);
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);

// Fail-closed: a non-loopback bind WITHOUT auth (no token, no HMAC) must refuse to
// start — else BRIDGE_BIND=0.0.0.0 exposes auth-less host-exec on the LAN.
export function bindRequiresAuth(bind, hasAuth) {
  if (hasAuth) return false;
  return !LOOPBACK.has(String(bind || "").trim());
}
