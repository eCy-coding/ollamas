// T3-F3 — runDoctor: validate → connect → report with fully injected deps. Covers the
// safe-default dryRun, dedup-skip ("already"), auth-fail verdicts (gh refresh hint),
// 429 = connected-unverified, vault primary-vs-pool writes, and capability/role output.
import { describe, it, expect } from "vitest";
import { runDoctor, type DoctorDeps, type SourceReaders } from "../server/key-doctor";
import { keyId } from "../server/key-usage";

function fakeDeps(over: Partial<DoctorDeps> = {}): DoctorDeps & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    chatValidate: async () => {},
    embedValidate: async () => {},
    tavilyValidate: async () => {},
    vault: {
      hasPrimary: () => false,
      knownKeyIds: () => new Set<string>(),
      savePrimary: (p, k) => writes.push(`primary:${p}:${k.slice(-4)}`),
      addToPool: (p, k) => writes.push(`pool:${p}:${k.slice(-4)}`),
    },
    ...over,
  };
}

const envReaders = (env: Record<string, string>, gh: string | null = null): SourceReaders => ({
  env: () => env,
  keychain: () => ({}),
  gh: () => gh,
});

describe("runDoctor", () => {
  it("dryRun default: validates but writes NOTHING; verdict notes dry-run", async () => {
    const deps = fakeDeps();
    const r = await runDoctor({}, deps, envReaders({ GROQ_API_KEY: "gsk_live1" }));
    expect(r.dryRun).toBe(true);
    expect(deps.writes).toHaveLength(0);
    expect(r.providers.groq.status).toBe("connected");
    expect(r.providers.groq.note).toMatch(/dry-run/);
  });

  it("dryRun=false: valid key → vault primary; second distinct key → pool", async () => {
    let hasPrimary = false;
    const deps = fakeDeps({
      vault: {
        hasPrimary: () => hasPrimary,
        knownKeyIds: () => new Set(),
        savePrimary: (p, k) => { hasPrimary = true; deps.writes.push(`primary:${p}:${k.slice(-4)}`); },
        addToPool: (p, k) => deps.writes.push(`pool:${p}:${k.slice(-4)}`),
      },
    });
    const r = await runDoctor({ dryRun: false }, deps, envReaders({ GROQ_API_KEY: "gsk_one1", GROQ_API_KEY_1: "gsk_two2" }));
    expect(deps.writes).toEqual(["primary:groq:one1", "pool:groq:two2"]);
    expect(r.providers.groq.status).toBe("connected");
  });

  it("known keyId → 'already', no validation call, no write", async () => {
    let validateCalls = 0;
    const deps = fakeDeps({
      chatValidate: async () => { validateCalls++; },
      vault: {
        hasPrimary: () => true,
        knownKeyIds: (p) => (p === "groq" ? new Set([keyId("gsk_known")]) : new Set()),
        savePrimary: () => { throw new Error("must not write"); },
        addToPool: () => { throw new Error("must not write"); },
      },
    });
    const r = await runDoctor({ dryRun: false }, deps, envReaders({ GROQ_API_KEY: "gsk_known" }));
    expect(r.providers.groq.status).toBe("already");
    expect(validateCalls).toBe(0);
  });

  it("auth failure → invalid + signup URL; gh source carries the refresh command hint", async () => {
    const deps = fakeDeps({ chatValidate: async () => { throw new Error("OpenAI-compatible host returned error 401"); } });
    const r = await runDoctor({}, deps, envReaders({}, "gho_bad"));
    const gm = r.providers["github-models"];
    expect(gm.status).toBe("invalid");
    expect(gm.note).toContain("gh auth refresh");
    expect(gm.nextManualUrl).toContain("github.com");
  });

  it("429 during validation → connected-unverified (key is real, quota wall)", async () => {
    const deps = fakeDeps({ chatValidate: async () => { throw new Error("error 429 rate limit"); } });
    const r = await runDoctor({}, deps, envReaders({ CEREBRAS_API_KEY: "csk_x9z8" }));
    expect(r.providers.cerebras.status).toBe("connected-unverified");
  });

  it("modality routing: tavily/voyage validators used; absent providers get signup URLs", async () => {
    const calls: string[] = [];
    const deps = fakeDeps({
      tavilyValidate: async () => { calls.push("tavily"); },
      embedValidate: async (id) => { calls.push(`embed:${id}`); },
    });
    const r = await runDoctor({}, deps, envReaders({ TAVILY_API_KEY: "tvly_1", VOYAGE_API_KEY: "vg_2" }));
    expect(calls.sort()).toEqual(["embed:voyage", "tavily"]);
    expect(r.providers.groq.status).toBe("absent");
    expect(r.providers.groq.nextManualUrl).toContain("console.groq.com");
  });

  it("capability/role report reflects only CONNECTED providers", async () => {
    const r = await runDoctor({}, fakeDeps(), envReaders({ GROQ_API_KEY: "gsk_a1b2", ZAI_API_KEY: "zai_c3d4" }));
    expect(r.capabilityReport.stt).toEqual(["groq"]);
    expect(r.capabilityReport["long-ctx"]).toEqual(["zai"]);
    expect(r.roleSuggestions["fast-verify"]).toEqual(["groq"]);
  });

  it("SECURITY: serialized report never contains raw key material", async () => {
    const r = await runDoctor({}, fakeDeps(), envReaders({ GROQ_API_KEY: "gsk_topsecret999x" }));
    expect(JSON.stringify(r)).not.toContain("gsk_topsecret999x");
    expect(JSON.stringify(r)).toContain("…999x");
  });
});
