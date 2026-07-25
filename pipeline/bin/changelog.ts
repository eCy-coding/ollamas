#!/usr/bin/env -S npx tsx
// changelog — generate a source-derived CHANGELOG.md ("what's new", 5.7) from git history.
// Groups the pipeline-relevant commits by conventional type; nothing hand-written, so it stays fresh.
//   regenerate: npx tsx pipeline/bin/changelog.ts   ·   check: --verify
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");

const TYPES: Array<[RegExp, string]> = [
  [/^feat/i, "✨ Features"],
  [/^fix/i, "🐛 Fixes"],
  [/^docs/i, "📝 Docs"],
  [/^(refactor|perf|chore|test)/i, "🔧 Internal"],
];

/** Recent pipeline/help commits: `<sha> <subject>`. Bounded so the changelog stays readable. */
function commits(limit = 40): Array<{ sha: string; subject: string }> {
  const out = execFileSync("git", ["log", `-${limit}`, "--pretty=%h\t%s", "--", "pipeline", "web/help", "ARCHITECTURE.md"], {
    cwd: REPO, encoding: "utf8",
  });
  return out.split("\n").filter(Boolean).map((l) => {
    const [sha, ...rest] = l.split("\t");
    return { sha, subject: rest.join("\t") };
  });
}

function render(): string {
  const cs = commits();
  const L = [
    "# Changelog — eCyOS pipeline (what's new)",
    "",
    "> Source-derived from git history (regenerate: `npx tsx pipeline/bin/changelog.ts`). Newest first.",
    "",
  ];
  for (const [re, title] of TYPES) {
    const rows = cs.filter((c) => re.test(c.subject));
    if (!rows.length) continue;
    L.push(`## ${title}`, "");
    for (const c of rows) L.push(`- \`${c.sha}\` ${c.subject.replace(/\s*\n.*/s, "")}`);
    L.push("");
  }
  return L.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const md = render();
  if (process.argv.includes("--verify")) {
    const n = (md.match(/^- `/gm) || []).length;
    console.log(`changelog: ${n} giriş`);
    process.exit(n > 0 ? 0 : 1);
  }
  writeFileSync(join(REPO, "pipeline", "CHANGELOG.md"), md, "utf8");
  console.log(`yazıldı: pipeline/CHANGELOG.md (${(md.match(/^- `/gm) || []).length} giriş)`);
}
