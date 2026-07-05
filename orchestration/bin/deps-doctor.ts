#!/usr/bin/env tsx
/**
 * orchestration/bin/deps-doctor.ts — check the project's Homebrew/macOS deps against the root Brewfile,
 * report present/missing per tier, and (opt-in) install the missing ones (iter-10).
 *
 * Run:
 *   tsx orchestration/bin/deps-doctor.ts            # report → DEPS_DOCTOR.md (+ exit 1 if a core dep is missing)
 *   tsx orchestration/bin/deps-doctor.ts --json     # machine output
 *   tsx orchestration/bin/deps-doctor.ts --install  # `brew bundle` the whole Brewfile (system mutation, opt-in)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBrewfile, classify, summarize } from "./lib/deps";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const BREWFILE = join(REPO, "Brewfile");
const JSON_OUT = process.argv.includes("--json");
const INSTALL = process.argv.includes("--install");

/** presence via a login shell so brew/mise PATH is loaded (launchd/CI-safe). */
function present(bin: string): boolean {
  try { execFileSync("bash", ["-lc", `command -v ${bin}`], { stdio: "ignore", timeout: 5000 }); return true; }
  catch { return false; }
}

function main(): void {
  if (!existsSync(BREWFILE)) { console.error("[deps-doctor] Brewfile yok"); process.exit(1); }
  const deps = parseBrewfile(readFileSync(BREWFILE, "utf8"));
  const statuses = classify(deps, present);
  const sum = summarize(statuses);
  const missing = statuses.filter((s) => !s.present);

  if (INSTALL) {
    if (!missing.length) { console.log("[deps-doctor] hepsi kurulu — install atlandı"); }
    else {
      console.error(`[deps-doctor] brew bundle → ${missing.length} eksik kuruluyor…`);
      try { execFileSync("brew", ["bundle", `--file=${BREWFILE}`], { stdio: "inherit", cwd: REPO }); }
      catch (e) { console.error("[deps-doctor] brew bundle hata:", (e as Error).message); process.exit(1); }
    }
    return;
  }

  if (JSON_OUT) { console.log(JSON.stringify({ ...sum, missing: missing.map((m) => ({ name: m.name, tier: m.tier, bin: m.bin, severity: m.severity })) })); return; }

  const md = [
    `# DEPS_DOCTOR — Homebrew/macOS bağımlılıkları`,
    ``,
    `**present ${sum.present}/${sum.total}** · missing ${sum.missing} (core-block ${sum.missingBlock}) · ` +
      `install: \`ollamas deps --install\` (veya \`brew bundle\`)`,
    ``,
    ...(missing.length ? [`## Eksik`, ...missing.map((m) => `- ${m.severity === "BLOCK" ? "🛑" : "⚠️"} \`${m.name}\` (${m.tier}) → \`brew install ${m.cask ? "--cask " : ""}${m.name}\``), ``] : [`✅ tüm bağımlılıklar kurulu.`, ``]),
    `> node = mise, git/curl = Xcode CLT (external-managed, Brewfile-dışı). macOS built-in'ler (osascript/`,
    `> launchctl/plutil/codesign) hep mevcut; gereklilik = Automation/TCC izni (host-bridge hallediyor).`,
  ].join("\n");
  writeFileSync(join(ORCH_DIR, "DEPS_DOCTOR.md"), md + "\n");
  process.stdout.write(md + "\n");
  console.error(`[deps-doctor] present ${sum.present}/${sum.total} · missing ${sum.missing} (block ${sum.missingBlock})`);
  if (sum.missingBlock > 0) process.exit(1); // a missing core dep is a real boot blocker
}

main();
