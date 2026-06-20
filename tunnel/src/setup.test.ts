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

test("all capable, nothing configured → 3 configure steps", () => {
  const steps = planSetup(allCaps, noConfigs);
  assert.deepEqual(kindsToConfigure(steps), ["wireguard", "lan-tls", "mesh"]);
});

test("existing config → skip-exists (idempotent)", () => {
  const steps = planSetup(allCaps, { wireguard: true, lanTls: false, mesh: false });
  const wg = steps.find((s) => s.kind === "wireguard");
  assert.equal(wg?.status, "skip-exists");
  assert.deepEqual(kindsToConfigure(steps), ["lan-tls", "mesh"]);
});

test("missing binary → missing-binary + brew hint", () => {
  const steps = planSetup({ wgTools: false, caddy: false, mkcert: false, headscale: false }, noConfigs);
  for (const s of steps) assert.equal(s.status, "missing-binary");
  assert.match(steps[0]?.detail ?? "", /brew install wireguard-tools/);
  const tls = steps.find((s) => s.kind === "lan-tls");
  assert.match(tls?.detail ?? "", /brew install caddy mkcert/);
});

test("lan-tls needs BOTH caddy and mkcert", () => {
  const steps = planSetup({ wgTools: false, caddy: true, mkcert: false, headscale: false }, noConfigs);
  const tls = steps.find((s) => s.kind === "lan-tls");
  assert.equal(tls?.status, "missing-binary"); // mkcert missing → not capable
});

test("partial: only wg available → only wireguard configures", () => {
  const steps = planSetup({ wgTools: true, caddy: false, mkcert: false, headscale: false }, noConfigs);
  assert.deepEqual(kindsToConfigure(steps), ["wireguard"]);
});

test("renderSetupPlan: ready vs not-ready footer", () => {
  assert.match(renderSetupPlan(planSetup(allCaps, noConfigs)), /bringing the best one up/);
  assert.match(
    renderSetupPlan(planSetup({ wgTools: false, caddy: false, mkcert: false, headscale: false }, noConfigs)),
    /no usable transport/,
  );
});
