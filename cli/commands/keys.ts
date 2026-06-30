// cli/commands/keys.ts — ollamas gateway api-key (olm_) POOL: provision + rotate (the gemini-provision
// system, for the gateway's own keys). Mints N olm_ keys across N tenants (N× the per-tenant rate
// limit) via the admin endpoints, seals them into the CLI config pool; loadConfig() then rotates
// across them transparently. Also `keys add <provider> <key>` → the server vault pool (ollama-cloud).
// Zero-dep (node fetch). Keys are NEVER printed (redacted).
import { loadConfig, saveConfig } from "../lib/config";

/** Pure: redact anything shaped like an olm_ gateway key so no secret leaks into logs. */
export function redactOlm(text: string): string {
  return String(text ?? "").replace(/olm_[0-9a-f]{16,}/gi, "olm_…REDACTED");
}

/** Pure: one-line provisioning summary (never includes key values). */
export function summarizeProvision(minted: number, want: number, poolTotal: number): string {
  return `Provisioned ${minted}/${want} olm_ key(s). Pool now: ${poolTotal} key(s) (rotated per call).`;
}

async function api(gateway: string, path: string, admin: string | undefined, body?: unknown): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (admin) headers["X-Admin-Token"] = admin;
  const res = await fetch(`${String(gateway).replace(/\/+$/, "")}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

export async function runKeys(argv: string[]): Promise<number> {
  const sub = argv[0];
  const cfg = loadConfig();
  const gateway = cfg.gateway;

  if (sub === "pool" || sub === undefined) {
    const pool = cfg.apiKeyPool ?? [];
    console.log(`ollamas gateway olm_ pool: ${pool.length} key(s)${pool.length ? " (rotated per call)" : " — none; run: ollamas keys provision --count 3"}`);
    return 0;
  }

  if (sub === "provision") {
    const cArg = argv.indexOf("--count");
    const count = cArg >= 0 ? Math.max(1, Math.min(20, Number(argv[cArg + 1]) || 0)) : 3;
    if (argv.includes("--dry")) { console.log(`[--dry] would create ${count} tenant(s) + one olm_ key each → sealed pool. No changes.`); return 0; }
    if (!cfg.saasAdminToken) { console.error("admin token required: set OLLAMAS_SAAS_ADMIN or `ollamas config` (X-Admin-Token). Mints olm_ keys via the admin endpoints."); return 1; }
    const minted: string[] = [];
    for (let i = 1; i <= count; i++) {
      try {
        const t = await api(gateway, "/api/saas/tenants", cfg.saasAdminToken, { name: `ollamas-pool-${i}-${Date.now().toString(36)}` });
        const tenantId = t.id || t.tenantId;
        if (!tenantId) { console.log(`  [${i}/${count}] ✗ no tenant id`); continue; }
        const k = await api(gateway, "/api/saas/keys", cfg.saasAdminToken, { tenantId, label: "ollamas-pool" });
        if (k.key) { minted.push(k.key); console.log(`  [${i}/${count}] ✓ minted olm_ key (tenant ${tenantId})`); }
        else console.log(`  [${i}/${count}] ✗ no key returned`);
      } catch (e) { console.log(`  [${i}/${count}] ✗ ${redactOlm((e as Error)?.message || "failed")}`); }
    }
    if (minted.length) {
      const next = [...(cfg.apiKeyPool ?? []), ...minted];
      saveConfig({ apiKeyPool: next });
      console.log(`\n${summarizeProvision(minted.length, count, next.length)}`);
    } else console.log("\nNo keys minted (admin token / gateway?).");
    return minted.length ? 0 : 1;
  }

  if (sub === "add") {
    const provider = argv[1], key = argv[2];
    if (!provider || !key) { console.error("usage: ollamas keys add <provider> <key>   (e.g. ollama-cloud)"); return 1; }
    try {
      const r = await api(gateway, "/api/keys/add", undefined, { provider, key });
      console.log(`✓ added a ${provider} key to the server vault pool (size ${r.poolSize ?? "?"}). Rotation auto-uses it.`);
      return 0;
    } catch (e) { console.error(redactOlm((e as Error)?.message || "add failed")); return 1; }
  }

  console.error("usage: ollamas keys [pool | provision --count N [--dry] | add <provider> <key>]");
  return 1;
}
