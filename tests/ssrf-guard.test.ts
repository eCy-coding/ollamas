import { describe, it, expect } from "vitest";
import { isPrivateAddress, assertPublicUrl } from "../bin/host-bridge/lib/ssrf-guard.mjs";

// Round-7 (batch-2) HIGH: web_search --fetch is a safe-tier host tool that fetched any
// agent-supplied URL with no SSRF guard. assertPublicUrl blocks internal targets.
describe("host-tool SSRF guard", () => {
  it("isPrivateAddress flags private/loopback/metadata (incl. hex-mapped IPv6)", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:7f00:1", "::ffff:a9fe:a9fe"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });

  it("assertPublicUrl rejects non-http(s) schemes", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/scheme not allowed/);
    await expect(assertPublicUrl("gopher://x")).rejects.toThrow(/scheme not allowed/);
  });

  it("assertPublicUrl rejects localhost + private IP literals (incl metadata)", async () => {
    await expect(assertPublicUrl("http://localhost/x")).rejects.toThrow(/localhost/);
    await expect(assertPublicUrl("http://127.0.0.1/x")).rejects.toThrow(/non-public/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/non-public/);
    await expect(assertPublicUrl("http://[::ffff:7f00:1]/x")).rejects.toThrow(/non-public/);
  });

  it("assertPublicUrl allows a public IP literal", async () => {
    await expect(assertPublicUrl("https://1.1.1.1/")).resolves.toBeUndefined();
  });
});
