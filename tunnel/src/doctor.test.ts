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

// ---------- vT12: proxy gateway doctor phase ----------

test("doctor: proxy section rendered when present (auth-reject + auth-ok)", () => {
  const r = buildDoctorReport({
    ollamasUpstream: { url: "http://localhost:3000/api/health", reachable: true, ms: 20 },
    active: "caddy-tls",
    connectivity: "online",
    capable: ["caddy-tls"],
    proxy: { running: true, authRejects: true, authOkMs: 12 },
  });
  const out = renderDoctorReport(r);
  assert.match(out, /proxy gateway {2,}: UP/);
  assert.match(out, /401 without key: OK/);
  assert.match(out, /keyed \/api\/health: OK 12ms/);
});

test("doctor: proxy auth NOT rejecting unauthenticated = flagged", () => {
  const r = buildDoctorReport({
    ollamasUpstream: { url: "http://localhost:3000/api/health", reachable: true, ms: 20 },
    active: null,
    connectivity: "offline",
    capable: [],
    proxy: { running: true, authRejects: false, authOkMs: null },
  });
  assert.match(renderDoctorReport(r), /401 without key: FAIL/);
});

test("doctor: report without proxy section renders unchanged (back-compat)", () => {
  const r = buildDoctorReport({
    ollamasUpstream: { url: "u", reachable: true, ms: 1 },
    active: null,
    connectivity: "offline",
    capable: [],
  });
  assert.ok(!renderDoctorReport(r).includes("proxy gateway"));
});
