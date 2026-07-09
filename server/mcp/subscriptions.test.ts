import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SubscriptionRegistry } from "./subscriptions";

// GW-2 gateway verify (v1.29.3): MCP resource SubscriptionRegistry.
// Self-contained — watches real files in a throwaway tmp workspace (no network,
// no server boot). Exercises idempotency, path-traversal rejection, missing-file
// rejection, unsubscribe/dispose lifecycle, and the debounced onUpdate delivery.

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "subs-test-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// The registry treats the post-scheme path as workspace-RELATIVE (it strips the
// leading slash), so a workspace file "a.txt" is addressed as "file:///a.txt".
function uriFor(rel: string): string {
  return "file:///" + rel;
}

describe("SubscriptionRegistry — registration guards", () => {
  it("subscribe is idempotent (same uri counted once)", () => {
    const f = path.join(root, "a.txt");
    fs.writeFileSync(f, "x");
    const reg = new SubscriptionRegistry(root, () => {});
    reg.subscribe(uriFor("a.txt"));
    reg.subscribe(uriFor("a.txt"));
    expect(reg.size).toBe(1);
    reg.dispose();
  });

  it("throws when the target file does not exist", () => {
    const reg = new SubscriptionRegistry(root, () => {});
    expect(() => reg.subscribe(uriFor("missing.txt"))).toThrow(/Resource not found/);
    expect(reg.size).toBe(0);
    reg.dispose();
  });

  it("rejects a path-traversal uri (escapes workspace root)", () => {
    const reg = new SubscriptionRegistry(root, () => {});
    expect(() => reg.subscribe("file:///../../../../etc/passwd")).toThrow(/traversal/i);
    expect(reg.size).toBe(0);
    reg.dispose();
  });
});

describe("SubscriptionRegistry — lifecycle", () => {
  it("unsubscribe removes the entry and stops further updates", async () => {
    const f = path.join(root, "b.txt");
    fs.writeFileSync(f, "0");
    const onUpdate = vi.fn();
    const reg = new SubscriptionRegistry(root, onUpdate);
    reg.subscribe(uriFor("b.txt"));
    expect(reg.size).toBe(1);
    reg.unsubscribe(uriFor("b.txt"));
    expect(reg.size).toBe(0);
    // A write after unsubscribe must not fire onUpdate.
    fs.writeFileSync(f, "1");
    await new Promise((r) => setTimeout(r, 300));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("unsubscribe on an unknown uri is a no-op", () => {
    const reg = new SubscriptionRegistry(root, () => {});
    expect(() => reg.unsubscribe(uriFor("nope.txt"))).not.toThrow();
    expect(reg.size).toBe(0);
  });

  it("dispose closes all watchers", () => {
    fs.writeFileSync(path.join(root, "c.txt"), "x");
    fs.writeFileSync(path.join(root, "d.txt"), "x");
    const reg = new SubscriptionRegistry(root, () => {});
    reg.subscribe(uriFor("c.txt"));
    reg.subscribe(uriFor("d.txt"));
    expect(reg.size).toBe(2);
    reg.dispose();
    expect(reg.size).toBe(0);
  });
});

describe("SubscriptionRegistry — debounced delivery", () => {
  it("fires onUpdate (coalesced) after a file changes", async () => {
    const f = path.join(root, "watched.txt");
    fs.writeFileSync(f, "v0");
    const onUpdate = vi.fn();
    const reg = new SubscriptionRegistry(root, onUpdate);
    const uri = uriFor("watched.txt");
    reg.subscribe(uri);

    // Multiple rapid writes (editors emit bursts) must coalesce to one delivery.
    for (let i = 1; i <= 3; i++) {
      fs.writeFileSync(f, "v" + i);
      await new Promise((r) => setTimeout(r, 10));
    }

    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled(), { timeout: 3000 });
    expect(onUpdate).toHaveBeenCalledWith(uri);
    reg.dispose();
  });
});
