// One-command onboarding plan (vT9): given which binaries exist + which configs are already
// present, decide what `tunnel setup` should do — configure / skip (idempotent) / report missing.
// Adoption (idea only): tailscale `up` zero-config one-command onboarding. PURE — no I/O.
// REUSE-only downstream: the CLI runs the existing cmdConfig/cmdTls/cmdMesh for "configure" steps.

export interface Capabilities {
  wgTools: boolean; // `wg` / `wg-quick`
  caddy: boolean;
  mkcert: boolean;
  headscale: boolean;
}

export interface ExistingConfigs {
  wireguard: boolean; // keys/wg0.conf
  lanTls: boolean; // keys/Caddyfile
  mesh: boolean; // keys/headscale.yaml
}

export type SetupKind = "wireguard" | "lan-tls" | "mesh";
export type SetupStatus = "configure" | "skip-exists" | "missing-binary";

export interface SetupStep {
  kind: SetupKind;
  status: SetupStatus;
  detail: string;
}

interface KindSpec {
  kind: SetupKind;
  needs: string[]; // brew packages
  capable: (c: Capabilities) => boolean;
  exists: (e: ExistingConfigs) => boolean;
}

const SPECS: KindSpec[] = [
  { kind: "wireguard", needs: ["wireguard-tools"], capable: (c) => c.wgTools, exists: (e) => e.wireguard },
  { kind: "lan-tls", needs: ["caddy", "mkcert"], capable: (c) => c.caddy && c.mkcert, exists: (e) => e.lanTls },
  { kind: "mesh", needs: ["headscale"], capable: (c) => c.headscale, exists: (e) => e.mesh },
];

/** PURE: decide per-transport whether to configure, skip (idempotent), or report a missing binary. */
export function planSetup(caps: Capabilities, existing: ExistingConfigs): SetupStep[] {
  return SPECS.map((s): SetupStep => {
    if (!s.capable(caps)) {
      return { kind: s.kind, status: "missing-binary", detail: `brew install ${s.needs.join(" ")}` };
    }
    if (s.exists(existing)) {
      return { kind: s.kind, status: "skip-exists", detail: "config already present (idempotent skip)" };
    }
    return { kind: s.kind, status: "configure", detail: `generate config (${s.needs.join(" + ")})` };
  });
}

/** Kinds that will actually be configured this run. */
export function kindsToConfigure(steps: SetupStep[]): SetupKind[] {
  return steps.filter((s) => s.status === "configure").map((s) => s.kind);
}

/** PURE: human-readable plan table. */
export function renderSetupPlan(steps: SetupStep[]): string {
  const lines = ["transport    status          detail"];
  for (const s of steps) {
    lines.push(`${s.kind.padEnd(12)} ${s.status.padEnd(15)} ${s.detail}`);
  }
  const ready = steps.some((s) => s.status === "configure" || s.status === "skip-exists");
  lines.push("");
  lines.push(
    ready
      ? "→ at least one transport is set up; bringing the best one up."
      : "→ no usable transport (install the binaries above, then re-run `setup`).",
  );
  return lines.join("\n");
}
