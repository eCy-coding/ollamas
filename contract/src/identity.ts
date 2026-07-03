// ed25519 machine identity — pattern from tunnel/src/keystore.ts (re-implemented,
// not imported: lanes stay isolated and zero-dep). Public key travels as SPKI DER hex.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

export type Identity = { publicKeyHex: string; privateKeyPem: string };

export function generateIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyHex: publicKey.export({ format: "der", type: "spki" }).toString("hex"),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

export function signPayload(privateKeyPem: string, payload: string): string {
  const key = createPrivateKey(privateKeyPem);
  return sign(null, Buffer.from(payload, "utf8"), key).toString("hex");
}

/** Never throws — malformed keys/signatures verify as false. */
export function verifyPayload(publicKeyHex: string, payload: string, signatureHex: string): boolean {
  try {
    if (!/^[0-9a-f]+$/i.test(publicKeyHex) || publicKeyHex.length % 2 !== 0) return false;
    const key = createPublicKey({ key: Buffer.from(publicKeyHex, "hex"), format: "der", type: "spki" });
    return verify(null, Buffer.from(payload, "utf8"), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
