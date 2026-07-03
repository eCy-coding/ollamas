// Device-side turnkey onboarding orchestrator (vK17). One command chains the whole
// join: mesh-join → build-check → apply-with-invite (auto-approve) → offer (permanent
// contribution). PURE/injectable — the cli wires real IO; tests drive fake steps.
// The device does NOT verify the invite signature (only the operator's server can,
// with the operator pubkey) — it just reads serverUrl/model from the body and lets
// the server authenticate the token.

export type BootstrapSteps = {
  meshJoin: () => Promise<string>; // join the operator's tailnet (tailscale up --authkey); may be a SKIP on the operator box
  ensureRpc: () => Promise<string>; // build/verify RPC-enabled llama.cpp (idempotent)
  applyWithInvite: (serverUrl: string, token: string, model?: string) => Promise<string>; // → raw key
  offer: (model?: string) => Promise<number>; // node-config + rpc + heartbeat daemons
};

export type BootstrapResult = { ok: boolean; steps: Array<{ name: string; detail: string }>; memberKeyDelivered: boolean; reason?: string };

/** Read serverUrl + allowedModel from an invite WITHOUT verifying (device side). */
export function decodeInviteServerUrl(token: string): { serverUrl: string; allowedModel?: string } | null {
  try {
    const body = token.slice(0, token.indexOf("."));
    if (!body) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { serverUrl?: string; allowedModel?: string };
    if (!p.serverUrl) return null;
    return { serverUrl: p.serverUrl, allowedModel: p.allowedModel };
  } catch {
    return null;
  }
}

export async function runBootstrap(opts: { invite: string; steps: BootstrapSteps }): Promise<BootstrapResult> {
  const steps: Array<{ name: string; detail: string }> = [];
  const decoded = decodeInviteServerUrl(opts.invite);
  if (!decoded) return { ok: false, steps, memberKeyDelivered: false, reason: "malformed invite (cannot read serverUrl)" };
  const model = decoded.allowedModel;
  const run = async (name: string, fn: () => Promise<string>): Promise<boolean> => {
    try {
      steps.push({ name, detail: await fn() });
      return true;
    } catch (e: any) {
      steps.push({ name, detail: `FAILED: ${e?.message || e}` });
      return false;
    }
  };
  if (!(await run("mesh-join", opts.steps.meshJoin))) return { ok: false, steps, memberKeyDelivered: false, reason: `mesh-join failed: ${steps.at(-1)?.detail}` };
  if (!(await run("build-check", opts.steps.ensureRpc))) return { ok: false, steps, memberKeyDelivered: false, reason: `build failed: ${steps.at(-1)?.detail}` };
  let keyDelivered = false;
  if (!(await run("apply-with-invite", async () => { const k = await opts.steps.applyWithInvite(decoded.serverUrl, opts.invite, model); keyDelivered = String(k).startsWith("olm_"); return keyDelivered ? "member active, key saved" : "no key returned"; }))) {
    return { ok: false, steps, memberKeyDelivered: false, reason: `apply failed: ${steps.at(-1)?.detail}` };
  }
  if (!(await run("offer", async () => { const code = await opts.steps.offer(model); if (code !== 0) throw new Error(`offer exit ${code}`); return "daemons installed"; }))) {
    return { ok: false, steps, memberKeyDelivered: keyDelivered, reason: `offer failed: ${steps.at(-1)?.detail}` };
  }
  return { ok: true, steps, memberKeyDelivered: keyDelivered };
}
