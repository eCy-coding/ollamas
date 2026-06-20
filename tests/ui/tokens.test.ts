import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// vF5 — tokens/*.json is the single source of truth. Guard that the generated
// CSS is in sync (regenerating produces the committed output) and that Tailwind
// @theme actually consumes the token vars rather than re-hardcoding hex values.
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('vF5 — design tokens', () => {
  it('generated tokens.css exposes the --ollamas-* vars', () => {
    const css = read('src/styles/tokens.css');
    expect(css).toContain('--ollamas-color-bg-base: #050608');
    expect(css).toContain('--ollamas-color-accent-indigo: #6366f1');
    expect(css).toContain('--ollamas-font-sans:');
  });

  it('index.css @theme references token vars, not raw hex', () => {
    const css = read('src/index.css');
    expect(css).toContain('var(--ollamas-color-bg-base)');
    expect(css).toContain('@import "./styles/tokens.css"');
    expect(css).not.toMatch(/--color-immersive-bg:\s*#/);
  });

  it('tokens.css is in sync with tokens/*.json (regen is a no-op)', () => {
    const before = read('src/styles/tokens.css');
    execFileSync('npx', ['style-dictionary', 'build', '--config', 'style-dictionary.config.js'], {
      cwd: root,
      stdio: 'ignore',
    });
    const after = read('src/styles/tokens.css');
    expect(after).toBe(before);
  });
});
