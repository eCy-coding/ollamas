// Brain TEACH (T1) — curated Python + macOS knowledge datasets, from the machine's
// own $0 sources: python3's introspection (keywords/builtins/stdlib docstrings) and
// the man-db whatis one-liners. Records land as procedural-tier knowledge
// (ns=knowledge, stable teach:* ids → idempotent re-runs refresh, never pile up).
// Write-behind keeps this immune to embedder queues. Usage: make brain-teach
import { execFileSync } from "node:child_process";
import { brainRemember, brainAssertFact } from "../server/brain";

export interface TeachRecord { id: string; content: string; actor: string; fact?: { subject: string; predicate: string; object: string } }

const PY_MODULES = [
  "os", "sys", "json", "re", "pathlib", "subprocess", "sqlite3", "asyncio", "csv",
  "datetime", "itertools", "functools", "typing", "unittest", "argparse", "logging",
  "collections", "urllib.request", "http.server", "shutil", "tempfile", "hashlib",
  "base64", "random", "math", "statistics",
];

export const MACOS_ALLOWLIST = [
  "ls", "cd", "cp", "mv", "rm", "mkdir", "cat", "grep", "find", "sed", "awk", "tar",
  "curl", "ssh", "scp", "chmod", "chown", "ps", "top", "kill", "df", "du", "diskutil",
  "launchctl", "plutil", "defaults", "mdfind", "sw_vers", "sysctl", "log", "pmset",
  "networksetup", "ifconfig", "ping", "dig", "open", "pbcopy", "pbpaste", "say",
  "screencapture", "softwareupdate", "xcode-select", "brew", "git", "make", "man",
  "which", "history", "crontab", "zip", "unzip", "head", "tail", "sort", "uniq", "wc",
  "xargs", "ln", "touch", "date", "uptime", "whoami", "hostname", "uname", "env",
  "caffeinate", "afplay", "osascript", "codesign", "spctl", "tmutil", "system_profiler",
];

/** Pure: python introspection JSON → teach records. */
export function buildPythonRecords(raw: { keywords: string[]; builtins: [string, string][]; modules: [string, string][] }): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const kw of raw.keywords.slice(0, 40)) {
    out.push({ id: `teach:python:kw-${kw}`, actor: "python", content: `Python anahtar kelimesi '${kw}' — dilin çekirdek sözdizimi ögesi.` });
  }
  for (const [name, doc] of raw.builtins.slice(0, 80)) {
    if (!doc) continue;
    out.push({ id: `teach:python:fn-${name}`, actor: "python", content: `Python builtin ${name}(): ${doc.slice(0, 200)}` });
  }
  for (const [name, doc] of raw.modules.slice(0, 30)) {
    if (!doc) continue;
    out.push({
      id: `teach:python:mod-${name.replace(/\./g, "-")}`,
      actor: "python",
      content: `Python modülü '${name}': ${doc.slice(0, 300)} — import ${name} ile kullanılır.`,
      fact: { subject: "python", predicate: "provides", object: name },
    });
  }
  return out;
}

/** Pure: whatis text + allowlist → teach records. */
export function buildMacosRecords(whatisText: string, allow: string[]): TeachRecord[] {
  const out: TeachRecord[] = [];
  const seen = new Set<string>();
  for (const line of whatisText.split("\n")) {
    // macOS whatis: "name(1), alias(1)   - description" and keyword-matches leak in —
    // only lines whose OWN name list contains an allowlisted command count.
    const parts = line.split(/\s+-\s+/);
    if (parts.length < 2) continue;
    const names = [...parts[0].matchAll(/([\w.+-]+)\(\d/g)].map((m) => m[1]);
    const cmd = names.find((n) => allow.includes(n));
    if (!cmd || seen.has(cmd)) continue;
    seen.add(cmd);
    const desc = parts.slice(1).join(" - ");
    out.push({
      id: `teach:macos:${cmd}`,
      actor: "macos",
      content: `macOS komutu '${cmd}': ${desc.slice(0, 200)}. Terminalde \`${cmd}\` olarak çalıştırılır.`,
      fact: { subject: "macos", predicate: "has_command", object: cmd },
    });
  }
  return out;
}

async function main() {
  const pyJson = execFileSync("python3", ["-c", `
import json, keyword, builtins, importlib
b = []
for n in dir(builtins):
    if n.startswith('_'): continue
    d = getattr(builtins, n).__doc__ or ''
    b.append([n, d.split('\\n')[0]])
mods = []
for m in ${JSON.stringify(PY_MODULES)}:
    try:
        mod = importlib.import_module(m)
        d = (mod.__doc__ or '').strip().split('\\n')[0]
        mods.append([m, d])
    except Exception: pass
print(json.dumps({'keywords': keyword.kwlist, 'builtins': b, 'modules': mods}))
`], { timeout: 20000 }).toString();
  const py = buildPythonRecords(JSON.parse(pyJson));
  // whatis scans man-db per term (~0.6s each) — one 76-term call blows any timeout.
  // Parallel 8-term batches finish in seconds; a failing batch still yields stdout.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const runB = promisify(execFile);
  const batches: string[][] = [];
  for (let i = 0; i < MACOS_ALLOWLIST.length; i += 8) batches.push(MACOS_ALLOWLIST.slice(i, i + 8));
  const chunks = await Promise.all(
    batches.map((b) =>
      runB("bash", ["-c", `whatis ${b.join(" ")} 2>/dev/null`], { timeout: 30000 })
        .then((r) => r.stdout)
        .catch((e: any) => e?.stdout?.toString?.() || ""),
    ),
  );
  const whatis = chunks.join("\n");
  const mac = buildMacosRecords(whatis, MACOS_ALLOWLIST);
  let mem = 0, facts = 0;
  for (const r of [...py, ...mac]) {
    await brainRemember({ id: r.id, tier: "procedural", content: r.content, source: "teach-datasets", ns: "knowledge", actor: r.actor });
    mem++;
    if (r.fact) {
      try { const f = await brainAssertFact({ ...r.fact, ns: "default" }); if (f.changed) facts++; } catch { /* embedder queued — nightly */ }
    }
  }
  console.log(JSON.stringify({ event: "brain.teach", python: py.length, macos: mac.length, memories: mem, facts }));
}

if (process.argv[1]?.includes("brain-teach-datasets")) void main();
