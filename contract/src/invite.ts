// Operator-minted, single-use, short-TTL invite token (vK17). An invite is the
// operator's pre-signed consent for a device to auto-activate as a pool member —
// reconciling "immediate onboarding" with "operator approves every member": minting
// (behind adminGuard) IS the approval. Reuses ed25519 sign/verify (identity.ts).
//
// token = base64url(payloadJson) + "." + signatureHex   (signature covers the b64 body)
// The server verifies: operator signature, not-expired, contract-hash match, epoch
// match (rotating the operator key bumps epoch → invalidates ALL outstanding invites).
// Single-use (jti) is tracked in registry state, not here (this module is pure/stateless).
import { signPayload, verifyPayload } from "./identity.ts";

export type InvitePayload = {
  v: 1;
  jti: string; // unique id → single-use replay guard (registry tracks redeemed jtis)
  iat: string; // issued-at ISO
  expiresAt: string; // ISO; keep short (≤10m, RISK-K17)
  quotaReqPerDay: number;
  allowedModel?: string;
  contractHash: string; // must match the current ToS hash at redemption
  serverUrl: string; // operator pool URL the device applies to
  epoch: number; // operator-key epoch; server rejects stale epochs (kill switch, RISK-K20)
  // vK19 one-click: mesh creds + operator pubkey travel INSIDE the signed body so a
  // single artifact carries everything a fresh device needs (chicken-egg resolved).
  headscaleUrl?: string; // mesh coordination server (device runs `tailscale up --login-server`)
  authkey?: string; // fresh headscale preauth key (bearer secret; short-TTL+single-use, RISK-K17)
  opPubHex?: string; // operator ed25519 pubkey → device verifies the signed CLI bundle before exec (RISK-K21)
};

export function mintInvite(payload: InvitePayload, operatorPrivPem: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signPayload(operatorPrivPem, body);
  return `${body}.${sig}`;
}

export type VerifyResult = { valid: boolean; payload?: InvitePayload; reason?: string };

export function verifyInvite(
  token: string,
  operatorPubHex: string,
  nowMs: number,
  contractHash: string,
  serverEpoch: number,
): VerifyResult {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return { valid: false, reason: "malformed token" };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!verifyPayload(operatorPubHex, body, sig)) return { valid: false, reason: "bad signature" };
  let payload: InvitePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as InvitePayload;
  } catch {
    return { valid: false, reason: "malformed payload" };
  }
  if (payload.v !== 1) return { valid: false, reason: `unsupported invite version ${payload.v}` };
  if (payload.epoch !== serverEpoch) return { valid: false, reason: `stale epoch (invite ${payload.epoch} != operator ${serverEpoch})` };
  if (payload.contractHash !== contractHash) return { valid: false, reason: "contract hash mismatch — invite for a different contract" };
  const exp = Date.parse(payload.expiresAt);
  if (!Number.isFinite(exp) || nowMs >= exp) return { valid: false, reason: "invite expired" };
  return { valid: true, payload };
}
