// Contract document (ToS) rendering + canonical hashing.
// The hash is what a joining machine "signs" (accepts); if the document text
// changes, the hash changes and existing applicants must re-accept.
import { createHash } from "node:crypto";

export const CONTRACT_VERSION = "2.0.0";

export function renderContract(): string {
  return `# ollamas Compute Pool Contract (v${CONTRACT_VERSION})

## 1. Parties and solo operation
This agreement is between the ollamas pool operator ("Operator") and the owner of
a joining machine ("Member"). Membership is per-machine, identified by an ed25519
public key, with an email address as contact identity (stored locally by the
Operator only, never sent to third parties). The Operator MAY run ollamas solo on
a single computer; membership and pool participation are entirely optional. When
there are no Members, sections 2–7 (Member terms) do not apply.

## 2. What the Member provides
- Idle compute (CPU/GPU/RAM) of the registered machine for LLM inference scheduled
  by the pool, plus — optionally — an rpc-server so a single large model can be
  split across this and other machines.
- Truthful machine specs (RAM, OS, architecture) and periodic outbound heartbeats.

## 3. What the Member receives
- One API key granting access to the pooled inference API under a per-day request
  quota (section 6). The raw key is shown exactly once (at activation, or after a
  rotation); only a SHA-256 hash is retained server-side, and the ledger stores
  only a key reference, never the raw key.
- Key rotation: the Operator may issue a fresh key and revoke the old one without
  ending membership (the new key is delivered once, the old stops working).

## 4. Compute pool and multi-machine scheduling
- Approved machines join the compute pool ledger. The scheduler may route any pool
  request to any healthy member, or split one model's layers across several members
  (llama.cpp rpc-server sharding). All member endpoints are bound to and reached
  ONLY over private/mesh networks (loopback, RFC1918, CGNAT/100.64, ULA); public
  and cloud-metadata addresses are refused.

## 5. Revocation, suspension and resume
- The Operator may suspend (temporary — the key stays valid, the node leaves the
  schedulable pool) or revoke (permanent — the key is invalidated) membership at
  any time, e.g. for abuse, stale heartbeats, or contract changes. A suspended
  member may be resumed, keeping its key and tenant.
- The Member may leave at any time by requesting revocation; retained data is then
  limited to the secret-free audit record.

## 6. Quota and metering
- Each key has a per-day request cap (default 1000), enforced at the Operator
  gateway. Requests are charged on SUCCESS only — a failed inference never consumes
  quota. The counter resets at UTC midnight. Members are never trusted to self-limit.

## 7. Onboarding by invite
- The Operator may issue a signed, single-use, short-lived invite that pre-approves
  a device, which then auto-activates (no manual approval step). Minting an invite
  is the Operator's consent. Rotating the Operator key invalidates all outstanding
  invites at once (kill switch).

## 8. Data and security
- Email is contact/identity only, stored locally; no SMTP, no third-party sharing.
- API keys are hashed at rest; raw keys are delivered once and never logged.
- The audit log records administrative actions and is secret-free by construction
  (no keys, no emails).
- All compute traffic stays on private/mesh networks; nothing is exposed publicly.

## 9. No warranty, no payment
The pool is provided "as is", without any warranty or availability guarantee. No
payment is exchanged in either direction under this contract version.

## 10. Acceptance
Applying (or redeeming an invite) with this document's SHA-256 hash constitutes
acceptance of the exact text above. A different hash means a different contract;
Members and invites bound to an older hash must re-accept the current document.
`;
}

/** SHA-256 over normalized text: CRLF→LF, trailing whitespace stripped per line. */
export function canonicalHash(text: string): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function currentContractHash(): string {
  return canonicalHash(renderContract());
}
