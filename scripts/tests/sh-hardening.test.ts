// v6 Hardening — always-on static gate for in-scope shell scripts (no brew tool
// needed, runs in CI). Every .sh must have a shebang + `set -euo pipefail`;
// every destructive lifecycle script must expose a DRY_RUN guard.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// In-scope shell scripts (scripts lane).
const ALL_SH = [
  "start.sh", "stop.sh", "install.sh", "setup.sh", "setup-keys.sh",
  "join-cluster.sh", "uninstall.sh", "bin/host-bridge/start-bridge.sh",
];

// Destructive scripts must be dry-runnable (side-effect-free rehearsal/testing).
// start-bridge.sh is the bridge launcher (infra), exempt.
const DESTRUCTIVE = [
  "start.sh", "stop.sh", "install.sh", "setup.sh", "setup-keys.sh",
  "join-cluster.sh", "uninstall.sh",
];

describe("shell hardening (static)", () => {
  it.each(ALL_SH)("%s has a bash shebang", (f) => {
    expect(read(f).split("\n")[0]).toMatch(/^#!.*\b(bash|sh)\b/);
  });

  it.each(ALL_SH)("%s sets `set -euo pipefail`", (f) => {
    expect(read(f)).toMatch(/set -euo pipefail/);
  });

  it.each(DESTRUCTIVE)("%s exposes a DRY_RUN guard", (f) => {
    expect(read(f)).toMatch(/DRY_RUN/);
  });
});
