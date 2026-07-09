import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  buildConstantMap,
  parseServerRoutes,
  parseCallerEndpoints,
  computeRouteReports,
  deadRoutes,
  PRIVILEGED_ALLOWLIST,
} from '../route-usage';

describe('normalizePath', () => {
  it('replaces :params with *', () => {
    expect(normalizePath('/api/models/:provider')).toBe('/api/models');
    expect(normalizePath('/api/saas/keys/:id/revoke')).toBe('/api/saas/keys/*/revoke');
  });
  it('replaces complete ${expr} segments and keeps the tail', () => {
    expect(normalizePath('/api/github/actions/runs/${id}/jobs')).toBe('/api/github/actions/runs/*/jobs');
  });
  it('drops unclosed template / markup / query junk', () => {
    expect(normalizePath('/api/billing/preview${period')).toBe('/api/billing/preview');
    expect(normalizePath('/api/health</code>')).toBe('/api/health');
    expect(normalizePath('/api/threatfeed?refresh=1')).toBe('/api/threatfeed');
  });
  it('strips trailing slash and prose punctuation', () => {
    expect(normalizePath('/api/logbook.')).toBe('/api/logbook');
    expect(normalizePath('/api/backup/')).toBe('/api/backup');
  });
});

describe('buildConstantMap', () => {
  it('resolves exported string path constants', () => {
    const map = buildConstantMap(['export const REGISTRATION_PATH = "/register";']);
    expect(map.REGISTRATION_PATH).toBe('/register');
  });
});

describe('parseServerRoutes', () => {
  const src = `
    app.get("/api/health", h);
    app.post("/api/keys/:id/revoke", h);
    app.use("/api/ecysearcher", proxy);
    app.get(REGISTRATION_PATH, h);
    app.use(express.json());
  `;
  const routes = parseServerRoutes(src, { REGISTRATION_PATH: '/register' });
  it('captures literal + constant routes, marks mounts, skips middleware-only use', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/api/health');
    expect(paths).toContain('/register');
    expect(paths).not.toContain('express.json'); // middleware-only app.use dropped
    const mount = routes.find((r) => r.path === '/api/ecysearcher');
    expect(mount?.isMount).toBe(true);
  });
});

describe('computeRouteReports + deadRoutes', () => {
  const routes = parseServerRoutes(
    `app.get("/api/used", h);
     app.get("/api/dead", h);
     app.post("/api/macos-terminal", h);
     app.use("/api/proxy", p);`,
    {},
  );
  const callers = parseCallerEndpoints([`fetch('/api/used'); fetch('/api/proxy/sub');`]);
  const reports = computeRouteReports(routes, callers);

  it('marks referenced routes used and mount used via sub-path', () => {
    expect(reports.find((r) => r.path === '/api/used')?.used).toBe(true);
    expect(reports.find((r) => r.path === '/api/proxy')?.used).toBe(true);
  });
  it('never flags allowlisted privileged routes as dead', () => {
    expect(PRIVILEGED_ALLOWLIST).toContain('/api/macos-terminal');
    const dead = deadRoutes(reports).map((r) => r.path);
    expect(dead).not.toContain('/api/macos-terminal');
    expect(dead).toContain('/api/dead');
  });
});
