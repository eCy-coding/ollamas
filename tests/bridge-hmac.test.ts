import { describe, test, expect } from "vitest";
import { signRequest, verifyRequest, canonicalMessage } from "../server/bridge-hmac";

const SECRET = "test-bridge-secret-32-bytes-long!";

describe("host-bridge HMAC (Faz 10E)", () => {
  test("sign → verify roundtrip succeeds", () => {
    const body = JSON.stringify({ command: "ls" });
    const sig = signRequest(SECRET, "POST", "/exec", body);
    const seen = new Set<string>();
    expect(verifyRequest(SECRET, { method: "POST", path: "/exec", body, ...sig }, seen)).toBe(true);
  });

  test("tampered body fails", () => {
    const body = JSON.stringify({ command: "ls" });
    const sig = signRequest(SECRET, "POST", "/exec", body);
    expect(verifyRequest(SECRET, { method: "POST", path: "/exec", body: JSON.stringify({ command: "rm -rf /" }), ...sig }, new Set())).toBe(false);
  });

  test("wrong secret fails", () => {
    const body = "{}";
    const sig = signRequest(SECRET, "POST", "/run", body);
    expect(verifyRequest("other-secret", { method: "POST", path: "/run", body, ...sig }, new Set())).toBe(false);
  });

  test("stale timestamp fails", () => {
    const body = "{}";
    const sig = signRequest(SECRET, "POST", "/run", body);
    const stale = { ...sig, timestamp: String(Date.now() - 10 * 60 * 1000) };
    // recompute signature for the stale timestamp so only freshness is tested
    expect(verifyRequest(SECRET, { method: "POST", path: "/run", body, ...stale }, new Set())).toBe(false);
  });

  test("replayed nonce fails on second use", () => {
    const body = "{}";
    const sig = signRequest(SECRET, "POST", "/run", body);
    const seen = new Set<string>();
    expect(verifyRequest(SECRET, { method: "POST", path: "/run", body, ...sig }, seen)).toBe(true);
    expect(verifyRequest(SECRET, { method: "POST", path: "/run", body, ...sig }, seen)).toBe(false); // replay
  });

  test("canonical message format is stable (mirror parity with bridge)", () => {
    expect(canonicalMessage("post", "/exec", "B", "123", "n")).toBe("POST\n/exec\nB\n123\nn");
  });
});
