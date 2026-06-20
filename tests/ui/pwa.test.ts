import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// vF4 — guard the PWA/iOS contract at the source level (no build dependency):
// the meta tags, icon asset, and plugin config that make the cockpit installable.
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('vF4 — PWA / iOS web-clip', () => {
  it('index.html declares iOS web-clip meta + icons', () => {
    const html = read('index.html');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-mobile-web-app-status-bar-style');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('viewport-fit=cover');
  });

  it('ships an app icon asset', () => {
    expect(existsSync(resolve(root, 'public/pwa-icon.svg'))).toBe(true);
  });

  it('vite config registers VitePWA with a standalone manifest', () => {
    const cfg = read('vite.config.ts');
    expect(cfg).toContain('VitePWA(');
    expect(cfg).toContain("registerType: 'autoUpdate'");
    expect(cfg).toContain("display: 'standalone'");
    expect(cfg).toContain('runtimeCaching');
  });

  it('vF15 — caches GET /api/* network-first for offline resilience', () => {
    const cfg = read('vite.config.ts');
    expect(cfg).toContain("cacheName: 'ollamas-api'");
    expect(cfg).toContain("url.pathname.startsWith('/api/')");
    expect(cfg).toContain("handler: 'NetworkFirst'");
  });
});
