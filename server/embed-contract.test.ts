// F0 — shared encoder contract (brain-encoder/v1).
//
// ollamas, eCym and odysseus must embed into ONE vector space or every downstream
// formula (p_ret softmax, federated merge, MoE gate) compares incomparable numbers.
// These are pure-function tests: no ollama, no db.
import { describe, it, expect } from "vitest";
import {
  EMBED_CONTRACT,
  applyEmbedPrefix,
  prefixPolicyFor,
  embedFingerprint,
  contractEmbedder,
  type EmbedRole,
} from "./embed-contract";

describe("applyEmbedPrefix", () => {
  it("applies nomic task prefixes per role", () => {
    expect(applyEmbedPrefix("disk usage", "document", "nomic-embed-text"))
      .toBe("search_document: disk usage");
    expect(applyEmbedPrefix("disk usage", "query", "nomic-embed-text"))
      .toBe("search_query: disk usage");
  });

  it("matches eCym's existing wire format exactly (ecy-brain:19)", () => {
    // eCym has been the only compliant system; ollamas must produce the SAME string
    // or the two land in different spaces despite sharing a model.
    expect(applyEmbedPrefix("x", "document", "nomic-embed-text")).toBe("search_document: x");
  });

  it("leaves non-nomic models untouched — prefixes are model-specific", () => {
    expect(applyEmbedPrefix("x", "query", "text-embedding-3-small")).toBe("x");
    expect(applyEmbedPrefix("x", "document", "all-MiniLM-L6-v2")).toBe("x");
  });

  it("recognises nomic variants (tag suffix, registry path)", () => {
    // odysseus configures `nomic-embed-text:latest`; ollamas uses the bare name.
    expect(applyEmbedPrefix("x", "query", "nomic-embed-text:latest")).toBe("search_query: x");
    expect(prefixPolicyFor("nomic-embed-text:v1.5")).toBe("nomic-v1");
    expect(prefixPolicyFor("text-embedding-3-small")).toBe("none");
  });

  it("does not double-prefix already-prefixed text", () => {
    const once = applyEmbedPrefix("x", "query", "nomic-embed-text");
    expect(applyEmbedPrefix(once, "query", "nomic-embed-text")).toBe(once);
  });
});

describe("embedFingerprint", () => {
  it("encodes provider, model, prefix policy and norm policy", () => {
    expect(embedFingerprint({
      provider: "ollama-local",
      model: "nomic-embed-text",
      host: "http://127.0.0.1:11434",
    })).toBe("ollama-local:nomic-embed-text@127.0.0.1:11434/prefix=nomic-v1/norm=l2");
  });

  it("CHANGES when prefix policy changes — this is the whole point", () => {
    // The pre-F0 bug: providerId was the constant "ollama-local", so switching
    // prefix policy left the fingerprint identical, ensureProvider() never threw,
    // and 1427 memories would silently split across two spaces.
    const nomic = embedFingerprint({ provider: "ollama-local", model: "nomic-embed-text", host: "h" });
    const other = embedFingerprint({ provider: "ollama-local", model: "text-embedding-3-small", host: "h" });
    expect(nomic).not.toBe(other);
    expect(nomic).toContain("prefix=nomic-v1");
    expect(other).toContain("prefix=none");
  });

  it("is never the bare legacy provider id", () => {
    const fp = embedFingerprint({ provider: "ollama-local", model: "nomic-embed-text", host: "h" });
    expect(fp).not.toBe("ollama-local");
  });

  it("is stable for identical inputs (store pin must not flap)", () => {
    const a = { provider: "p", model: "nomic-embed-text", host: "h" };
    expect(embedFingerprint(a)).toBe(embedFingerprint({ ...a }));
  });
});

describe("contractEmbedder", () => {
  const raw = async (text: string) => {
    // Unnormalized on purpose — mirrors live ollama (measured ‖v‖ = 22.81).
    const scale = text.includes("search_document: ") ? 3 : 7;
    return [scale, scale * 2, scale * 2];
  };

  it("L2-normalizes every vector it returns", async () => {
    const embed = contractEmbedder(raw, "nomic-embed-text");
    for (const role of ["document", "query"] as EmbedRole[]) {
      const v = await embed("x", role);
      const norm = Math.hypot(...v);
      expect(norm).toBeCloseTo(1, 12);
    }
  });

  it("routes the role through to the prefix", async () => {
    const seen: string[] = [];
    const spy = async (t: string) => { seen.push(t); return [1, 0, 0]; };
    const embed = contractEmbedder(spy, "nomic-embed-text");
    await embed("hello", "document");
    await embed("hello", "query");
    expect(seen).toEqual(["search_document: hello", "search_query: hello"]);
  });

  it("defaults to the query role", async () => {
    // Read paths vastly outnumber write paths; write sites pass "document" explicitly.
    const seen: string[] = [];
    const spy = async (t: string) => { seen.push(t); return [1, 0, 0]; };
    await contractEmbedder(spy, "nomic-embed-text")("hello");
    expect(seen).toEqual(["search_query: hello"]);
  });

  it("makes document and query vectors directly comparable by cosine", async () => {
    // Both unit-norm ⇒ dot product IS cosine ⇒ softmax(cos/τ) is well-defined.
    const embed = contractEmbedder(raw, "nomic-embed-text");
    const d = await embed("x", "document");
    const q = await embed("x", "query");
    const cos = d.reduce((s, x, i) => s + x * q[i], 0);
    expect(cos).toBeLessThanOrEqual(1 + 1e-12);
    expect(cos).toBeGreaterThanOrEqual(-1 - 1e-12);
  });

  it("forwards the role to the raw embedder so wrappers can nest", async () => {
    // rag.ts wraps a cloud arm whose failure path delegates to an ALREADY-contracted
    // local arm. If the role stops at the outer wrapper, that inner arm silently
    // defaults to "query" and every fallback write loses its document prefix.
    const seen: (string | undefined)[] = [];
    const raw = async (_t: string, role?: EmbedRole) => { seen.push(role); return [1, 0, 0]; };
    await contractEmbedder(raw, "nomic-embed-text")("x", "document");
    expect(seen).toEqual(["document"]);
  });

  it("nested wrapping does not double-prefix (idempotence carries the nesting)", async () => {
    const seen: string[] = [];
    const inner = contractEmbedder(async (t: string) => { seen.push(t); return [1, 0, 0]; }, "nomic-embed-text");
    const outer = contractEmbedder(inner, "nomic-embed-text");
    await outer("x", "document");
    expect(seen).toEqual(["search_document: x"]);
  });

  it("passes a degenerate zero vector through without NaN", async () => {
    const embed = contractEmbedder(async () => [0, 0, 0], "nomic-embed-text");
    const v = await embed("x", "query");
    expect(v.every(Number.isFinite)).toBe(true);
  });
});

describe("EMBED_CONTRACT", () => {
  it("is versioned so eCym/odysseus can assert the same string", () => {
    expect(EMBED_CONTRACT).toBe("brain-encoder/v1");
  });
});
