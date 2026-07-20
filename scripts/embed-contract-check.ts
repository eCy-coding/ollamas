#!/usr/bin/env npx tsx
// F0 evidence gate — do ollamas, eCym and odysseus embed into ONE vector space?
//
// The three systems each reach an embedding endpoint independently. Before F0 they did
// NOT agree: eCym applied nomic's task prefixes and L2-normalized, ollamas did neither,
// and odysseus's configured :11436 has no listener so it had silently fallen back to
// 384-d fastembed. Every downstream formula (p_ret softmax, federated merge) compares
// scores across these systems, which is meaningless unless the spaces coincide.
//
// This script measures, it does not assume. Exit 1 if any REACHABLE system disagrees.
// An unreachable system is reported as such and does not fake a pass.
//
//   npx tsx scripts/embed-contract-check.ts
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveEmbedder } from "../server/rag";
import { EMBED_CONTRACT, applyEmbedPrefix, embedFingerprint, type EmbedRole } from "../server/embed-contract";

const PROBE = "brain encoder contract probe: espresso ritual";
const TOL = 0.999; // cosine below this = different space

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
const norm = (v: number[]) => Math.hypot(...v);

interface Probe { name: string; ok: boolean; note: string; vec?: number[] }

/** ollamas — the in-process contract embedder (server/rag.ts resolveEmbedder). */
async function probeOllamas(role: EmbedRole): Promise<Probe> {
  try {
    const r = resolveEmbedder();
    const vec = await r.embed(PROBE, role);
    return { name: "ollamas", ok: true, note: r.providerId, vec };
  } catch (e: any) {
    return { name: "ollamas", ok: false, note: `embed failed: ${e?.message ?? e}` };
  }
}

/** eCym — replicates ~/.local/bin/ecy-brain exactly: prefix, POST :11434, then normalize. */
async function probeEcym(role: EmbedRole): Promise<Probe> {
  const host = process.env.ECY_OLLAMA || "http://127.0.0.1:11434";
  const model = process.env.ECY_EMBED_MODEL || "nomic-embed-text";
  try {
    const res = await fetch(`${host}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: applyEmbedPrefix(PROBE, role, model) }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { name: "eCym", ok: false, note: `HTTP ${res.status}` };
    const raw: number[] = (await res.json())?.embedding ?? [];
    if (!raw.length) return { name: "eCym", ok: false, note: "empty vector" };
    const n = norm(raw) || 1;
    return {
      name: "eCym",
      ok: true,
      note: embedFingerprint({ provider: "ollama-local", model, host }),
      vec: raw.map((x) => x / n),
    };
  } catch (e: any) {
    return { name: "eCym", ok: false, note: `unreachable: ${e?.message ?? e}` };
  }
}

/** odysseus — its CONFIGURED endpoint, read from app/.env. Reports the live truth,
 *  including the pre-F1 state where :11436 has no listener. */
async function probeOdysseus(role: EmbedRole): Promise<Probe> {
  const envPath = join(homedir(), "pinokio/api/odysseus.pinokio.git/app/.env");
  if (!existsSync(envPath)) return { name: "odysseus", ok: false, note: `no .env at ${envPath}` };
  const env = readFileSync(envPath, "utf-8");
  const pick = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  const url = pick("EMBEDDING_URL");
  const model = pick("EMBEDDING_MODEL") || "nomic-embed-text";
  if (!url) return { name: "odysseus", ok: false, note: "EMBEDDING_URL unset" };
  try {
    // OpenAI-compat shape (what odysseus's EmbeddingClient posts).
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: [applyEmbedPrefix(PROBE, role, model)] }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { name: "odysseus", ok: false, note: `${url} → HTTP ${res.status}` };
    const raw: number[] = (await res.json())?.data?.[0]?.embedding ?? [];
    if (!raw.length) return { name: "odysseus", ok: false, note: `${url} → empty vector` };
    const n = norm(raw) || 1;
    return { name: "odysseus", ok: true, note: `${url} ${model}`, vec: raw.map((x) => x / n) };
  } catch (e: any) {
    return { name: "odysseus", ok: false, note: `${url} unreachable (${e?.name ?? "error"}) — pre-F1 state` };
  }
}

async function main() {
  console.log(`contract: ${EMBED_CONTRACT}`);
  console.log(`probe:    "${PROBE}"\n`);

  let failed = false;

  for (const role of ["document", "query"] as EmbedRole[]) {
    const probes = [await probeOllamas(role), await probeEcym(role), await probeOdysseus(role)];
    console.log(`── role=${role} ─────────────────────────────`);
    for (const p of probes) {
      if (!p.ok || !p.vec) { console.log(`  ${p.name.padEnd(9)} UNREACHABLE  ${p.note}`); continue; }
      console.log(`  ${p.name.padEnd(9)} dim=${p.vec.length} ‖v‖=${norm(p.vec).toFixed(6)}  ${p.note}`);
      if (Math.abs(norm(p.vec) - 1) > 1e-6) {
        console.log(`  ${" ".repeat(9)} FAIL: not unit-norm — cosine identities break`);
        failed = true;
      }
    }

    const live = probes.filter((p) => p.ok && p.vec);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (a.vec!.length !== b.vec!.length) {
          console.log(`  ${a.name}↔${b.name}: DIM MISMATCH ${a.vec!.length} vs ${b.vec!.length} — different spaces`);
          failed = true;
          continue;
        }
        const cos = dot(a.vec!, b.vec!);
        const verdict = cos >= TOL ? "OK" : "FAIL";
        if (cos < TOL) failed = true;
        console.log(`  ${a.name}↔${b.name}: cos=${cos.toFixed(6)} ${verdict} (floor ${TOL})`);
      }
    }
    // A shared space needs document≠query too — identical vectors mean the prefix
    // never reached the endpoint, i.e. the contract is wired but inert.
    console.log("");
  }

  // Asymmetry check: nomic's prefixes must actually change the vector.
  const [d, q] = [await probeOllamas("document"), await probeOllamas("query")];
  if (d.ok && q.ok && d.vec && q.vec) {
    const cos = dot(d.vec, q.vec);
    console.log(`── prefix is live ──────────────────────────`);
    console.log(`  ollamas document↔query cos=${cos.toFixed(6)} ${cos < 0.9999 ? "OK (prefix applied)" : "FAIL (prefix inert)"}`);
    if (cos >= 0.9999) failed = true;
  }

  console.log(`\n${failed ? "FAIL" : "PASS"} — embed contract ${EMBED_CONTRACT}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
