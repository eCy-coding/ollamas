import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, defaultStatePath } from "./state.ts";
import { emptyState, applyForMembership } from "./registry.ts";

const HASH = "c".repeat(64);
const NOW = "2026-07-03T10:00:00.000Z";

function tmpStatePath(): string {
  return join(mkdtempSync(join(tmpdir(), "contract-state-")), "sub", "contract.json");
}

test("missing file loads empty state without warning", () => {
  const { state, warning } = loadState(tmpStatePath());
  assert.equal(state.members.length, 0);
  assert.equal(warning, undefined);
});

test("save/load roundtrip preserves members; file mode 0600; no tmp residue", () => {
  const path = tmpStatePath();
  const { state } = applyForMembership(
    emptyState(),
    { email: "a@example.com", machinePubkey: "aa".repeat(32), specs: { ramGB: 16, os: "darwin", arch: "arm64" }, contractHash: HASH },
    HASH,
    NOW,
  );
  saveState(path, state);
  const mode = statSync(path).mode & 0o777;
  assert.equal(mode, 0o600);
  const loaded = loadState(path);
  assert.equal(loaded.state.members.length, 1);
  assert.equal(loaded.state.members[0]?.email, "a@example.com");
  const residue = readdirSync(join(path, "..")).filter((f) => f.includes(".tmp"));
  assert.equal(residue.length, 0);
});

test("corrupt file loads empty state WITH warning", () => {
  const path = tmpStatePath();
  saveState(path, emptyState());
  writeFileSync(path, "{not json!!!");
  const { state, warning } = loadState(path);
  assert.equal(state.members.length, 0);
  assert.ok(warning && /corrupt/i.test(warning));
});

test("defaultStatePath lives under ~/.ollamas", () => {
  assert.ok(defaultStatePath().endsWith("/.ollamas/contract.json"));
});
