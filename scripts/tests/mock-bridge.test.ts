// Scripts domain v2 — over-the-wire signing parity against a mock bridge.
// Complements hmac-parity.test.ts (unit) by proving a server-signed HTTP
// request is accepted by the bridge auth path, and a tampered one is rejected.
import { describe, test, expect, afterEach } from "vitest";
import { signRequest } from "../../server/bridge-hmac";
import { startMockBridge } from "./helpers/mock-bridge.mjs";

const SECRET = "wire-secret";
let bridge: Awaited<ReturnType<typeof startMockBridge>> | null = null;

afterEach(async () => {
  await bridge?.close();
  bridge = null;
});

async function postSigned(url: string, path: string, payload: unknown, mutate?: (s: string) => string) {
  const body = JSON.stringify(payload);
  const { signature, timestamp, nonce } = signRequest(SECRET, "POST", path, body);
  return fetch(url + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bridge-signature": mutate ? mutate(signature) : signature,
      "x-bridge-timestamp": timestamp,
      "x-bridge-nonce": nonce,
    },
    body,
  });
}

describe("mock bridge HMAC wire parity", () => {
  test("/health needs no auth", async () => {
    bridge = await startMockBridge({ secret: SECRET });
    const r = await fetch(bridge.url + "/health");
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  test("server-signed POST /run is accepted", async () => {
    bridge = await startMockBridge({ secret: SECRET });
    const r = await postSigned(bridge.url, "/run", { command: "echo hi", target: "iterm2" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.exitCode).toBe(0);
  });

  test("tampered signature is rejected with 401", async () => {
    bridge = await startMockBridge({ secret: SECRET });
    const r = await postSigned(bridge.url, "/exec", { command: "ls" }, (s) =>
      s.slice(0, -1) + (s.endsWith("0") ? "1" : "0"),
    );
    expect(r.status).toBe(401);
  });

  test("missing signature is rejected when secret is set", async () => {
    bridge = await startMockBridge({ secret: SECRET });
    const r = await fetch(bridge.url + "/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "ls" }),
    });
    expect(r.status).toBe(401);
  });
});
