// Host-bridge security guards (scripts lane, v14) — PURE, no http/fs side effects.
// terminal-bridge.mjs starts an HTTP server at import, so the security logic lives
// here to stay unit-testable. North Star §0-2: secure the host op before iOS/LAN
// exposure (#3). Adopts the in-repo path-confinement pattern (server/files.ts:31,
// server/commander.ts:31): resolve() + startsWith(root + sep).
import os from "node:os";
import path from "node:path";

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

// Confine a write target to an allowed root. Returns {ok:true,resolved} only when
// the canonical path is inside one of allowedRoots; traversal / absolute escape /
// outside-scope → {ok:false}. (resolve() collapses ../, so "<root>/../etc" escapes.)
export function safeWritePath(allowedRoots, target) {
  if (typeof target !== "string" || !target) return { ok: false, error: "empty path" };
  const resolved = path.resolve(target);
  for (const root of allowedRoots) {
    const r = path.resolve(root);
    if (resolved === r || resolved.startsWith(r + path.sep)) return { ok: true, resolved };
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
