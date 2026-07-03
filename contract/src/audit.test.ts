import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, appendFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordContractAudit, readContractAudit, rotateAuditIfNeeded } from "./audit.ts";
import { existsSync } from "node:fs";

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), "audit-")), "contract-audit.jsonl");
}

const NOW = "2026-07-03T10:00:00.000Z";

test("append + read roundtrip, newest last; file mode 0600", () => {
  const p = tmpPath();
  recordContractAudit({ action: "approve", memberId: "m_1", keyId: "key_1", status: "active", actor: "admin" }, NOW, p);
  recordContractAudit({ action: "revoke", memberId: "m_1", keyId: "key_1", status: "revoked", actor: "admin" }, NOW, p);
  const rows = readContractAudit(100, p);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.action, "approve");
  assert.equal(rows[1]?.action, "revoke");
  assert.equal(rows[1]?.ts, NOW);
  assert.equal(statSync(p).mode & 0o777, 0o600);
});

test("readContractAudit returns the LAST `limit` entries", () => {
  const p = tmpPath();
  for (let i = 0; i < 5; i++) recordContractAudit({ action: "apply", memberId: `m_${i}`, status: "pending", actor: "applicant" }, NOW, p);
  const rows = readContractAudit(2, p);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.memberId, "m_3");
  assert.equal(rows[1]?.memberId, "m_4");
});

test("corrupt lines are skipped, not fatal", () => {
  const p = tmpPath();
  recordContractAudit({ action: "approve", memberId: "m_1", status: "active", actor: "admin" }, NOW, p);
  appendFileSync(p, "{not json\n");
  recordContractAudit({ action: "revoke", memberId: "m_1", status: "revoked", actor: "admin" }, NOW, p);
  const rows = readContractAudit(100, p);
  assert.equal(rows.length, 2); // corrupt middle line dropped
});

test("missing file → empty, no throw", () => {
  assert.deepEqual(readContractAudit(100, join(tmpdir(), "nope-audit-xyz.jsonl")), []);
});

test("SECRET-FREE: raw keys / emails never written (ERR-CONTRACT-002)", () => {
  const p = tmpPath();
  // even if a caller mistakenly passes secret-looking fields, only whitelisted keys persist
  recordContractAudit({ action: "rotate", memberId: "m_1", keyId: "key_9", status: "active", actor: "admin", email: "a@b.co", rawKey: "olm_SECRET" } as any, NOW, p);
  const raw = readFileSync(p, "utf8");
  assert.ok(!raw.includes("olm_"), "raw key leaked into audit");
  assert.ok(!raw.includes("@"), "email leaked into audit");
  assert.ok(raw.includes("key_9") && raw.includes("m_1"));
});

test("rotateAuditIfNeeded: over cap → ring rotate; under cap no-op (G4)", () => {
  const p = tmpPath();
  // write >200 bytes
  for (let i = 0; i < 10; i++) recordContractAudit({ action: "apply", memberId: `m_${i}`, status: "pending", actor: "applicant" }, NOW, p);
  const before = readFileSync(p, "utf8").length;
  assert.ok(before > 200);
  // under cap → no-op
  assert.equal(rotateAuditIfNeeded(p, before + 1000, 3), false);
  assert.equal(existsSync(`${p}.1`), false);
  // over cap → rotate: path→.1, fresh path recreated by next record
  assert.equal(rotateAuditIfNeeded(p, 100, 3), true);
  assert.equal(existsSync(`${p}.1`), true);
  assert.equal(existsSync(p), false); // rotated away; recordContractAudit recreates it
  recordContractAudit({ action: "approve", memberId: "m_new", status: "active", actor: "admin" }, NOW, p);
  const rows = readContractAudit(100, p);
  assert.equal(rows.length, 1); // fresh file has only the new entry
  assert.equal(rows[0]?.memberId, "m_new");
});

test("recordContractAudit auto-rotates when file exceeds CONTRACT_AUDIT_MAX_BYTES", () => {
  const p = tmpPath();
  const prev = process.env.CONTRACT_AUDIT_MAX_BYTES;
  process.env.CONTRACT_AUDIT_MAX_BYTES = "50"; // tiny cap: first line (~90B) already exceeds → 2nd write rotates
  try {
    recordContractAudit({ action: "apply", memberId: "m_a", status: "pending", actor: "applicant" }, NOW, p);
    recordContractAudit({ action: "apply", memberId: "m_b", status: "pending", actor: "applicant" }, NOW, p);
    // second write should have triggered a rotation before appending
    assert.ok(existsSync(`${p}.1`));
  } finally {
    if (prev === undefined) delete process.env.CONTRACT_AUDIT_MAX_BYTES;
    else process.env.CONTRACT_AUDIT_MAX_BYTES = prev;
  }
});
