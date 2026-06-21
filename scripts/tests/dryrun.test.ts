// Scripts domain v2 — lifecycle .sh DRY_RUN guard.
// Executes stop.sh under DRY_RUN=1 (fast, prompt-free) and asserts no real
// side effect runs; static-checks the heavier scripts carry the same guard.
// Deferred (explicit, not silent): setup.sh, install.sh, setup-keys.sh,
// join-cluster.sh DRY_RUN gating → follow-up (v6 hardening).
import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

describe("lifecycle .sh DRY_RUN guard", () => {
  test("DRY_RUN=1 stop.sh echoes [DRY] and runs no docker", () => {
    const out = execFileSync("bash", ["stop.sh"], {
      cwd: ROOT,
      env: { ...process.env, DRY_RUN: "1" },
      encoding: "utf8",
      timeout: 15000,
    });
    expect(out).toContain("[DRY]");
    expect(out).toContain("would run: docker compose down");
    expect(out).toContain("would kill bridge pid");
    expect(out).toContain("DURDU");
  });

  test.each(["stop.sh", "start.sh", "uninstall.sh"])(
    "%s declares a DRY_RUN guard",
    (file) => {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      expect(src).toMatch(/DRY_RUN/);
      expect(src).toMatch(/\[DRY\]/);
    },
  );

  test("start.sh gates docker compose up behind DRY_RUN", () => {
    const src = readFileSync(path.join(ROOT, "start.sh"), "utf8");
    expect(src).toMatch(/DRY_RUN.*=.*"1".*\n.*docker compose up|would run: docker compose up/s);
  });
});
