// T3-F2 — key-doctor discovery core: candidate keys from injected source readers
// (env / macOS keychain / gh CLI), keyId dedup, source precedence, and the hard
// SECURITY invariant that a raw key value never appears in any maskable field.
import { describe, it, expect } from "vitest";
import { buildFindArgs, buildAddArgs } from "../server/lib/keychain-scan";
import {
  discoveryTargets,
  discoverCandidates,
  maskKey,
  type SourceReaders,
} from "../server/key-doctor";

const readers = (over: Partial<SourceReaders> = {}): SourceReaders => ({
  env: () => ({}),
  keychain: () => ({}),
  gh: () => null,
  ...over,
});

describe("keychain-scan — pure argv builder", () => {
  it("find-generic-password by service with -w (value never echoed to args beyond -w mode)", () => {
    expect(buildFindArgs("GROQ_API_KEY")).toEqual(["find-generic-password", "-s", "GROQ_API_KEY", "-w"]);
  });
  it("add-generic-password uses -U (update-in-place) + scoped service/account", () => {
    expect(buildAddArgs("OLLAMAS_MASTER_KEY", "ollamas", "v")).toEqual([
      "add-generic-password", "-U", "-s", "OLLAMAS_MASTER_KEY", "-a", "ollamas", "-w", "v",
    ]);
  });
});

describe("discoveryTargets — the full scan surface", () => {
  it("covers every keyed cloud provider env name + rotation suffixes + modality keys", () => {
    const t = discoveryTargets();
    const names = t.map((x) => x.envName);
    expect(names).toContain("GROQ_API_KEY");
    expect(names).toContain("GROQ_API_KEY_1"); // rotation
    expect(names).toContain("GEMINI_API_KEY");
    expect(names).toContain("VOYAGE_API_KEY"); // embed
    expect(names).toContain("TAVILY_API_KEY"); // search
    expect(names).toContain("GITHUB_MODELS_TOKEN");
    // every target maps back to a provider id
    for (const x of t) expect(x.provider.length).toBeGreaterThan(0);
  });
});

describe("maskKey", () => {
  it("keeps only the last 4 chars", () => {
    expect(maskKey("gsk_abcdef123456")).toBe("…3456");
    expect(maskKey("abc")).toBe("…abc");
  });
});

describe("discoverCandidates — merge, precedence, dedup, masking", () => {
  it("env beats keychain beats gh for the same key value slot; keyId dedups identical values", () => {
    const out = discoverCandidates(readers({
      env: () => ({ GROQ_API_KEY: "gsk_env" }),
      keychain: () => ({ GROQ_API_KEY: "gsk_keychain", ZAI_API_KEY: "zai_kc" }),
    }));
    const groq = out.filter((c) => c.provider === "groq");
    // both distinct groq values survive (they rotate as a pool), env listed first
    expect(groq.map((c) => c.source)).toEqual(["env", "keychain"]);
    expect(out.find((c) => c.provider === "zai")?.source).toBe("keychain");
  });

  it("identical value from two sources → single candidate (highest-precedence source)", () => {
    const out = discoverCandidates(readers({
      env: () => ({ GROQ_API_KEY: "same-key" }),
      keychain: () => ({ GROQ_API_KEY: "same-key" }),
    }));
    expect(out.filter((c) => c.provider === "groq")).toHaveLength(1);
    expect(out[0].source).toBe("env");
  });

  it("gh token becomes a github-models candidate", () => {
    const out = discoverCandidates(readers({ gh: () => "gho_tok123" }));
    const c = out.find((x) => x.provider === "github-models");
    expect(c?.source).toBe("gh");
    expect(c?.keyMasked).toBe("…k123");
  });

  it("SECURITY: no report-facing field ever contains the raw key", () => {
    const out = discoverCandidates(readers({ env: () => ({ GROQ_API_KEY: "gsk_supersecretvalue" }) }));
    for (const c of out) {
      const { key, ...reportFacing } = c;
      expect(JSON.stringify(reportFacing)).not.toContain("gsk_supersecretvalue");
    }
  });

  it("empty/whitespace values are ignored", () => {
    const out = discoverCandidates(readers({ env: () => ({ GROQ_API_KEY: "  ", ZAI_API_KEY: "" }) }));
    expect(out).toHaveLength(0);
  });
});
