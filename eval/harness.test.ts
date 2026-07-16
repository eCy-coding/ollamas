// eval/harness.test.ts — offline unit tests for the $0 promptfoo eval harness (B6, ported
// from ollamas-integrate-wt). No network, no model download, no `promptfoo` binary invocation —
// those live in `make eval-providers` / `make eval-rerank` (manual/live only).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseCatalog,
  selectProviders,
  renderConfig,
  KEYLESS_BASE_OVERRIDES,
} from "../scripts/gen-promptfoo-providers.mjs";

const ROOT = join(__dirname, "..");
const catalogSource = readFileSync(join(ROOT, "server/provider-catalog.ts"), "utf8");
const entries = parseCatalog(catalogSource);

describe("provider-catalog parsing", () => {
  it("parses at least one entry from server/provider-catalog.ts", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("every parsed entry has the shape gen-promptfoo-providers.mjs depends on", () => {
    for (const e of entries) {
      expect(typeof e.id).toBe("string");
      expect(e.id.length).toBeGreaterThan(0);
      expect(typeof e.baseUrl).toBe("string");
      expect(typeof e.envKey).toBe("string");
      expect(typeof e.defaultModel).toBe("string");
      expect(typeof e.keyless).toBe("boolean");
    }
  });

  it("carries a keyless floor entry (pollinations) — the $0 fallback", () => {
    expect(entries.some((e) => e.keyless)).toBe(true);
  });
});

describe("selectProviders — offline, no network", () => {
  it("always keeps the keyless floor, drops key'd providers without env", () => {
    const sel = selectProviders(entries, {});
    expect(sel.length).toBeGreaterThan(0);
    expect(sel.every((e: { keyless?: boolean }) => e.keyless)).toBe(true);
  });

  it("includes a key'd provider once its envKey is present", () => {
    const keyd = entries.find((e) => !e.keyless);
    expect(keyd).toBeTruthy();
    const sel = selectProviders(entries, { [keyd!.envKey]: "x" });
    expect(sel.map((e: { id: string }) => e.id)).toContain(keyd!.id);
  });

  it("skips entries with an unresolved {account_id} placeholder even with --all", () => {
    const placeholderEntry = entries.find((e) => e.baseUrl.includes("{account_id}"));
    if (!placeholderEntry) return; // catalog drift: no such entry on this branch — nothing to assert
    const sel = selectProviders(entries, {}, { all: true });
    expect(sel.map((e: { id: string }) => e.id)).not.toContain(placeholderEntry.id);
  });
});

describe("renderConfig — produces a valid provider list shape (mocked, no network)", () => {
  const mockEntries = [
    { id: "fake-keyless", baseUrl: "https://example.invalid/v1", envKey: "FAKE_KEY", defaultModel: "fake-model", keyless: true },
    { id: "fake-keyd", baseUrl: "https://keyd.invalid/v1", envKey: "FAKE_KEYD_KEY", defaultModel: "fake-keyd-model", keyless: false },
  ];
  const yaml = renderConfig(selectProviders(mockEntries, { FAKE_KEYD_KEY: "x" }));

  it("emits a promptfooconfig.yaml body that parses as valid YAML", () => {
    const doc = parseYaml(yaml);
    expect(doc.providers).toHaveLength(2);
    expect(doc.prompts).toEqual(["{{task}}"]);
    expect(doc.tests.length).toBe(3);
  });

  it("keyless entry gets a dummy apiKey, key'd entry gets apiKeyEnvar", () => {
    const doc = parseYaml(yaml);
    const keyless = doc.providers.find((p: any) => p.label === "fake-keyless");
    const keyd = doc.providers.find((p: any) => p.label === "fake-keyd");
    expect(keyless.config.apiKey).toBe("keyless");
    expect(keyd.config.apiKeyEnvar).toBe("FAKE_KEYD_KEY");
  });

  it("KEYLESS_BASE_OVERRIDES is a plain object (override escape hatch, empty by default)", () => {
    expect(typeof KEYLESS_BASE_OVERRIDES).toBe("object");
  });
});

describe("eval/promptfooconfig.yaml — the committed, generated file", () => {
  const yamlText = readFileSync(join(ROOT, "eval/promptfooconfig.yaml"), "utf8");

  it("parses as valid YAML", () => {
    const doc = parseYaml(yamlText);
    expect(Array.isArray(doc.providers)).toBe(true);
    expect(doc.providers.length).toBeGreaterThan(0);
  });

  it("carries the keyless pollinations floor and the three smoke assertions", () => {
    const doc = parseYaml(yamlText);
    expect(doc.providers.some((p: any) => p.config.apiKey === "keyless")).toBe(true);
    expect(doc.tests.map((t: any) => t.description)).toEqual([
      "echo discipline",
      "deterministic arithmetic",
      "json shape",
    ]);
  });
});

describe("eval/fixtures/rerank-fixture.json — shape for scripts/eval-rerank.mjs", () => {
  const fixture = JSON.parse(readFileSync(join(ROOT, "eval/fixtures/rerank-fixture.json"), "utf8"));

  it("has at least 8 queries with 6-10 candidates each", () => {
    expect(fixture.length).toBeGreaterThanOrEqual(8);
    for (const c of fixture) {
      expect(c.candidates.length).toBeGreaterThanOrEqual(6);
      expect(c.candidates.length).toBeLessThanOrEqual(10);
    }
  });

  it("every case has a query, a relevantId, and unique candidate ids", () => {
    for (const c of fixture) {
      expect(typeof c.query).toBe("string");
      expect(c.query.length).toBeGreaterThan(0);
      expect(typeof c.relevantId).toBe("string");
      const ids = c.candidates.map((cand: any) => cand.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("relevantId always refers to a real candidate in the same case", () => {
    for (const c of fixture) {
      const ids = c.candidates.map((cand: any) => cand.id);
      expect(ids).toContain(c.relevantId);
    }
  });

  it("every candidate has non-empty text (what the scorer ranks on)", () => {
    for (const c of fixture) {
      for (const cand of c.candidates) {
        expect(typeof cand.text).toBe("string");
        expect(cand.text.length).toBeGreaterThan(0);
      }
    }
  });
});
