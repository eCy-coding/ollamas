// Unit tests for SubscriptionRegistry (node env, no MCP server needed).
import { describe, test, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SubscriptionRegistry } from "../server/mcp/subscriptions";

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-sub-"));
}

function writeFile(dir: string, name: string, content = "v1") {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

// URIs are relative to workspaceRoot, matching how resources/list emits them:
// `file://${relativePath}` (no leading slash, no hostname).
function fileUri(workspaceRoot: string, name: string) {
  return `file://${name}`;
}

describe("SubscriptionRegistry", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    }
    dirs.length = 0;
  });

  test("subscribe fires onUpdate after file change (debounced)", async () => {
    const dir = makeTmp(); dirs.push(dir);
    writeFile(dir, "watched.txt");
    const uri = fileUri(dir, "watched.txt");
    const onUpdate = vi.fn();
    const reg = new SubscriptionRegistry(dir, onUpdate);

    reg.subscribe(uri);
    expect(reg.size).toBe(1);

    // Give fs.watch a moment to register before the first write (macOS FSEvents
    // can race if the write arrives before the kernel watch is installed).
    await new Promise((r) => setTimeout(r, 50));

    // Trigger a change
    fs.writeFileSync(path.join(dir, "watched.txt"), "v2");

    // Wait long enough for debounce (150ms) + fs event latency; generous timeout
    // because macOS FSEvents coalescing adds unpredictable latency in CI.
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(uri), { timeout: 6000 });

    reg.dispose();
  }, 10000);

  test("unsubscribe stops further callbacks", async () => {
    const dir = makeTmp(); dirs.push(dir);
    writeFile(dir, "unsub.txt");
    const uri = fileUri(dir, "unsub.txt");
    const onUpdate = vi.fn();
    const reg = new SubscriptionRegistry(dir, onUpdate);

    reg.subscribe(uri);
    reg.unsubscribe(uri);
    expect(reg.size).toBe(0);

    fs.writeFileSync(path.join(dir, "unsub.txt"), "changed-after-unsub");

    // 400ms — longer than debounce — should see no calls
    await new Promise((r) => setTimeout(r, 400));
    expect(onUpdate).not.toHaveBeenCalled();

    reg.dispose();
  }, 10000);

  test("dispose() → size 0 and no callbacks after", async () => {
    const dir = makeTmp(); dirs.push(dir);
    writeFile(dir, "a.txt");
    writeFile(dir, "b.txt");
    const onUpdate = vi.fn();
    const reg = new SubscriptionRegistry(dir, onUpdate);

    reg.subscribe(fileUri(dir, "a.txt"));
    reg.subscribe(fileUri(dir, "b.txt"));
    expect(reg.size).toBe(2);

    reg.dispose();
    expect(reg.size).toBe(0);

    // Write after dispose — no notifications
    fs.writeFileSync(path.join(dir, "a.txt"), "after-dispose");
    await new Promise((r) => setTimeout(r, 400));
    expect(onUpdate).not.toHaveBeenCalled();
  }, 10000);

  test("traversal uri throws", () => {
    const dir = makeTmp(); dirs.push(dir);
    const reg = new SubscriptionRegistry(dir, () => {});
    expect(() => reg.subscribe("file://../etc/passwd")).toThrow();
    reg.dispose();
  });

  test("missing file throws", () => {
    const dir = makeTmp(); dirs.push(dir);
    const reg = new SubscriptionRegistry(dir, () => {});
    expect(() => reg.subscribe(fileUri(dir, "nonexistent.txt"))).toThrow();
    reg.dispose();
  });
});
