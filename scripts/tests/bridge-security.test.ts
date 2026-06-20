// Scripts domain v14 — host-bridge security guards. Path confinement (no traversal),
// payload bound, and fail-closed bind. These are the load-bearing checks the bridge
// missed (ERR-SCR-006/007, RISK-SCR-019).
import { describe, test, expect } from "vitest";
import path from "node:path";
import { safeWritePath, withinLimit, bindRequiresAuth, defaultWriteRoots } from "../../bin/host-bridge/lib/bridge-guard.mjs";

const ROOT = "/tmp/llm-bridge-test-root";

describe("bridge security guards", () => {
  test("safeWritePath allows paths inside an allowed root", () => {
    const r = safeWritePath([ROOT], `${ROOT}/sub/file.txt`);
    expect(r.ok).toBe(true);
    expect(r.resolved).toBe(path.resolve(`${ROOT}/sub/file.txt`));
  });

  test("safeWritePath allows the root itself", () => {
    expect(safeWritePath([ROOT], ROOT).ok).toBe(true);
  });

  test("safeWritePath blocks ../ traversal escaping the root", () => {
    expect(safeWritePath([ROOT], `${ROOT}/../../etc/passwd`).ok).toBe(false);
    expect(safeWritePath([ROOT], "/etc/passwd").ok).toBe(false);
    expect(safeWritePath([ROOT], `${ROOT}/../sibling/x`).ok).toBe(false);
  });

  test("safeWritePath blocks a prefix-sibling (root + suffix, not a child)", () => {
    // "/tmp/llm-bridge-test-root-evil" must NOT match "/tmp/llm-bridge-test-root"
    expect(safeWritePath([ROOT], `${ROOT}-evil/x`).ok).toBe(false);
  });

  test("safeWritePath rejects empty/non-string", () => {
    expect(safeWritePath([ROOT], "").ok).toBe(false);
    expect(safeWritePath([ROOT], null as unknown as string).ok).toBe(false);
  });

  test("withinLimit enforces the cap", () => {
    expect(withinLimit(100, 1000)).toBe(true);
    expect(withinLimit(1000, 1000)).toBe(true);
    expect(withinLimit(1001, 1000)).toBe(false);
  });

  test("bindRequiresAuth: non-loopback without auth must refuse", () => {
    expect(bindRequiresAuth("0.0.0.0", false)).toBe(true);
    expect(bindRequiresAuth("192.168.1.20", false)).toBe(true);
    expect(bindRequiresAuth("0.0.0.0", true)).toBe(false); // auth present → ok
    expect(bindRequiresAuth("127.0.0.1", false)).toBe(false); // loopback dev → ok
    expect(bindRequiresAuth("::1", false)).toBe(false);
    expect(bindRequiresAuth("localhost", false)).toBe(false);
  });

  test("defaultWriteRoots honors BRIDGE_WRITE_ROOTS and resolves", () => {
    const prev = process.env.BRIDGE_WRITE_ROOTS;
    process.env.BRIDGE_WRITE_ROOTS = "/a:/b/c";
    expect(defaultWriteRoots()).toEqual([path.resolve("/a"), path.resolve("/b/c")]);
    if (prev === undefined) delete process.env.BRIDGE_WRITE_ROOTS; else process.env.BRIDGE_WRITE_ROOTS = prev;
  });
});
