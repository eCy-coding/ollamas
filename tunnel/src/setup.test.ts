import test from "node:test";
import assert from "node:assert/strict";
import {
  kindsToConfigure,
  planSetup,
  renderSetupPlan,
  type Capabilities,
  type ExistingConfigs,
} from "./setup.ts";

const allCaps: Capabilities = { wgTools: true, caddy: true, mkcert: true, headscale: true };
const noConfigs: ExistingConfigs = { wireguard: false, lanTls: false, mesh: false };

test("all capable, nothing configured → 4 configure steps (incl. proxy, vT12)", () => {
  const steps = planSetup(allCaps, noConfigs);
  assert.deepEqual(kindsToConfigure(steps), ["wireguard", "lan-tls", "mesh", "proxy"]);
});

test("existing config → skip-exists (idempotent)", () => {
  const steps = planSetup(allCaps, { wireguard: true, lanTls: false, mesh: false });
  const wg = steps.find((s) => s.kind === "wireguard");
  assert.equal(wg?.status, "skip-exists");
  assert.deepEqual(kindsToConfigure(steps), ["lan-tls", "mesh", "proxy"]);
});

test("missing binary → missing-binary + brew hint (proxy exempt: node built-in)", () => {
  const steps = planSetup({ wgTools: false, caddy: false, mkcert: false, headscale: false }, noConfigs);
  for (const s of steps) {
    if (s.kind === "proxy") continue; // proxy needs no external binary
    assert.equal(s.status, "missing-binary");
  }
  assert.match(steps[0]?.detail ?? "", /brew install wireguard-tools/);
  const tls = steps.find((s) => s.kind === "lan-tls");
  assert.match(tls?.detail ?? "", /brew install caddy mkcert/);
});

test("lan-tls needs BOTH caddy and mkcert", () => {
  const steps = planSetup({ wgTools: false, caddy: true, mkcert: false, headscale: false }, noConfigs);
  const tls = steps.find((s) => s.kind === "lan-tls");
  assert.equal(tls?.status, "missing-binary"); // mkcert missing → not capable
});

test("partial: only wg available → wireguard + proxy configure", () => {
  const steps = planSetup({ wgTools: true, caddy: false, mkcert: false, headscale: false }, noConfigs);
  assert.deepEqual(kindsToConfigure(steps), ["wireguard", "proxy"]);
});

test("renderSetupPlan: ready vs not-ready footer", () => {
  assert.match(renderSetupPlan(planSetup(allCaps, noConfigs)), /bringing the best one up/);
  assert.match(
    renderSetupPlan(planSetup({ wgTools: false, caddy: false, mkcert: false, headscale: false }, noConfigs)),
    /no usable transport/,
  );
});

// ---------- vT12: proxy gateway setup step ----------

test("planSetup: proxy step configures when no vault exists (no binary needed)", () => {
  const steps = planSetup(allCaps, { ...noConfigs, proxy: false });
  const proxy = steps.find((s) => s.kind === "proxy");
  assert.ok(proxy);
  assert.equal(proxy.status, "configure");
});

test("planSetup: proxy step idempotent-skips when vault present", () => {
  const steps = planSetup(allCaps, { ...noConfigs, proxy: true });
  assert.equal(steps.find((s) => s.kind === "proxy")?.status, "skip-exists");
});

test("planSetup: proxy omitted from ExistingConfigs → treated as absent (back-compat)", () => {
  const steps = planSetup(allCaps, noConfigs);
  assert.equal(steps.find((s) => s.kind === "proxy")?.status, "configure");
});
