// `ollamas backup` — manage the gateway's encrypted config backup from the terminal
// (CI / cron / disaster-recovery). Thin client over /api/backup/* — choke-point
// HTTP only, never imports the registry. The downloaded blob is opaque AES-GCM
// ciphertext (the gateway holds the key); the CLI writes it verbatim, 0600.
//   ollamas backup config                    show backup settings (accessKey masked)
//   ollamas backup config --type s3 --endpoint … --bucket … --access-key … --secret-key … [--interval N] [--enabled]
//   ollamas backup trigger                   run a backup now
//   ollamas backup download [--out file]     save the encrypted blob (0600)
//   ollamas backup restore <file> [--yes]    restore from a blob — DESTRUCTIVE
import { parseArgs } from "node:util";
import { writeFileSync, readFileSync } from "node:fs";
import { GatewayClient } from "../lib/client";
import { loadConfig } from "../lib/config";
import { resolveOutputCtx, c, type OutputCtx } from "../lib/output";
import { confirm } from "../lib/io";
import { formatBackupConfig, summarizeReport, backupOutName } from "../lib/backup";

const HELP = `ollamas backup <action> — gateway encrypted config backup

  config                              show backup settings (accessKey masked)
  config --type s3 --endpoint <u> --bucket <b> --access-key <k> --secret-key <s> [--interval <min>] [--enabled]
                                      set backup destination + schedule
  trigger                             run a backup now
  download [--out <file>]             save the encrypted blob (0600; default backup-<time>.enc)
  restore <file> [--yes]              restore config from a blob — DESTRUCTIVE (overwrites)

auth: set OLLAMAS_SAAS_ADMIN (X-Admin-Token) on an enforced gateway.
flags: --json, --help`;

export async function runBackup(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      type: { type: "string" },
      endpoint: { type: "string" },
      bucket: { type: "string" },
      "access-key": { type: "string" },
      "secret-key": { type: "string" },
      interval: { type: "string" },
      enabled: { type: "boolean" },
      out: { type: "string" },
      yes: { type: "boolean", short: "y" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP + "\n");
    return values.help ? 0 : 2;
  }

  const cfg = loadConfig();
  const client = new GatewayClient(cfg.gateway, cfg.apiKey, cfg.saasAdminToken);
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);
  const [action, arg1] = positionals;

  try {
    switch (action) {
      case "config":
        return await runConfig(client, values, ctx);
      case "trigger":
        return await runTrigger(client, ctx);
      case "download":
        return await runDownload(client, values, ctx);
      case "restore":
        return await runRestore(client, arg1, values, ctx);
    }
    process.stderr.write(`backup: unknown action '${action}'\n` + HELP + "\n");
    return 2;
  } catch (e: any) {
    process.stderr.write(c("red", `backup error: ${String(e?.message || e)}`, ctx.color) + "\n");
    return 1;
  }
}

// Any --<setting> flag present → POST a full config; otherwise just show it. A
// merge-set is impossible: the gateway never returns secretKey and masks accessKey.
function hasSetFlags(v: any): boolean {
  return ["type", "endpoint", "bucket", "access-key", "secret-key", "interval", "enabled"].some((k) => v[k] !== undefined);
}

async function runConfig(client: GatewayClient, v: any, ctx: OutputCtx): Promise<number> {
  if (hasSetFlags(v)) {
    const body: Record<string, any> = {};
    if (v.type !== undefined) body.type = v.type;
    if (v.endpoint !== undefined) body.endpoint = v.endpoint;
    if (v.bucket !== undefined) body.bucket = v.bucket;
    if (v["access-key"] !== undefined) body.accessKey = v["access-key"];
    if (v["secret-key"] !== undefined) body.secretKey = v["secret-key"];
    if (v.interval !== undefined) body.intervalMinutes = Number(v.interval);
    if (v.enabled !== undefined) body.enabled = !!v.enabled;
    const r = await client.setBackupConfig(body);
    if (ctx.json) return json(r);
    process.stdout.write(c("green", "backup config updated", ctx.color) + "\n");
    return 0;
  }
  const cfg = await client.getBackupConfig();
  if (ctx.json) return json(cfg);
  process.stdout.write(formatBackupConfig(cfg, ctx) + "\n");
  return 0;
}

async function runTrigger(client: GatewayClient, ctx: OutputCtx): Promise<number> {
  const report = await client.triggerBackup();
  if (ctx.json) return json(report);
  process.stdout.write(summarizeReport(report) + "\n");
  return report.success === false ? 1 : 0;
}

async function runDownload(client: GatewayClient, v: any, ctx: OutputCtx): Promise<number> {
  const blob = await client.downloadBackup();
  // The blob is opaque ciphertext — never print it to a TTY (it is not human
  // content and floods the terminal). Default to a 0600 file.
  if (v.out || !process.stdout.isTTY || ctx.json) {
    const out = v.out || backupOutName(new Date().toISOString());
    if (ctx.json && !v.out) {
      // --json with no --out: emit a small receipt, not the blob.
      return json({ ok: true, bytes: blob.length, hint: "pass --out to save the encrypted blob" });
    }
    writeFileSync(out, blob, { mode: 0o600 });
    if (ctx.json) return json({ ok: true, file: out, bytes: blob.length });
    process.stdout.write(c("green", `saved ${blob.length} bytes → ${out}`, ctx.color) + c("dim", " (encrypted, 0600)", ctx.color) + "\n");
    return 0;
  }
  // Interactive TTY with no --out: refuse to dump the blob; tell the user how to save.
  process.stderr.write(c("yellow", "backup download: the blob is encrypted binary — pass --out <file> to save it\n", ctx.color));
  return 2;
}

async function runRestore(client: GatewayClient, file: string | undefined, v: any, ctx: OutputCtx): Promise<number> {
  if (!file) {
    process.stderr.write("backup restore: missing <file>\n");
    return 2;
  }
  let blob: string;
  try {
    blob = readFileSync(file, "utf8").trim();
  } catch (e: any) {
    process.stderr.write(c("red", `backup restore: cannot read ${file}: ${String(e?.message || e)}`, ctx.color) + "\n");
    return 2;
  }
  // Restore OVERWRITES the live config — HIL gate. --json is non-interactive and
  // must carry --yes (no silent destructive op).
  if (!v.yes) {
    if (ctx.json) {
      process.stderr.write("backup restore: refusing a destructive restore without --yes (non-interactive)\n");
      return 2;
    }
    const ok = await confirm(c("yellow", `restore OVERWRITES the gateway config from ${file}. proceed? [y/N] `, ctx.color));
    if (!ok) {
      process.stdout.write(c("dim", "aborted", ctx.color) + "\n");
      return 0;
    }
  }
  const r = await client.restoreBackup(blob);
  if (ctx.json) return json(r);
  process.stdout.write(c("green", "backup restored", ctx.color) + "\n");
  return 0;
}

function json(data: any): number {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  return 0;
}
