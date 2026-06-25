import { describe, it, expect } from "vitest";
import { assertPublicWebhookUrl, isPrivateAddress } from "../server/webhooks/outbound";

// H1: deliverOne fetched a tenant-controlled webhook URL with no host validation,
// so a webhook pointed at 127.0.0.1 / 169.254.169.254 / 10.0.0.0/8 turned the
// gateway into an SSRF proxy for internal services + cloud metadata.
describe("assertPublicWebhookUrl (H1 SSRF guard)", () => {
  it("allows a public IP literal target", async () => {
    await expect(assertPublicWebhookUrl("https://1.1.1.1/hook")).resolves.toBeUndefined();
  });

  it("blocks loopback (IPv4 + localhost + IPv6 ::1)", async () => {
    await expect(assertPublicWebhookUrl("http://127.0.0.1/x")).rejects.toThrow();
    await expect(assertPublicWebhookUrl("http://localhost/x")).rejects.toThrow();
    await expect(assertPublicWebhookUrl("http://[::1]/x")).rejects.toThrow();
  });

  it("blocks cloud metadata 169.254.169.254", async () => {
    await expect(assertPublicWebhookUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/non-public/);
  });

  it("blocks RFC1918 private ranges", async () => {
    await expect(assertPublicWebhookUrl("http://10.0.0.5/x")).rejects.toThrow();
    await expect(assertPublicWebhookUrl("http://192.168.1.1/x")).rejects.toThrow();
    await expect(assertPublicWebhookUrl("http://172.16.0.1/x")).rejects.toThrow();
  });

  it("blocks non-http(s) schemes", async () => {
    await expect(assertPublicWebhookUrl("file:///etc/passwd")).rejects.toThrow(/scheme/);
    await expect(assertPublicWebhookUrl("gopher://10.0.0.1/x")).rejects.toThrow();
  });

  it("isPrivateAddress classifies ranges correctly", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.0.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "100.64.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "192.169.0.1", "2606:4700:4700::1111"]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});
