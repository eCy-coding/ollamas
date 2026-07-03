// Lane-owned append-only audit log for contract admin actions (vK13).
// Full fidelity (ts + action + memberId + keyId + actor) — the shared store
// audit_events table is tool-call-shaped and cannot carry memberId. Zero
// cross-lane risk; secret-free by construction (only whitelisted fields persist —
// raw keys / emails are structurally impossible to leak, ERR-CONTRACT-002).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type AuditAction = "apply" | "approve" | "reject" | "suspend" | "resume" | "revoke" | "rotate";

export type AuditEntry = {
  ts: string;
  action: AuditAction;
  memberId: string;
  status: string;
  actor: string;
  keyId?: string;
};

export function defaultAuditPath(): string {
  return process.env.CONTRACT_AUDIT_PATH || join(homedir(), ".ollamas", "contract-audit.jsonl");
}

/** Whitelist projection: ONLY these fields are ever written. Any extra field on
 * the input (email, rawKey, …) is dropped — leaks are impossible, not merely avoided. */
function project(entry: Omit<AuditEntry, "ts">, ts: string): AuditEntry {
  return {
    ts,
    action: entry.action,
    memberId: String(entry.memberId),
    status: String(entry.status),
    actor: String(entry.actor),
    ...(entry.keyId ? { keyId: String(entry.keyId) } : {}),
  };
}

export function recordContractAudit(entry: Omit<AuditEntry, "ts">, now: string, path = defaultAuditPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(project(entry, now)) + "\n", { mode: 0o600 });
  } catch {
    // audit is best-effort telemetry — never break the request path on a log failure
  }
}

/** Return the last `limit` entries (oldest→newest); corrupt lines skipped. */
export function readContractAudit(limit = 100, path = defaultAuditPath()): AuditEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const rows: AuditEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as AuditEntry);
    } catch {
      // skip corrupt line
    }
  }
  return rows.slice(-limit);
}
