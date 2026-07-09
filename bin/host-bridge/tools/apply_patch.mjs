#!/usr/bin/env node
// @ts-check
// apply_patch — git apply a unified diff read from stdin (checked first).
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { bridgeRun, REPO, emit, main } from "./lib/bridge-client.mjs";

main(async () => {
  const diff = readFileSync(0, "utf8");
  if (!diff.trim()) throw new Error("diff required on stdin");
  const tmp = `/tmp/apply_${process.pid}_${diff.length}.patch`;
  writeFileSync(tmp, diff);
  try {
    const r = await bridgeRun(
      `cd ${REPO} && git apply --check ${tmp} 2>&1 && git apply ${tmp} 2>&1 && echo APPLIED || echo FAILED`,
      { timeoutMs: 20000 }
    );
    const out = (r.output || "").trim();
    emit({ ok: out.includes("APPLIED"), applied: out.includes("APPLIED"), output: out });
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
});
