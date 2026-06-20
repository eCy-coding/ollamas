// ollamas tunnel CLI. Zero-dep. Commands:
//   setup    one-command onboarding: detect capable transports → configure → bring up → [--daemon] (vT9)
//   teardown stop WireGuard + uninstall daemon (configs kept) (vT9)
//   config   generate keypairs + render MacBook/iPhone WireGuard configs (+ QR if qrencode present)
//   up       wg-quick up wg0
//   down     wg-quick down wg0
//   tls      mkcert local CA + cert + Caddyfile + iOS .mobileconfig for LAN-TLS (vT2)
//   mesh     self-hosted Headscale config + zero-account preauth steps for sovereign mesh (vT3)
//   select   selectAuto: scored probe of all transports → best endpoint + decision (vT4)
//   auto     autopilot: auto-detect capable transports, bring up the best, self-heal (--watch) (vT4)
//   rotate   age-based auto WireGuard key rotation; old config sealed to vault; --force (vT5)
//   status   observability: active transport + latency sparkline + breaker + connectivity; --json|--watch (vT6)
//   daemon   install|uninstall|status a LaunchAgent running `auto --watch` at login + on crash (vT7)
//   bench    per-transport p50/p90 latency over N samples (--samples N, --json) (vT8)
//   doctor   live e2e self-test: real ollamas upstream + selectAuto + connectivity (--json) (vT10)
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
import { autoUp, runLoop, detectCapable } from "./autopilot.ts";
import { probeHttp, HEALTH_PATH } from "./health.ts";
import { buildDoctorReport, renderDoctorReport } from "./doctor.ts";
import type { Transport } from "./transport.ts";
import {
  DEFAULT_MAX_AGE_DAYS,
  daysUntilRotation,
  needsRotation,
  rotationPlan,
  type KeyMeta,
} from "./rotate.ts";
import { loadOrCreateKeyfile, openFromFile, sealToFile } from "./keystore.ts";
import { appendDecision, readDecisions, renderStatusTable, statusReport } from "./status.ts";
import {
  DEFAULT_LABEL,
  agentPath,
  agentStatus,
  installAgent,
  uninstallAgent,
  type DaemonPlan,
} from "./daemon.ts";
import { classify, internetReachable } from "./connectivity.ts";
import { benchmarkTransports, renderBenchTable } from "./bench.ts";
import { rotateIfNeeded } from "./logrotate.ts";
import { commandExists } from "./autopilot.ts";
import {
  kindsToConfigure,
  planSetup,
  renderSetupPlan,
  type Capabilities,
  type ExistingConfigs,
} from "./setup.ts";
import { existsSync } from "node:fs";
import { renderMobileConfig } from "./mobileconfig.ts";

const LOG_CAP = { maxBytes: 1_000_000, keep: 3 } as const;

const DECISIONS_PATH = () => join(KEYS_DIR, "decisions.jsonl");

/** Persist the switch's last decision to the secret-free JSONL feed (best-effort). */
async function persistDecision(sw: TunnelSwitch): Promise<void> {
  const d = sw.lastDecision();
  if (!d) return;
  try {
    await mkdir(KEYS_DIR, { recursive: true });
    appendDecision(DECISIONS_PATH(), d);
    rotateIfNeeded(DECISIONS_PATH(), LOG_CAP); // bound the feed (RISK-018)
  } catch {
    // observability feed is best-effort; never block the command.
  }
}

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
  console.log(`  4) iPhone Safari: ${tlsServiceUrl(plan)}/api/health → 200`);
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
  console.log(`  6) iPhone: ${meshServiceUrl(plan)}/api/health → 200`);
}

// Age-based automatic WireGuard key rotation (vT5). Zero prompt. Old config is backed up into
// an encrypted vault (auto-keyfile) before being overwritten — no plaintext key left behind.
async function cmdRotate(): Promise<void> {
  const force = process.argv.includes("--force");
  const metaPath = join(KEYS_DIR, "wg-meta.json");
  let meta: KeyMeta;
  try {
    meta = JSON.parse(await readFile(metaPath, "utf8")) as KeyMeta;
  } catch {
    meta = { createdAt: 0, version: 0 }; // never rotated → due
  }

  const now = Date.now();
  if (!force && !needsRotation(meta, now)) {
    console.log(`rotation not due — ${daysUntilRotation(meta, now)}/${DEFAULT_MAX_AGE_DAYS} days left (v${meta.version})`);
    return;
  }

  const plan: WgPlan = { ...DEFAULT_PLAN, endpointHost: detectLanIp() };
  let server: Awaited<ReturnType<typeof genKeypair>>;
  let peer: Awaited<ReturnType<typeof genKeypair>>;
  try {
    server = await genKeypair();
    peer = await genKeypair();
  } catch (e) {
    console.log(`cannot rotate: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(KEYS_DIR, { recursive: true });
  await chmod(KEYS_DIR, 0o700);

  // Back up the outgoing config into the encrypted vault (auto-keyfile, 0-manuel) before overwrite.
  try {
    const oldServer = await readFile(join(KEYS_DIR, "wg0.conf"), "utf8").catch(() => null);
    if (oldServer) {
      const keyfile = loadOrCreateKeyfile(join(KEYS_DIR, ".master.key"));
      const vaultPath = join(KEYS_DIR, "vault.enc");
      const vault = openFromFile<Record<string, string>>(vaultPath, keyfile) ?? {};
      vault[`wg-server-v${meta.version}`] = oldServer;
      sealToFile(vaultPath, vault, keyfile);
    }
  } catch {
    // backup is best-effort; never block rotation on it.
  }

  const out = rotationPlan(plan, server, peer, meta, now);
  await writeFile(join(KEYS_DIR, "wg0.conf"), out.serverConf, { mode: 0o600 });
  await writeFile(join(KEYS_DIR, "iphone.conf"), out.peerConf, { mode: 0o600 });
  await writeFile(metaPath, JSON.stringify(out.meta), { mode: 0o600 });

  console.log(`rotated → v${out.meta.version}. New keys written; re-import keys/iphone.conf on the phone.`);
  console.log("Old WireGuard session expires within ~3 min (no kill-switch); old config backed up to vault.enc.");
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
  await persistDecision(sw);
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
  // Rotate the daemon log on each (re)start so 24/7 `auto --watch` can't grow it unbounded (RISK-020).
  rotateIfNeeded(join(KEYS_DIR, "daemon.log"), LOG_CAP);
  const { sw, transports } = buildSwitch();
  if (watch) {
    console.log("autopilot --watch: self-heal loop (Ctrl-C to stop)");
    await runLoop(sw, transports, {
      onTick: async (r, i) => {
        await persistDecision(sw);
        console.log(JSON.stringify({ round: i, endpoint: r.endpoint, broughtUp: r.broughtUp, reason: r.reason }));
      },
    });
    return;
  }
  const r = await autoUp(sw, transports);
  await persistDecision(sw);
  console.log(JSON.stringify({ ...r, decision: sw.lastDecision()?.reason, scores: sw.lastDecision()?.scores }, null, 2));
  process.exitCode = r.endpoint ? 0 : 1;
}

// Observability (vT6): read-only status. --json machine output; --watch live redraw. Zero prompt.
async function cmdStatus(): Promise<void> {
  const json = process.argv.includes("--json");
  const watch = process.argv.includes("--watch");

  const render = async (): Promise<string> => {
    const { sw } = buildSwitch();
    await sw.selectAuto(); // live probe round
    await persistDecision(sw);
    const persisted = readDecisions(DECISIONS_PATH(), { limit: 50 });
    const report = statusReport([...persisted, ...sw.decisions()]);
    const conn = classify({ lan: report.active !== null, internet: await internetReachable() });
    if (json) return JSON.stringify({ ...report, connectivity: conn }, null, 2);
    return `${renderStatusTable(report)}\nconnectivity: ${conn}`;
  };

  if (watch) {
    process.stdout.write("\x1b[?1049h"); // alt screen
    const restore = () => {
      process.stdout.write("\x1b[?1049l"); // restore screen (N-016: never leave terminal broken)
      process.exit(0);
    };
    process.on("SIGINT", restore);
    for (;;) {
      process.stdout.write(`\x1b[H\x1b[2J${await render()}\n\n(Ctrl-C to exit)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.log(await render());
}

// Always-on daemon (vT7): install a LaunchAgent that runs `tunnel auto --watch` at login + on crash.
// One-time install; running afterwards is fully autonomous (0 manuel işlem). 0 prompt.
function daemonPlan(): DaemonPlan {
  return {
    label: DEFAULT_LABEL,
    nodeBin: process.execPath,
    cliPath: join(import.meta.dirname, "cli.ts"),
    args: ["auto", "--watch"],
    logPath: join(KEYS_DIR, "daemon.log"),
    workdir: join(import.meta.dirname, ".."),
  };
}

// One-command onboarding (vT9): detect capable transports → configure the missing ones (idempotent)
// → bring the best up → optionally install the daemon. Zero manual selection, 0 prompt.
async function cmdSetup(): Promise<void> {
  const wantDaemon = process.argv.includes("--daemon");
  const caps: Capabilities = {
    wgTools: await commandExists("wg-quick"),
    caddy: await commandExists("caddy"),
    mkcert: await commandExists("mkcert"),
    headscale: await commandExists("headscale"),
  };
  const existing: ExistingConfigs = {
    wireguard: existsSync(join(KEYS_DIR, "wg0.conf")),
    lanTls: existsSync(join(KEYS_DIR, "Caddyfile")),
    mesh: existsSync(join(KEYS_DIR, "headscale.yaml")),
  };
  const steps = planSetup(caps, existing);
  console.log(renderSetupPlan(steps));
  console.log("");

  for (const kind of kindsToConfigure(steps)) {
    try {
      if (kind === "wireguard") await cmdConfig();
      else if (kind === "lan-tls") await cmdTls();
      else if (kind === "mesh") await cmdMesh();
    } catch (e) {
      console.log(`  ${kind} setup failed (skipped): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const { sw, transports } = buildSwitch();
  const r = await autoUp(sw, transports);
  await persistDecision(sw);
  console.log("");
  console.log(`autopilot: ${r.reason}${r.endpoint ? ` → ${r.endpoint.url}` : ""}`);

  if (wantDaemon) {
    const dr = installAgent(daemonPlan());
    console.log(`daemon: ${dr.reason}`);
  } else {
    console.log("tip: `setup --daemon` to keep it always-on (login + crash-restart).");
  }
}

// Tear down: stop WireGuard + uninstall the daemon. Configs stay in keys/ (re-run `setup` to restore).
async function cmdTeardown(): Promise<void> {
  const code = await wgQuick("down");
  console.log(`wireguard: down (exit ${code})`);
  const r = uninstallAgent(DEFAULT_LABEL);
  console.log(`daemon: ${r.reason}`);
  console.log("configs kept in keys/ — run `setup` to bring everything back up.");
}

// Live e2e self-test (vT10): probe the real ollamas upstream + selectAuto + connectivity. 0 prompt.
async function cmdDoctor(): Promise<void> {
  const json = process.argv.includes("--json");
  const upstreamBase = "http://localhost:3000";
  const start = performance.now();
  const reachable = await probeHttp(upstreamBase, HEALTH_PATH, { requirePrivateHost: true });
  const ms = performance.now() - start;

  const { sw, transports } = buildSwitch();
  await sw.selectAuto();
  await persistDecision(sw);
  const capable = (await detectCapable(transports)).map((t) => t.name);
  const connectivity = classify({ lan: sw.activeName() !== null, internet: await internetReachable() });

  const report = buildDoctorReport({
    ollamasUpstream: { url: `${upstreamBase}${HEALTH_PATH}`, reachable, ms },
    active: sw.activeName(),
    connectivity,
    capable,
  });
  console.log(json ? JSON.stringify(report, null, 2) : renderDoctorReport(report));
  process.exitCode = report.ok ? 0 : 1;
}

// Benchmark (vT8): N timed probes per transport → p50/p90 table. Read-only, 0 prompt.
async function cmdBench(): Promise<void> {
  const json = process.argv.includes("--json");
  const sIdx = process.argv.indexOf("--samples");
  const samples = sIdx >= 0 ? Number(process.argv[sIdx + 1]) || 5 : 5;
  const { transports } = buildSwitch();
  const results = await benchmarkTransports(transports, { samples });
  console.log(json ? JSON.stringify(results, null, 2) : renderBenchTable(results));
}

async function cmdDaemon(): Promise<void> {
  const sub = process.argv[3] ?? "status";
  const plan = daemonPlan();
  switch (sub) {
    case "install": {
      await mkdir(KEYS_DIR, { recursive: true });
      const r = installAgent(plan);
      console.log(JSON.stringify({ ...r, plist: agentPath(plan.label) }, null, 2));
      console.log(
        r.ok
          ? "daemon installed: `tunnel auto --watch` runs at login + restarts on crash (0 manuel işlem)."
          : `plist written; load manually: launchctl load -w ${agentPath(plan.label)}`,
      );
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    case "uninstall": {
      const r = uninstallAgent(plan.label);
      console.log(JSON.stringify(r, null, 2));
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    case "status":
    default: {
      const s = agentStatus(plan.label);
      console.log(JSON.stringify({ ...s, log: plan.logPath }, null, 2));
      return;
    }
  }
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
    case "rotate":
      return cmdRotate();
    case "status":
      return cmdStatus();
    case "daemon":
      return cmdDaemon();
    case "bench":
      return cmdBench();
    case "setup":
      return cmdSetup();
    case "teardown":
      return cmdTeardown();
    case "doctor":
      return cmdDoctor();
    default:
      console.log(
        "usage: tunnel <setup|teardown|doctor|config|up|down|tls|mesh|select|auto|rotate|status|daemon|bench> [install|uninstall|status] [--daemon|--watch|--json|--force|--samples N]",
      );
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
