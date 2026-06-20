// `ollamas saas` — operate the gateway's multi-tenant SaaS layer from the
// terminal. All calls go through /api/saas/* + /api/billing/* behind adminGuard
// (X-Admin-Token); this command never imports server/store (choke-point).
//   ollamas saas plans | tenants | keys --tenant <id> | audit
//   ollamas saas tenant new --name acme [--plan pro]
//   ollamas saas key new --tenant <id> [--label ci] [--ttl-days 30] [--scopes "tools:safe"]
//   ollamas saas key revoke <keyId>
//   ollamas saas usage [--period YYYY-MM]
//   ollamas saas billing [--period YYYY-MM] [--run]
import { parseArgs } from "node:util";
import { GatewayClient } from "../lib/client";
import { loadConfig } from "../lib/config";
import { resolveOutputCtx, formatTable, c, type OutputCtx } from "../lib/output";
import { confirm } from "../lib/io";

const HELP = `ollamas saas <action> — manage the gateway SaaS layer (admin)

  plans                              list billing plans
  tenants                            list tenants
  tenant new --name <n> [--plan <p>] [--stripe <id>]
  keys --tenant <id>                 list a tenant's API keys
  key new --tenant <id> [--label <l>] [--ttl-days <n>] [--scopes <s>]
  key revoke <keyId> [--yes]         revoke a key (prompts unless --yes/--json)
  audit [--tenant <id>] [--limit <n>]
  usage [--period YYYY-MM]           per-tenant call/token aggregate
  billing [--period YYYY-MM] [--run] preview (default) or run billing

auth: set OLLAMAS_SAAS_ADMIN or 'ollamas config saasAdminToken <token>'.
flags: --json (raw), --help`;

export async function runSaas(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      tenant: { type: "string" },
      name: { type: "string" },
      plan: { type: "string" },
      stripe: { type: "string" },
      label: { type: "string" },
      "ttl-days": { type: "string" },
      scopes: { type: "string" },
      period: { type: "string" },
      limit: { type: "string" },
      run: { type: "boolean" },
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
      case "plans":
        return await showPlans(client, ctx);
      case "tenants":
        return await showTenants(client, ctx);
      case "tenant":
        if (arg1 === "new") return await newTenant(client, values, ctx);
        break;
      case "keys":
        return await showKeys(client, values.tenant as string, ctx);
      case "key":
        if (arg1 === "new") return await newKey(client, values, ctx);
        if (arg1 === "revoke") return await revokeKey(client, positionals[2], values, ctx);
        break;
      case "audit":
        return await showAudit(client, values, ctx);
      case "usage":
        return await showUsage(client, values.period as string, ctx);
      case "billing":
        return await showBilling(client, values, ctx);
    }
    process.stderr.write(`saas: unknown action '${action}${arg1 ? " " + arg1 : ""}'\n` + HELP + "\n");
    return 2;
  } catch (e: any) {
    process.stderr.write(c("red", `saas error: ${String(e?.message || e)}`, ctx.color) + "\n");
    return 1;
  }
}

async function showPlans(client: GatewayClient, ctx: OutputCtx): Promise<number> {
  const plans = await client.listPlans();
  if (ctx.json) return json(plans);
  process.stdout.write(
    formatTable(
      ["id", "name", "rate/min", "monthly_quota", "tiers"],
      plans.map((p) => [p.id, p.name ?? "", str(p.rate_per_min), str(p.monthly_quota), p.allowed_tiers ?? ""]),
      ctx,
    ) + "\n",
  );
  return 0;
}

async function showTenants(client: GatewayClient, ctx: OutputCtx): Promise<number> {
  const tenants = await client.listTenants();
  if (ctx.json) return json(tenants);
  process.stdout.write(
    formatTable(
      ["id", "name", "plan", "stripe", "created"],
      tenants.map((t) => [t.id, t.name ?? "", t.plan_id ?? "", t.stripe_customer_id ?? "", t.created_at ?? ""]),
      ctx,
    ) + "\n",
  );
  return 0;
}

async function newTenant(client: GatewayClient, v: any, ctx: OutputCtx): Promise<number> {
  if (!v.name) {
    process.stderr.write("saas tenant new: --name required\n");
    return 2;
  }
  const t = await client.createTenant({ name: v.name, plan: v.plan, stripeCustomerId: v.stripe });
  if (ctx.json) return json(t);
  process.stdout.write(c("green", `tenant created: ${t.id}`, ctx.color) + `  (${t.name}, plan=${t.plan_id ?? "?"})\n`);
  return 0;
}

async function showKeys(client: GatewayClient, tenantId: string | undefined, ctx: OutputCtx): Promise<number> {
  if (!tenantId) {
    process.stderr.write("saas keys: --tenant <id> required\n");
    return 2;
  }
  const keys = await client.listKeys(tenantId);
  if (ctx.json) return json(keys);
  process.stdout.write(
    formatTable(
      ["id", "label", "revoked", "scopes", "expires", "last_used"],
      keys.map((k) => [k.id, k.label ?? "", k.revoked ? "yes" : "no", k.scopes ?? "", k.expires_at ?? "", k.last_used_at ?? ""]),
      ctx,
    ) + "\n",
  );
  return 0;
}

async function newKey(client: GatewayClient, v: any, ctx: OutputCtx): Promise<number> {
  if (!v.tenant) {
    process.stderr.write("saas key new: --tenant <id> required\n");
    return 2;
  }
  const k = await client.createKey({
    tenantId: v.tenant,
    label: v.label,
    ttlDays: v["ttl-days"] ? Number(v["ttl-days"]) : undefined,
    scopes: v.scopes,
  });
  if (ctx.json) return json(k); // scripts capture .key here
  // Secret-once: surface the plaintext prominently and warn (H4). Never logged.
  process.stdout.write(c("green", `key created: ${k.id}`, ctx.color) + "\n");
  process.stdout.write(c("bold", `  ${k.key}`, ctx.color) + "\n");
  process.stdout.write(c("yellow", "  ⚠ shown once — store it now; the gateway keeps only a hash", ctx.color) + "\n");
  if (k.expiresAt) process.stdout.write(c("dim", `  expires: ${k.expiresAt}`, ctx.color) + "\n");
  return 0;
}

async function revokeKey(client: GatewayClient, id: string | undefined, v: any, ctx: OutputCtx): Promise<number> {
  if (!id) {
    process.stderr.write("saas key revoke: missing <keyId>\n");
    return 2;
  }
  // Destructive → confirm unless --yes or --json (H5).
  if (!v.yes && !ctx.json) {
    const ok = await confirm(c("yellow", `revoke key ${id}? [y/N] `, ctx.color));
    if (!ok) {
      process.stdout.write(c("dim", "aborted", ctx.color) + "\n");
      return 0;
    }
  }
  const r = await client.revokeKey(id);
  if (ctx.json) return json(r);
  process.stdout.write(c("green", `revoked ${id}`, ctx.color) + (r.revoked ? c("dim", `  at ${r.revoked}`, ctx.color) : "") + "\n");
  return 0;
}

async function showAudit(client: GatewayClient, v: any, ctx: OutputCtx): Promise<number> {
  const events = await client.listAudit({ tenantId: v.tenant, limit: v.limit ? Number(v.limit) : undefined });
  if (ctx.json) return json(events);
  process.stdout.write(
    formatTable(
      ["ts", "tenant", "tool", "tier", "ok"],
      events.map((e) => [e.ts ?? "", e.tenant_id ?? "", e.tool ?? "", e.tier ?? "", e.ok ? "yes" : "no"]),
      ctx,
    ) + "\n",
  );
  return 0;
}

async function showUsage(client: GatewayClient, period: string | undefined, ctx: OutputCtx): Promise<number> {
  const report = await client.billingPreview(period);
  if (ctx.json) return json(report);
  process.stdout.write(
    formatTable(
      ["tenant", "calls", "ok", "tokens", "amount"],
      report.lines.map((l) => [l.tenantId, str(l.calls), str(l.okCalls), str(l.tokens), str(l.amount)]),
      ctx,
    ) + "\n",
  );
  process.stdout.write(c("dim", `period ${report.period} · total ${report.total}`, ctx.color) + "\n");
  return 0;
}

async function showBilling(client: GatewayClient, v: any, ctx: OutputCtx): Promise<number> {
  const report = v.run ? await client.billingRun(v.period) : await client.billingPreview(v.period);
  if (ctx.json) return json(report);
  const mode = v.run ? (report.dryRun ? "run (dry — no STRIPE_API_KEY)" : "run (applied)") : "preview";
  process.stdout.write(c("bold", `billing ${mode} · ${report.period}`, ctx.color) + "\n");
  process.stdout.write(
    formatTable(
      ["tenant", "calls", "tokens", "amount"],
      report.lines.map((l) => [l.tenantId, str(l.calls), str(l.tokens), str(l.amount)]),
      ctx,
    ) + "\n",
  );
  process.stdout.write(c("dim", `total ${report.total}`, ctx.color) + "\n");
  return 0;
}

function json(data: any): number {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  return 0;
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}
