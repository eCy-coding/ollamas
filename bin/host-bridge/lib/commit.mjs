// Auto-commit guard core (scripts lane, v12) — PURE, no git/fs. Decides whether a
// green-gate auto-commit is SAFE: only scope-owned files get staged, cross-lane
// tracked changes BLOCK (ERR-SCR-001 contamination), and the message must be a
// Conventional Commit. The gate.mjs CLI does the actual git add/commit.
//
// Adopts the Conventional Commits spec regex (MIT, marcojahn gist) and the
// qoomon/git-conventional-commits (MIT) type-set as patterns — reimplemented zero-dep.

// Scope this lane may auto-stage. Matches SCRIPTS_AGENTS §3 Scope Law.
export const SCOPE_PREFIXES = ["scripts/", "bin/", ".github/workflows/"];
export const SCOPE_EXACT = ["Makefile"];
// Root-level shell scripts (install/setup/start/stop/uninstall/…) are scripts-lane
// per Scope Law §3 ("root *.sh"). A top-level *.sh (no slash) is in scope.
const ROOT_SH_RE = /^[^/]+\.sh$/;

const CONVENTIONAL_RE =
  /^(feat|fix|refactor|chore|docs|test|build|ci|perf|revert|style)(\([\w\-./]+\))?(!)?: .+/;

export function isInScope(path) {
  return SCOPE_EXACT.includes(path) || ROOT_SH_RE.test(path) || SCOPE_PREFIXES.some((p) => path.startsWith(p));
}

// First line only must match the spec (body/footer free-form).
export function isConventional(message) {
  return CONVENTIONAL_RE.test(String(message || "").split("\n")[0].trim());
}

// Parse `git status --porcelain` lines → [{status, path, tracked}]. Handles renames
// ("R  old -> new" → the new path) and quoted paths defensively.
export function parsePorcelain(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    if (!raw.trim()) continue;
    const status = raw.slice(0, 2);
    let path = raw.slice(3);
    if (path.includes(" -> ")) path = path.split(" -> ")[1]; // rename target
    path = path.replace(/^"|"$/g, "");
    out.push({ status, path, tracked: status.trim() !== "??" });
  }
  return out;
}

// Decide the auto-commit. Pure: caller supplies porcelain text + message.
//   ok=false reasons: contamination (out-of-scope TRACKED change), non-conventional
//   message, or nothing in scope to stage. Out-of-scope UNTRACKED (e.g. node_modules)
//   is ignored — never staged, never blocks.
export function commitDecision(porcelainText, message) {
  const entries = parsePorcelain(porcelainText);
  const inScope = entries.filter((e) => isInScope(e.path));
  const contamination = entries.filter((e) => !isInScope(e.path) && e.tracked).map((e) => e.path);

  if (contamination.length) {
    return { ok: false, reason: "out-of-scope tracked changes (cross-lane contamination)", violations: contamination, stage: [] };
  }
  if (!isConventional(message)) {
    return { ok: false, reason: "message is not a Conventional Commit", violations: [], stage: [] };
  }
  const stage = inScope.map((e) => e.path);
  if (!stage.length) {
    return { ok: false, reason: "nothing in scope to commit", violations: [], stage: [] };
  }
  return { ok: true, reason: "ok", violations: [], stage };
}
