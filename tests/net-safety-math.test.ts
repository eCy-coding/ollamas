import { describe, it, expect } from "vitest";
import { classifyIp } from "../server/mcp/host-guard";
import { filterChain } from "../server/chain-policy";

// MATH §11 — SSRF host-guard: classifyIp is a TOTAL function (every host → a defined verdict) and encoded
// numeric forms are REJECTED so a decimal/octal/hex-encoded metadata IP can't bypass the dotted-quad check.
describe("classifyIp — totality + no-bypass (§11)", () => {
  it("is total: every input yields a defined verdict/reject/null", () => {
    for (const h of ["", "   ", "8.8.8.8", "127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254",
      "::1", "[fe80::1]", "example.com", "0x7f.0.0.1", "2130706433", "999.1.1.1", "not a host"]) {
      const v = classifyIp(h);
      expect(v === null || typeof v === "string").toBe(true); // never throws, never undefined
    }
  });

  it("blocks the classic metadata/link-local address (169.254.169.254 → linklocal)", () => {
    expect(classifyIp("169.254.169.254")).toBe("linklocal");
    expect(classifyIp("[fe80::1]")).toBe("linklocal");
    expect(classifyIp("::ffff:169.254.169.254")).toBe("linklocal"); // IPv4-mapped bypass attempt
  });

  it("rejects ENCODED numeric IPs (bypass defense), not classifies them", () => {
    expect(classifyIp("2130706433")).toBe("reject");     // decimal-encoded 127.0.0.1
    expect(classifyIp("017700000001")).toBe("reject");   // octal/all-digit encoding
    expect(classifyIp("0x7f000001")).toBe("reject");     // pure hex encoding
    expect(classifyIp("999.1.1.1")).toBe("reject");      // out-of-range octet (digit-dots, not a strict quad)
    expect(classifyIp("")).toBe("reject");
  });

  it("classifies real literals + leaves hostnames to DNS (null)", () => {
    expect(classifyIp("127.0.0.1")).toBe("loopback");
    expect(classifyIp("::1")).toBe("loopback");
    expect(classifyIp("10.0.0.1")).toBe("rfc1918");
    expect(classifyIp("8.8.8.8")).toBe("public");
    expect(classifyIp("example.com")).toBeNull();
  });
});

// MATH §10 — filterChain never empties the chain: TERMINAL ($0-local) providers survive every restriction,
// so a $0 landing always remains reachable no matter how strict the policy.
describe("filterChain — non-empty theorem (§10)", () => {
  const CHAIN = ["gemini", "openai", "fleet", "ollama-local", "demo"];
  it("keeps terminal $0 providers under the MOST restrictive opts", () => {
    const out = filterChain(CHAIN, { privateMode: true, needTools: true, estTokensIn: 10_000_000, model: "x" });
    expect(out.length).toBeGreaterThan(0);                 // never empty
    expect(out).toEqual(expect.arrayContaining(["fleet", "ollama-local"])); // $0 landing survives
  });
  it("empty opts = identity (no filtering)", () => {
    expect(filterChain(CHAIN, {})).toEqual(CHAIN);
  });
});
