// Calibration harness (vK18): measure the contract lane's real working principles
// and ASSERT the security/efficiency invariants still hold. Pure paths run anywhere
// (no server); live paths (apply-with-invite/generate) are driven by the cli --live.
// "Calibration complete" = measured p50/p90/p99 + all invariants PASS + tuned-constant
// recommendations. Policy constants (invite TTL, quota, breaker threshold) are NOT
// data-driven — they are security/business gates, reported but left fixed.
import { generateIdentity } from "./identity.ts";
import { mintInvite, verifyInvite, type InvitePayload } from "./invite.ts";
import {
  emptyState, applyForMembership, approveMember, markInviteUsed, isInviteUsed,
  type RegistryState,
} from "./registry.ts";
import { backoffMs } from "./breaker.ts";
import { isPrivateHost } from "./shard.ts";
import { recordHeartbeat, toFleetBackends } from "./pool.ts";
import { summarize, type Summary } from "./bench.ts";

const HASH = "c".repeat(64);

/** Time `fn` `iters` times; return per-iteration ms (perf clock). */
export function microbench(fn: () => void, iters: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  return out;
}

function samplePayload(now: number, epoch = 1): InvitePayload {
  return { v: 1, jti: `j${now}`, iat: new Date(now).toISOString(), expiresAt: new Date(now + 600000).toISOString(), quotaReqPerDay: 1000, contractHash: HASH, serverUrl: "http://100.64.0.1:3000", epoch };
}

export function runPureCalibration(opts: { iters?: number } = {}): { rows: Array<{ label: string; summary: Summary }> } {
  const iters = opts.iters ?? 200;
  const id = generateIdentity();
  const now = 1_800_000_000_000;
  const token = mintInvite(samplePayload(now), id.privateKeyPem);
  const validInput = () => ({ email: `n${Math.random()}@x.co`, machinePubkey: "aa".repeat(32), specs: { ramGB: 32, os: "darwin", arch: "arm64" }, contractHash: HASH });

  const rows: Array<{ label: string; summary: Summary }> = [
    { label: "invite.mint", summary: summarize(microbench(() => { mintInvite(samplePayload(now), id.privateKeyPem); }, iters)) },
    { label: "invite.verify", summary: summarize(microbench(() => { verifyInvite(token, id.publicKeyHex, now, HASH, 1); }, iters)) },
    { label: "registry.apply", summary: summarize(microbench(() => { applyForMembership(emptyState(), validInput(), HASH, new Date(now).toISOString()); }, iters)) },
    { label: "backoff", summary: summarize(microbench(() => { backoffMs(3, 5000, 300000); }, iters)) },
    { label: "isPrivateHost", summary: summarize(microbench(() => { isPrivateHost("100.64.0.7"); }, iters)) },
  ];
  return { rows };
}

export type InvariantResult = { passed: number; failed: Array<{ name: string; detail: string }> };

/** The 10 security + efficiency invariants a calibration must guarantee. Pure. */
export function assertInvariants(): InvariantResult {
  const failed: Array<{ name: string; detail: string }> = [];
  let passed = 0;
  const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed.push({ name, detail }); };

  const id = generateIdentity();
  const now = 1_800_000_000_000;
  const good = mintInvite(samplePayload(now), id.privateKeyPem);

  // 1 forged (wrong key) → invalid
  const other = generateIdentity();
  check("forged-invite-rejected", verifyInvite(good, other.publicKeyHex, now, HASH, 1).valid === false);
  // 2 tampered body → invalid (sig covers body)
  const [body, sig] = good.split(".");
  const tamperedBody = Buffer.from(JSON.stringify(samplePayload(now + 1)), "utf8").toString("base64url");
  check("tampered-invite-rejected", verifyInvite(`${tamperedBody}.${sig}`, id.publicKeyHex, now, HASH, 1).valid === false, `${body?.slice(0, 4)}`);
  // 3 expired → invalid
  check("expired-invite-rejected", verifyInvite(good, id.publicKeyHex, now + 700000, HASH, 1).valid === false);
  // 4 stale epoch (rotation kill switch) → invalid
  check("epoch-killswitch", verifyInvite(good, id.publicKeyHex, now, HASH, 2).valid === false);
  // 5 contract-hash mismatch → invalid
  check("contract-binding", verifyInvite(good, id.publicKeyHex, now, "d".repeat(64), 1).valid === false);
  // 6 single-use replay guard
  let st: RegistryState = markInviteUsed(emptyState(), { jti: "j1", memberId: "m_1", redeemedAt: "x", expiresAt: new Date(now + 600000).toISOString() });
  check("replay-single-use", isInviteUsed(st, "j1") === true && isInviteUsed(st, "j2") === false);
  // 7 rpc/heartbeat rejects public + metadata + wildcard
  check("private-bind-guard", isPrivateHost("100.64.0.7") && !isPrivateHost("8.8.8.8") && !isPrivateHost("169.254.169.254") && !isPrivateHost("0.0.0.0"));
  // 8 heartbeat SSRF guard rejects a public ollamaUrl (recordHeartbeat throws)
  {
    const a = applyForMembership(emptyState(), { email: "s@x.co", machinePubkey: "bb".repeat(32), specs: { ramGB: 8, os: "linux", arch: "x64" }, contractHash: HASH }, HASH, "t");
    const active = approveMember(a.state, a.member.id, { keyId: "k1", tenantId: "t1" }, "t");
    let threw = false;
    try { recordHeartbeat(active, a.member.id, { ollamaUrl: "http://8.8.8.8:11434", models: [] }, "t"); } catch { threw = true; }
    check("heartbeat-ssrf-guard", threw);
  }
  // 9 toFleetBackends idempotent (prerequisite for the dirty-check disk-write skip)
  {
    const a = applyForMembership(emptyState(), { email: "f@x.co", machinePubkey: "cc".repeat(32), specs: { ramGB: 16, os: "linux", arch: "x64" }, contractHash: HASH }, HASH, "t");
    const active = approveMember(a.state, a.member.id, { keyId: "k1", tenantId: "t1" }, "t");
    const hb = recordHeartbeat(active, a.member.id, { ollamaUrl: "http://100.64.0.7:11434", models: ["m"] }, new Date(now).toISOString());
    const one = JSON.stringify(toFleetBackends(hb, now));
    const two = JSON.stringify(toFleetBackends(hb, now));
    check("fleet-projection-idempotent", one === two);
  }
  // 10 backoff monotonic + clamped (no runaway, no shrink)
  check("backoff-monotonic-clamped", backoffMs(0, 5000, 300000) === 5000 && backoffMs(1, 5000, 300000) === 10000 && backoffMs(20, 5000, 300000) === 300000);

  return { passed, failed };
}
