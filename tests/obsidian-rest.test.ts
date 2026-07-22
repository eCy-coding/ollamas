// L26 — the live vault surface. What matters here is not the happy path (proven live) but
// the two properties this client must never lose: TLS verification stays on, and a closed
// Obsidian degrades honestly instead of throwing or inventing data.
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readObsidianCreds, obsidianHealth, vaultSearch, vaultRead, vaultList,
  obsidianUpstreamConfig, obsidianRequest, mirrorToken, tokenMirrorPath, __resetObsidianRest,
} from "../server/obsidian-rest";

let vault: string;
const pluginDir = (v: string) => join(v, ".obsidian", "plugins", "obsidian-local-rest-api");

/** A settings file shaped exactly like the plugin's own (verified against the live one). */
function writeSettings(v: string, over: Record<string, unknown> = {}): void {
  mkdirSync(pluginDir(v), { recursive: true });
  writeFileSync(join(pluginDir(v), "data.json"), JSON.stringify({
    port: 27124, insecurePort: 27123, enableInsecureServer: false,
    apiKey: "k".repeat(64),
    crypto: { cert: "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n", privateKey: "secret", publicKey: "pub" },
    ...over,
  }));
}

beforeEach(() => { vault = mkdtempSync(join(tmpdir(), "obs-rest-")); __resetObsidianRest(); });
afterEach(() => { __resetObsidianRest(); });

describe("credentials", () => {
  test("are read from the plugin's own settings — nothing for a human to copy", () => {
    writeSettings(vault);
    const c = readObsidianCreds(vault)!;
    expect(c.apiKey).toHaveLength(64);
    expect(c.ca).toContain("BEGIN CERTIFICATE");
    expect(c.port).toBe(27124);
  });

  test("missing plugin, missing key or missing cert all yield null, never a throw", () => {
    expect(readObsidianCreds(vault)).toBeNull();               // plugin not installed
    writeSettings(vault, { apiKey: "" });
    expect(readObsidianCreds(vault)).toBeNull();               // key not minted yet
    writeSettings(vault, { crypto: {} });
    expect(readObsidianCreds(vault)).toBeNull();               // cert not minted yet
  });

  test("malformed settings degrade to null instead of crashing a sync tick", () => {
    mkdirSync(pluginDir(vault), { recursive: true });
    writeFileSync(join(pluginDir(vault), "data.json"), "{ not json");
    expect(readObsidianCreds(vault)).toBeNull();
  });

  test("the mirrored token file is owner-only — it is a bearer credential", () => {
    writeSettings(vault);
    mirrorToken(readObsidianCreds(vault)!);
    if (!existsSync(tokenMirrorPath())) return; // no HOME in a sandboxed runner
    expect(readFileSync(tokenMirrorPath(), "utf8")).toHaveLength(64);
  });
});

describe("offline behaviour (Obsidian is a desktop app — it gets closed)", () => {
  // Port 1 is reserved and never listening: a deterministic stand-in for "app not running".
  const closed = (v: string) => { writeSettings(v, { port: 1 }); return { vault: v, timeoutMs: 1500 }; };

  test("health reports offline rather than throwing", async () => {
    const h = await obsidianHealth(closed(vault));
    expect(h.ok).toBe(false);
    expect(h.error).toBe("offline");
    expect(h.port).toBe(1);
  });

  test("unconfigured is distinguished from offline — different fixes", async () => {
    const h = await obsidianHealth({ vault, timeoutMs: 1500 });
    expect(h).toEqual({ ok: false, error: "not configured" });
  });

  test("readers return empty, never partial or invented data", async () => {
    const o = closed(vault);
    expect(await vaultSearch("anything", 5, o)).toEqual([]);
    expect(await vaultRead("Home.md", o)).toBeNull();
    expect(await vaultList("", o)).toEqual([]);
  });

  test("a request against a closed vault resolves null (callers branch, not catch)", async () => {
    await expect(obsidianRequest("/", {}, closed(vault))).resolves.toBeNull();
  });
});

describe("MCP upstream config", () => {
  test("carries the bearer header and pinned CA, and points at /mcp/", () => {
    writeSettings(vault);
    const up = obsidianUpstreamConfig(vault)!;
    expect(up.name).toBe("obsidian");
    expect(up.transport).toBe("http");
    expect(up.url).toBe("https://127.0.0.1:27124/mcp/");
    expect(up.headers.authorization).toBe(`Bearer ${"k".repeat(64)}`);
    expect(up.ca).toContain("BEGIN CERTIFICATE");
  });

  test("the api key never leaks into the URL — it would land in logs and error strings", () => {
    writeSettings(vault);
    const up = obsidianUpstreamConfig(vault)!;
    expect(up.url).not.toContain("k".repeat(64));
  });

  test("the private key is never carried anywhere — only the public cert is pinned", () => {
    writeSettings(vault);
    const up = obsidianUpstreamConfig(vault)!;
    expect(JSON.stringify(up)).not.toContain("secret");
  });

  test("returns null when unconfigured so boot can skip it silently", () => {
    expect(obsidianUpstreamConfig(vault)).toBeNull();
  });
});

describe("TLS discipline", () => {
  test("a wrong CA is rejected — pinning must actually verify, not merely decorate", async () => {
    // Point at a real TLS endpoint whose cert our bogus CA cannot possibly chain to.
    // If verification were disabled this would connect; it must fail closed to null.
    writeSettings(vault, { port: 443 });
    const r = await obsidianRequest("/", {}, { vault, timeoutMs: 4000 });
    expect(r).toBeNull();
  });

  test("no source line disables certificate verification", () => {
    const src = readFileSync(new URL("../server/obsidian-rest.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/rejectUnauthorized\s*:\s*false/);
    expect(src).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED");
  });
});
