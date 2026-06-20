// ollamas tunnel CLI. Zero-dep. Commands:
//   config   generate keypairs + render MacBook/iPhone WireGuard configs (+ QR if qrencode present)
//   up       wg-quick up wg0
//   down     wg-quick down wg0
//   tls      mkcert local CA + cert + Caddyfile + iOS .mobileconfig for LAN-TLS (vT2)
//   mesh     self-hosted Headscale config + zero-account preauth steps for sovereign mesh (vT3)
//   select   selectAuto: scored probe of all transports → best endpoint + decision (vT4)
//   auto     autopilot: auto-detect capable transports, bring up the best, self-heal (--watch) (vT4)
//
// Keys/configs are written under tunnel/keys/ (gitignored) — never committed (RISK-TUNNEL-004).

import { mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TunnelSwitch } from "./switch.ts";
import {
  DEFAULT_PLAN,
  genKeypair,
  renderPeerConfig,
  renderServerConfig,
  serviceUrl,
  WireGuardTransport,
  type WgPlan,
} from "./transports/wireguard.ts";
import {
  DEFAULT_TLS_PLAN,
  detectLocalHostname,
  renderCaddyfile,
  tlsServiceUrl,
  CaddyTlsTransport,
  type CaddyTlsPlan,
} from "./transports/caddy-tls.ts";
import {
  DEFAULT_MESH_PLAN,
  HeadscaleTransport,
  clientUpCommand,
  createUserCommand,
  preAuthKeyCommand,
  renderHeadscaleConfig,
  serviceUrl as meshServiceUrl,
  type HeadscalePlan,
} from "./transports/headscale.ts";
import { autoUp, runLoop } from "./autopilot.ts";
import type { Transport } from "./transport.ts";
import { renderMobileConfig } from "./mobileconfig.ts";

const KEYS_DIR = join(import.meta.dirname, "..", "keys");

/** First non-internal IPv4 (the MacBook's LAN address the iPhone dials). */
export function detectLanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return "127.0.0.1";
}

async function cmdConfig(): Promise<void> {
  const plan: WgPlan = { ...DEFAULT_PLAN, endpointHost: detectLanIp() };
  const server = await genKeypair();
  const peer = await genKeypair();

  const serverConf = renderServerConfig(plan, server.privateKey, peer.publicKey);
  const peerConf = renderPeerConfig(plan, peer.privateKey, server.publicKey);

  await mkdir(KEYS_DIR, { recursive: true });
  await chmod(KEYS_DIR, 0o700);
  const serverPath = join(KEYS_DIR, "wg0.conf");
  const peerPath = join(KEYS_DIR, "iphone.conf");
  await writeFile(serverPath, serverConf, { mode: 0o600 });
  await writeFile(peerPath, peerConf, { mode: 0o600 });

  console.log(`MacBook config  → ${serverPath}  (sudo cp to /etc/wireguard/wg0.conf, then: tunnel up)`);
  console.log(`iPhone config   → ${peerPath}`);
  console.log(`Endpoint host   = ${plan.endpointHost}:${plan.listenPort}`);
  console.log(`ollamas over WG = ${serviceUrl(plan)}`);
  console.log("");
  console.log("Scan this with the WireGuard iOS app (Add tunnel → Create from QR code):");
  await printQr(peerConf, peerPath);
}

/** Best-effort QR via qrencode (optional, not an npm dep). Falls back to a hint. */
function printQr(conf: string, peerPath: string): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn("qrencode", ["-t", "ansiutf8"], { stdio: ["pipe", "inherit", "ignore"] });
    p.on("error", () => {
      console.log(`  (qrencode not found — \`brew install qrencode\`, or import ${peerPath} into the app)`);
      resolve();
    });
    p.on("close", () => resolve());
    p.stdin.write(conf);
    p.stdin.end();
  });
}

/** Run a binary synchronously, return trimmed stdout; throws with a brew hint if missing. */
function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ENOENT/.test(msg)) throw new Error(`${cmd} not found — \`brew install ${cmd}\``);
    throw new Error(`${cmd} ${args.join(" ")} failed: ${msg}`);
  }
}

async function cmdTls(): Promise<void> {
  const host = detectLocalHostname();
  await mkdir(KEYS_DIR, { recursive: true });
  await chmod(KEYS_DIR, 0o700);
  const certPath = join(KEYS_DIR, "cert.pem");
  const keyPath = join(KEYS_DIR, "key.pem");
  const caddyfilePath = join(KEYS_DIR, "Caddyfile");
  const profilePath = join(KEYS_DIR, `${host}.mobileconfig`);

  // 1. local CA + per-host cert (mkcert, binary-invoke; BSD-3)
  run("mkcert", ["-install"]);
  run("mkcert", ["-cert-file", certPath, "-key-file", keyPath, host]);
  await chmod(keyPath, 0o600).catch(() => {});

  // 2. Caddyfile (reverse_proxy → ollamas, serve mkcert cert)
  const plan: CaddyTlsPlan = { ...DEFAULT_TLS_PLAN, host, certPath, keyPath };
  await writeFile(caddyfilePath, renderCaddyfile(plan), { mode: 0o600 });

  // 3. export mkcert rootCA → iOS .mobileconfig (so the iPhone trusts the cert)
  const caRoot = run("mkcert", ["-CAROOT"]);
  const caPem = await readFile(join(caRoot, "rootCA.pem"), "utf8");
  const profile = renderMobileConfig(caPem, {
    certName: "ollamas Local CA",
    identifier: "com.ollamas.tunnel.lan-tls",
    displayName: "ollamas LAN-TLS",
    description: `Trust the ollamas local CA to reach ${tlsServiceUrl(plan)} over HTTPS.`,
  });
  await writeFile(profilePath, profile, { mode: 0o600 });

  console.log(`Caddyfile        → ${caddyfilePath}`);
  console.log(`cert / key       → ${certPath} / ${keyPath}`);
  console.log(`iOS profile      → ${profilePath}`);
  console.log(`ollamas over TLS = ${tlsServiceUrl(plan)}`);
  console.log("");
  console.log("Next:");
  console.log(`  1) caddy run --config ${caddyfilePath} --adapter caddyfile`);
  console.log(`  2) AirDrop ${profilePath} to the iPhone → install profile`);
  console.log("  3) iPhone: Settings → General → About → Certificate Trust Settings → enable 'mkcert ...'");
  console.log(`  4) iPhone Safari: ${tlsServiceUrl(plan)}/healthz → 200`);
}

async function cmdMesh(): Promise<void> {
  // Sovereign mesh: self-hosted Headscale control plane over the WireGuard data plane (vT3).
  // Coordination URL defaults to this Mac's Bonjour name so an iPhone on/off WiFi can reach it.
  const host = detectLocalHostname();
  const plan: HeadscalePlan = { ...DEFAULT_MESH_PLAN, serverUrl: `http://${host}:8080` };
  const configPath = join(KEYS_DIR, "headscale.yaml");

  await mkdir(KEYS_DIR, { recursive: true });
  await chmod(KEYS_DIR, 0o700);
  await writeFile(configPath, renderHeadscaleConfig(plan), { mode: 0o600 });

  console.log(`Headscale config → ${configPath}`);
  console.log(`Coordination URL = ${plan.serverUrl}`);
  console.log(`ollamas over mesh= ${meshServiceUrl(plan)}`);
  console.log("");
  console.log("Next (binary-invoke; brew install headscale, iPhone: Tailscale app):");
  console.log(`  1) headscale serve --config ${configPath}`);
  console.log(`  2) ${createUserCommand(plan)}`);
  console.log(`  3) ${preAuthKeyCommand(plan)}   # reusable, zero Tailscale account`);
  console.log(`  4) iPhone Tailscale app → Settings → ALTERNATE COORDINATION SERVER URL = ${plan.serverUrl}`);
  console.log(`     → log in → approve:  headscale nodes register --user ${plan.user} --key <mkey>`);
  console.log(`  5) CLI peer (optional): ${clientUpCommand(plan)}`);
  console.log(`  6) iPhone: ${meshServiceUrl(plan)}/healthz → 200`);
}

function wgQuick(action: "up" | "down"): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("wg-quick", [action, "wg0"], { stdio: "inherit" });
    p.on("error", () => resolve(127));
    p.on("close", (c) => resolve(c ?? 1));
  });
}

/** Build the registered transport set + switch (shared by select/auto). */
function buildSwitch(): { sw: TunnelSwitch; transports: Transport[] } {
  const host = detectLocalHostname();
  const wgPlan: WgPlan = { ...DEFAULT_PLAN, endpointHost: detectLanIp() };
  const tlsPlan: CaddyTlsPlan = { ...DEFAULT_TLS_PLAN, host };
  const meshPlan: HeadscalePlan = { ...DEFAULT_MESH_PLAN, serverUrl: `http://${host}:8080` };
  // Priority bands: LAN-TLS (10) on home WiFi → WireGuard p2p (20, same-LAN direct) →
  // Headscale mesh (20, multi-device/remote). selectAuto scores by measured latency within bands.
  const transports: Transport[] = [
    new CaddyTlsTransport(tlsPlan),
    new WireGuardTransport(wgPlan),
    new HeadscaleTransport(meshPlan),
  ];
  const sw = new TunnelSwitch();
  for (const t of transports) sw.register(t);
  return { sw, transports };
}

async function cmdSelect(): Promise<void> {
  const { sw } = buildSwitch();
  const ep = await sw.selectAuto();
  const d = sw.lastDecision();
  console.log(
    ep
      ? JSON.stringify({ endpoint: ep, decision: d?.reason })
      : "no healthy transport (is ollamas + a tunnel up?)",
  );
  process.exitCode = ep ? 0 : 1;
}

// Autopilot: zero manual selection / zero manual operation (vT4).
async function cmdAuto(): Promise<void> {
  const watch = process.argv.includes("--watch");
  const { sw, transports } = buildSwitch();
  if (watch) {
    console.log("autopilot --watch: self-heal loop (Ctrl-C to stop)");
    await runLoop(sw, transports, {
      onTick: (r, i) =>
        console.log(JSON.stringify({ round: i, endpoint: r.endpoint, broughtUp: r.broughtUp, reason: r.reason })),
    });
    return;
  }
  const r = await autoUp(sw, transports);
  console.log(JSON.stringify({ ...r, decision: sw.lastDecision()?.reason, scores: sw.lastDecision()?.scores }, null, 2));
  process.exitCode = r.endpoint ? 0 : 1;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "help";
  switch (cmd) {
    case "config":
      return cmdConfig();
    case "up":
      process.exitCode = await wgQuick("up");
      return;
    case "down":
      process.exitCode = await wgQuick("down");
      return;
    case "tls":
      return cmdTls();
    case "mesh":
      return cmdMesh();
    case "select":
      return cmdSelect();
    case "auto":
      return cmdAuto();
    default:
      console.log("usage: tunnel <config|up|down|tls|mesh|select|auto> [--watch]");
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
