import test from "node:test";
import assert from "node:assert/strict";
import { buildDoctorReport, renderDoctorReport } from "./doctor.ts";

test("buildDoctorReport: ok mirrors upstream reachability", () => {
  const ok = buildDoctorReport({
    ollamasUpstream: { url: "http://localhost:3000/api/health", reachable: true, ms: 4 },
    active: "caddy-tls",
    connectivity: "online",
    capable: ["caddy-tls"],
  });
  assert.equal(ok.ok, true);
  const down = buildDoctorReport({
    ollamasUpstream: { url: "http://localhost:3000/api/health", reachable: false, ms: 0 },
    active: null,
    connectivity: "offline",
    capable: [],
  });
  assert.equal(down.ok, false);
});

test("renderDoctorReport: reachable shows OK + ms + success line", () => {
  const s = renderDoctorReport(
    buildDoctorReport({
      ollamasUpstream: { url: "http://localhost:3000/api/health", reachable: true, ms: 5 },
      active: "wireguard",
      connectivity: "lan-only",
      capable: ["wireguard"],
    }),
  );
  assert.match(s, /ollamas upstream : OK 5ms/);
  assert.match(s, /✓ ollamas is reachable/);
  assert.match(s, /active transport : wireguard/);
});

test("renderDoctorReport: unreachable shows UNREACHABLE + remediation", () => {
  const s = renderDoctorReport(
    buildDoctorReport({
      ollamasUpstream: { url: "http://localhost:3000/api/health", reachable: false, ms: 0 },
      active: null,
      connectivity: "offline",
      capable: [],
    }),
  );
  assert.match(s, /UNREACHABLE/);
  assert.match(s, /✗ ollamas upstream not reachable/);
  assert.match(s, /none \(install/);
});
