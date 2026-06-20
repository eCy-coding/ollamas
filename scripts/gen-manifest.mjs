#!/usr/bin/env node
// Generates artifacts/manifest.json — the single discovery index for every
// compiled native binary (artifacts/bin/), plus pointers to the JS bundles
// (dist/) and the host-bridge tools (bin/host-bridge/tools). Run by
// `make build-all` and `make manifest`. Pure Node stdlib, zero deps.
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ART = join(ROOT, "artifacts");
const BIN = join(ART, "bin");

// Source-of-truth for the four heterogeneous backend binaries. Names are the
// kebab-case artifacts/bin/ output names produced by the Makefile.
const BINARIES = [
  { name: "p2p-network",           lang: "go",   src: "backend/mesh/p2p_network.go",                    role: "p2p Kademlia DHT peer discovery" },
  { name: "hardware-orchestrator", lang: "rust", src: "backend/orchestrator/hardware_orchestrator.rs", role: "GPU memory mapper + L7 context lock" },
  { name: "secure-sandbox",        lang: "rust", src: "backend/sandbox/secure_sandbox.rs",             role: "WASM/WASI command guardrails" },
  { name: "idle-daemon",           lang: "c",    src: "backend/daemon/idle_daemon.c",                  role: "CPU idle-time throttle monitor" },
];

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const binaries = BINARIES.map((b) => {
  const abs = join(BIN, b.name);
  const built = existsSync(abs);
  return {
    ...b,
    file: built ? `artifacts/bin/${b.name}` : null,
    built,
    sha256: built ? sha256(abs) : null,
    size: built ? statSync(abs).size : 0,
  };
});

const manifest = {
  schema: "ollamas/artifacts@1",
  generatedAt: new Date().toISOString(),
  binaries,
  hostTools: { dir: "bin/host-bridge/tools" },
  dist: { dir: "dist", server: "dist/server.cjs", mcpStdio: "dist/mcp-stdio.cjs" },
};

mkdirSync(ART, { recursive: true });
writeFileSync(join(ART, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const built = binaries.filter((b) => b.built).length;
console.log(`[manifest] artifacts/manifest.json — ${built}/${binaries.length} native binaries indexed`);
