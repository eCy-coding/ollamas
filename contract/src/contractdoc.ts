// Contract document (ToS) rendering + canonical hashing.
// The hash is what a joining machine "signs" (accepts); if the document text
// changes, the hash changes and existing applicants must re-accept.
import { createHash } from "node:crypto";

export const CONTRACT_VERSION = "1.0.0";

export function renderContract(): string {
  return `# ollamas Compute Pool Contract (v${CONTRACT_VERSION})

## 1. Parties
This agreement is between the ollamas pool operator ("Operator") and the owner
of the joining machine ("Member"). Membership is per-machine, identified by an
ed25519 public key, with an email address as contact identity. The email is
stored locally by the Operator only and is never sent to third parties.

## 2. What the Member provides
- Idle compute (CPU/GPU/RAM) of the registered machine for running LLM
  inference workloads scheduled by the pool.
- Truthful machine specs (RAM, OS, architecture) and periodic heartbeats.

## 3. What the Member receives
- One API key issued after Operator approval. The key grants access to the
  pooled inference API under a per-day request quota.
- The raw API key is shown exactly once at approval time; only a hash is
  retained server-side. Lost keys are re-issued via revoke + re-approve.

## 4. Key pool and scheduling
- Approved machines join the compute pool ledger. The scheduler may route any
  pool request to any healthy member node, or split a model across several
  member nodes. Member nodes are reached only over private/mesh networks.

## 5. Revocation and suspension
- The Operator may suspend or revoke membership at any time (abuse, stale
  heartbeats, contract changes). Revocation invalidates the API key.
- The Member may leave at any time by requesting revocation; local data about
  the machine is then limited to the audit record.

## 6. No warranty
The pool is provided "as is", without any warranty or availability guarantee.
No payment is exchanged in either direction under this contract version.

## 7. Acceptance
Applying with this document's SHA-256 hash constitutes acceptance of the exact
text above. A different hash means a different contract.
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
