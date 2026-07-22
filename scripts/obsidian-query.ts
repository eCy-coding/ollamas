// obsidian-query — the consumer the token mirror was written for.
//
// Until now ~/.llm-mission-control/obsidian-rest.token was written on every sync and read by
// nothing, so nobody noticed when it went stale. This is a first-class reader: eCym and any
// non-Node caller can ask the live vault a question without parsing the vault themselves.
//
// Usage:
//   tsx scripts/obsidian-query.ts <query>        search the vault, print path + context
//   tsx scripts/obsidian-query.ts --list [dir]   list vault entries
//   tsx scripts/obsidian-query.ts --read <path>  print one note
//   tsx scripts/obsidian-query.ts --health       report the surface and which credential won
//   --json                                       machine-readable output
//
// Exit codes: 0 ok · 3 obsidian unreachable or unconfigured (a caller can branch on this)
import { readFileSync } from "node:fs";
import {
  readObsidianCreds, tokenMirrorPath, defaultVault,
  obsidianHealth, vaultSearch, vaultRead, vaultList,
} from "../server/obsidian-rest";
import { resolveCreds, readPinnedCert } from "../server/obsidian-consumer";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const args = argv.filter((a) => a !== "--json");

const vault = defaultVault();
const file = readObsidianCreds(vault);
let mirror: string | null = null;
try { mirror = readFileSync(tokenMirrorPath(), "utf8"); } catch { /* no mirror yet */ }

// The certificate is read separately: readObsidianCreds() yields nothing unless the key is
// present too, which would leave a mirror-only consumer with no CA to pin.
const pinned = readPinnedCert(vault);
const resolved = resolveCreds({
  mirror, file,
  ca: file?.ca ?? pinned?.ca,
  port: file?.port ?? pinned?.port,
});

const out = (obj: unknown, human: () => string): void => {
  console.log(asJson ? JSON.stringify(obj) : human());
};

if (!resolved.creds) {
  out(
    { ok: false, source: resolved.source, reason: resolved.reason, mirrorStale: resolved.mirrorStale },
    () => `obsidian: unavailable — ${resolved.reason}`,
  );
  process.exit(3);
}

// A stale mirror is the exact cause of a 40101 and must never be silent, even on success.
if (resolved.mirrorStale && !asJson) {
  console.error(
    `warning: ${tokenMirrorPath()} disagrees with the plugin key — refresh it, ` +
    `consumers that cannot read the vault will get 40101`,
  );
}

const opts = { vault, creds: resolved.creds };

const main = async (): Promise<number> => {
  if (args.includes("--health")) {
    const h = await obsidianHealth(opts);
    out({ ...h, credentialSource: resolved.source, mirrorStale: resolved.mirrorStale },
      () => `obsidian: ok=${h.ok} port=${h.port ?? "?"} credential=${resolved.source}` +
            `${resolved.mirrorStale ? " (mirror stale)" : ""}${h.error ? ` error=${h.error}` : ""}`);
    return h.ok ? 0 : 3;
  }

  const i = args.indexOf("--read");
  if (i >= 0) {
    const path = args[i + 1];
    if (!path) { console.error("--read needs a path"); return 2; }
    const note = await vaultRead(path, opts);
    if (!note) { out({ ok: false, path }, () => `not found or vault closed: ${path}`); return 3; }
    out(note, () => String(note.content ?? ""));
    return 0;
  }

  const j = args.indexOf("--list");
  if (j >= 0) {
    const files = await vaultList(args[j + 1] ?? "", opts);
    out({ ok: true, count: files.length, files }, () => files.join("\n"));
    return files.length > 0 ? 0 : 3;
  }

  const query = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!query) { console.error("usage: obsidian-query.ts <query> | --list [dir] | --read <path> | --health"); return 2; }

  const hits = await vaultSearch(query, 10, opts);
  out({ ok: true, query, count: hits.length, hits },
    () => hits.length === 0
      ? `no match for "${query}"`
      : hits.map((h) => `${h.path}\n    ${String(h.context ?? "").replace(/\s+/g, " ").slice(0, 160)}`).join("\n"));
  return hits.length > 0 ? 0 : 3;
};

main().then((code) => process.exit(code)).catch((e) => {
  // The REST client itself degrades to null rather than throwing, so reaching here means a
  // genuine programming fault — report it plainly instead of pretending the vault is closed.
  console.error(`obsidian-query failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
