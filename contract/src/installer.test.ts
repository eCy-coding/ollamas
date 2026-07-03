import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderInstaller } from "./installer.ts";

const params = {
  operatorMeshUrl: "http://100.64.0.1:3000",
  token: "eyJ0b2tlbiI.sig",
  headscaleUrl: "http://mac.local:8080",
  authkey: "tskey-abc123",
  opPubHex: "ab".repeat(32),
};

test("renderInstaller: valid bash (bash -n) with all required steps", () => {
  const sh = renderInstaller(params);
  // syntax check
  const p = join(mkdtempSync(join(tmpdir(), "inst-")), "install.sh");
  writeFileSync(p, sh);
  assert.doesNotThrow(() => execFileSync("bash", ["-n", p], { stdio: "pipe" }));
  // required steps present
  assert.match(sh, /command -v node/, "node check");
  assert.match(sh, /command -v cmake/, "cmake check");
  assert.match(sh, /tailscale up .*--authkey/, "mesh join");
  assert.match(sh, /api\/contract\/cli/, "fetch CLI");
  assert.match(sh, /api\/contract\/cli\.sig/, "fetch signature");
  assert.match(sh, /bootstrap/, "run bootstrap");
});

test("renderInstaller: embeds the bundle-verify step (opPubHex) BEFORE running the CLI", () => {
  const sh = renderInstaller(params);
  assert.ok(sh.includes(params.opPubHex), "operator pubkey embedded for verify");
  // the signature-verify block must run before exec-ing the fetched CLI
  const verifyIdx = sh.indexOf("SIGNATURE VERIFY FAILED"); // unique to the verify block
  const execIdx = sh.indexOf('exec node "$DIR/contract-cli.mjs"'); // the run-the-fetched-CLI line
  assert.ok(verifyIdx >= 0, "verify block present");
  assert.ok(execIdx >= 0, "exec line present");
  assert.ok(verifyIdx < execIdx, "verify precedes exec of the fetched CLI");
});

test("renderInstaller: no authkey → mesh-join is conditional (skips, does not inject empty)", () => {
  const sh = renderInstaller({ ...params, authkey: "" });
  // when no authkey, the tailscale up line must not run with an empty key
  assert.doesNotMatch(sh, /--authkey ['"]?\s*['"]?\n/, "no empty authkey");
});
