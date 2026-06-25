import { describe, it, expect } from "vitest";
import { expectedAudience } from "../server/middleware/auth";

// Round-5 HIGH: the RFC 8707 audience was derived from the attacker-controllable Host
// header when OAUTH_AUDIENCE was unset, so a token bound to another resource was
// replayable here by spoofing Host. expectedAudience never trusts Host for the security
// boundary: explicit config wins; SaaS mode without config refuses the Host fallback.
describe("expectedAudience (audience-confusion fix)", () => {
  it("uses OAUTH_AUDIENCE when set, ignoring the (spoofed) Host", () => {
    expect(expectedAudience("http://evil.attacker", { OAUTH_AUDIENCE: "https://me/mcp" } as any)).toBe("https://me/mcp");
  });
  it("derives from MCP_PUBLIC_URL when set (trailing slash trimmed)", () => {
    expect(expectedAudience("http://evil.attacker", { MCP_PUBLIC_URL: "https://me/" } as any)).toBe("https://me/mcp");
  });
  it("a configured resource wins even in SaaS mode (spoofed Host ignored)", () => {
    expect(expectedAudience("http://victim-mcp", { SAAS_ENFORCE: "1", OAUTH_AUDIENCE: "https://me/mcp" } as any)).toBe("https://me/mcp");
  });
  it("falls back to the request origin when nothing is configured (self-issued / single-owner)", () => {
    expect(expectedAudience("http://localhost:3000", {} as any)).toBe("http://localhost:3000/mcp");
  });
});
