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

/** One row of the guided key-onboarding list (from /api/keys/pool — never a raw key). */
export interface OnboardTarget {
  id: string;
  state: "missing" | "exhausted" | "live";
  signupUrl: string;
  envKey: string;
  live: number;
  total: number;
}

/** Pure: pool snapshot → guided signup order. Missing keys first (biggest win), then
 *  exhausted (all keys cooling), then live (informational). Providers without a signup
 *  URL can't be guided → dropped. Never throws on malformed input. */
export function onboardTargets(pool: Record<string, any> | null | undefined): OnboardTarget[] {
  if (!pool || typeof pool !== "object") return [];
  const rank = { missing: 0, exhausted: 1, live: 2 } as const;
  return Object.entries(pool)
    .filter(([, v]: [string, any]) => typeof v?.signupUrl === "string" && v.signupUrl.length > 0)
    .map(([id, v]: [string, any]) => {
      const total = Number(v?.total ?? 0), live = Number(v?.live ?? 0);
      const state: OnboardTarget["state"] = total === 0 ? "missing" : live === 0 ? "exhausted" : "live";
      return { id, state, signupUrl: String(v.signupUrl), envKey: String(v?.envKey ?? ""), live, total };
    })
    .sort((a, b) => (rank[a.state] - rank[b.state]) || a.id.localeCompare(b.id));
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

  if (sub === "onboard") {
    // Guided free-tier key onboarding: list gaps, open signup, paste key, add + live smoke.
    // Everything flows through the server HTTP surface (choke-point); raw keys never echo.
    let pool: Record<string, any>;
    try { pool = (await api(gateway, "/api/keys/pool", undefined)).pool ?? {}; }
    catch (e) { console.error(redactOlm((e as Error)?.message || "pool unreachable — is the server on :3000 up?")); return 1; }
    const targets = onboardTargets(pool);
    const pick = argv[1];

    if (!pick) {
      console.log("free-tier key onboarding — önce 'missing', sonra 'exhausted':");
      for (const t of targets) {
        const mark = t.state === "missing" ? "✗ yok" : t.state === "exhausted" ? "⏳ tükenmiş" : "✓ canlı";
        console.log(`  ${t.id.padEnd(14)} ${mark.padEnd(10)} ${t.live}/${t.total}  ${t.signupUrl}`);
      }
      console.log("\nbaşlat: ollamas keys onboard <provider>");
      return 0;
    }

    const t = targets.find((x) => x.id === pick);
    if (!t) { console.error(`bilinmeyen provider '${pick}' — listele: ollamas keys onboard`); return 1; }
    console.log(`→ ${t.id} signup: ${t.signupUrl}${t.envKey ? `  (env: ${t.envKey})` : ""}`);
    if (process.platform === "darwin") {
      try { const { execFileSync } = await import("node:child_process"); execFileSync("open", [t.signupUrl], { stdio: "ignore" }); }
      catch { /* browser açılamadı → URL yukarıda basıldı */ }
    }
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stderr }); // stderr → key stdout log'una düşmez
    const key = (await rl.question(`${t.id} API key yapıştır (boş = iptal): `)).trim();
    rl.close();
    if (!key) { console.error("iptal — key girilmedi."); return 1; }
    try {
      const r = await api(gateway, "/api/keys/add", undefined, { provider: t.id, key });
      console.log(`✓ ${t.id} key vault'a eklendi (pool ${r.poolSize ?? "?"}).`);
    } catch (e) { console.error(redactOlm((e as Error)?.message || "add failed")); return 1; }
    try {
      const s = await api(gateway, "/api/ai/generate", undefined, { prompt: "Reply with exactly: ok", provider: t.id });
      const ok = typeof s?.text === "string" && s.text.length > 0;
      console.log(ok ? `✓ canlı smoke geçti (${t.id} yanıt verdi).` : `⚠ smoke yanıtı boş — key'i kontrol et.`);
      return ok ? 0 : 1;
    } catch (e) { console.error(`⚠ smoke başarısız: ${redactOlm((e as Error)?.message || "?")}`); return 1; }
  }

  console.error("usage: ollamas keys [pool | provision --count N [--dry] | add <provider> <key> | onboard [provider]]");
  return 1;
}
