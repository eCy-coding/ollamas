import { describe, it, expect } from "vitest";
// Pure auth decision lives in hmac.mjs (terminal-bridge.mjs starts an HTTP server
// at import time, so the testable logic must be imported from the pure lib).
import { authDecision } from "../bin/host-bridge/hmac.mjs";

describe("bridge authDecision — fail-closed (C2 HMAC bypass fix)", () => {
  it("HMAC configured + no signature + no token => REJECT (the bypass hole)", () => {
    // Pre-fix this fell through to `if (!TOKEN) return true` => OPEN. Must be closed.
    expect(
      authDecision({ hmacConfigured: true, hasSignature: false, signatureValid: false, tokenConfigured: false, tokenMatches: false }),
    ).toBe(false);
  });

  it("HMAC configured + valid signature => accept (server path)", () => {
    expect(
      authDecision({ hmacConfigured: true, hasSignature: true, signatureValid: true, tokenConfigured: false, tokenMatches: false }),
    ).toBe(true);
  });

  it("HMAC configured + present-but-invalid signature => reject", () => {
    expect(
      authDecision({ hmacConfigured: true, hasSignature: true, signatureValid: false, tokenConfigured: false, tokenMatches: false }),
    ).toBe(false);
  });

  it("token configured + matching token, no signature => accept (host-tools path preserved)", () => {
    expect(
      authDecision({ hmacConfigured: true, hasSignature: false, signatureValid: false, tokenConfigured: true, tokenMatches: true }),
    ).toBe(true);
  });

  it("token configured + wrong token => reject", () => {
    expect(
      authDecision({ hmacConfigured: false, hasSignature: false, signatureValid: false, tokenConfigured: true, tokenMatches: false }),
    ).toBe(false);
  });

  it("nothing configured => open (dev convenience preserved)", () => {
    expect(
      authDecision({ hmacConfigured: false, hasSignature: false, signatureValid: false, tokenConfigured: false, tokenMatches: false }),
    ).toBe(true);
  });
});
