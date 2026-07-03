// Signed CLI bundle (vK19). The operator signs the sha256 of the distributed
// contract-cli bundle with its ed25519 key; the device verifies with the operator
// pubkey (carried in the invite) BEFORE executing the fetched code. Closes the
// trust gap (RISK-K21): the invite authenticates device→operator; this authenticates
// operator→device so a fresh box never runs an unverified/spoofed installer.
import { createHash } from "node:crypto";
import { signPayload, verifyPayload } from "./identity.ts";

export function bundleSha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function signBundle(sha256Hex: string, operatorPrivPem: string): string {
  return signPayload(operatorPrivPem, sha256Hex);
}

/** True iff `sigHex` is the operator's signature over sha256(bytes). Never throws. */
export function verifyBundle(bytes: Buffer | Uint8Array, sigHex: string, operatorPubHex: string): boolean {
  return verifyPayload(operatorPubHex, bundleSha256(bytes), sigHex);
}
