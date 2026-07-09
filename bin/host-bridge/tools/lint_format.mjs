#!/usr/bin/env node
// @ts-check
// lint_format — typecheck gate (tsc --noEmit). typescript is a devDep absent
// from the runtime container, so it runs in the builder-target image.
// Efficiency: only rebuild that image when Dockerfile/package*.json change
// (hash-stamped); otherwise reuse the cached `ollamas-lint` image.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import os from "node:os";
import { bridgeRun, REPO, emit, main } from "./lib/bridge-client.mjs";

main(async () => {
  // Hash the inputs that affect the builder image.
  const inputs = ["Dockerfile", "package.json", "package-lock.json"]
    .map((f) => { try { return readFileSync(join(REPO, f)); } catch { return Buffer.alloc(0); } });
  const hash = createHash("sha256").update(Buffer.concat(inputs)).digest("hex").slice(0, 16);
  const stampFile = join(os.homedir(), ".llm-mission-control", ".lint-image-hash");
  const cached = existsSync(stampFile) ? readFileSync(stampFile, "utf8").trim() : "";

  // Build only if inputs changed or the image is missing.
  const needBuild = cached !== hash;
  const buildPart = needBuild
    ? `docker build -q --target builder -t ollamas-lint ${REPO} >/dev/null 2>&1 && `
    : `(docker image inspect ollamas-lint >/dev/null 2>&1 || docker build -q --target builder -t ollamas-lint ${REPO} >/dev/null 2>&1) && `;
  const r = await bridgeRun(`cd ${REPO} && ${buildPart}docker run --rm ollamas-lint npx tsc --noEmit 2>&1 | tail -20`, { timeoutMs: 240000 });
  if (needBuild && r.exitCode === 0) writeFileSync(stampFile, hash);

  const out = (r.output || "").trim();
  const clean = r.exitCode === 0 && !r.timedOut && !/error TS\d+/.test(out);
  emit({ ok: clean, clean, rebuilt: needBuild, errors: out.split("\n").filter((l) => /error TS\d+/.test(l)).slice(0, 10), tail: out.slice(-200) });
});
