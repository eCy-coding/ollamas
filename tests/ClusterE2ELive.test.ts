import { expect, test } from 'vitest';

/**
 * LIVE E2E for Cluster Mesh — requires an already-running server.
 * Opt-in via RUN_LIVE_E2E=1 (with the server up on TEST_BASE_URL or :3000),
 * so the default `vitest run` stays hermetic. The hermetic gateway E2E lives in
 * mcp-gateway.e2e.test.ts (self-boots its own server).
 */

// Live server base. Node fetch needs an absolute URL; override via TEST_BASE_URL.
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const live = process.env.RUN_LIVE_E2E === '1';

// gated: RUN_LIVE_E2E=1 — needs the server up on TEST_BASE_URL (default :3000).
test.skipIf(!live)('Cluster Mesh orchestrator integration (live)', async () => {
    // 1. Consent flow
    const consentRes = await fetch(`${BASE}/api/cluster/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, termsHash: 'test-hash' })
    });
    expect(consentRes.status).toBe(200);

    // 2. Status verification
    const statusRes = await fetch(`${BASE}/api/cluster/status`);
    const statusData = await statusRes.json();
    expect(statusData).toHaveProperty('status');
    
    // Performance flag check (should be default or set)
    console.log("Cluster status report:", statusData);
});
