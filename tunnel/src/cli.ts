// ollamas tunnel CLI (vT1). Zero-dep. Commands:
//   config   generate keypairs + render MacBook/iPhone WireGuard configs (+ QR if qrencode present)
//   up       wg-quick up wg0   (requires generated /etc/wireguard/wg0.conf via `config --install`)
//   down     wg-quick down wg0
//   select   probe registered transports, print the chosen TunnelEndpoint
//
// Keys/configs are written under tunnel/keys/ (gitignored) — never committed (RISK-TUNNEL-004).

import { mkdir, writeFile, chmod } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
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

function wgQuick(action: "up" | "down"): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("wg-quick", [action, "wg0"], { stdio: "inherit" });
    p.on("error", () => resolve(127));
    p.on("close", (c) => resolve(c ?? 1));
  });
}

async function cmdSelect(): Promise<void> {
  const plan: WgPlan = { ...DEFAULT_PLAN, endpointHost: detectLanIp() };
  const sw = new TunnelSwitch().register(new WireGuardTransport(plan));
  const ep = await sw.select();
  console.log(ep ? JSON.stringify(ep) : "no healthy transport (is ollamas + tunnel up?)");
  process.exitCode = ep ? 0 : 1;
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
    case "select":
      return cmdSelect();
    default:
      console.log("usage: tunnel <config|up|down|select>");
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
