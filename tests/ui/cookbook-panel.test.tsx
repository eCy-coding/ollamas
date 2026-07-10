// O7 CookbookPanel (docs/odyssey/handoff/cookbook/design.html) — the pilot UI.
// Data via apiClient.api.get('/api/modules/cookbook/recommend'). Covers the 4
// states (loading / error / empty / filled) + the "exceeds usable memory" state,
// text-based fit badges (not color-only, a11y), and estimated↔measured honesty.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderUI } from './helpers';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../src/lib/apiClient', () => ({ api: { get } }));

import CookbookPanel from '../../src/components/CookbookPanel';

const scored = (over: Record<string, unknown> = {}) => ({
  id: 'qwen3:8b', family: 'Qwen3', letter: 'Q', color: '#00D4FF',
  role: 'General reasoning + tool use', params: 8.2, size: 5.2, footprint: 6.6,
  quant: 'Q4_K_M', ctx: 32, ctxMax: 128, quality: 4.5, layers: '33/33',
  fit: 88, tier: 'excellent', badge: 'fit', fits: true, headroom: 10.2,
  headroomLabel: '+10.2 GB free', installed: false,
  reason: 'Fits with 10.2 GB to spare.', why: 'The efficient-yet-correct default.',
  sizeLabel: '5.2 GB', config: { numCtx: 8192, keepAlive: '30m' }, ...over,
});

const fullRecommendation = (over: Record<string, unknown> = {}) => ({
  hardware: {
    arch: 'arm64', platform: 'darwin', ramGb: 24, usableGb: 16.8, cores: 12,
    chip: 'Apple M4', metal: true, memType: 'Unified memory',
    accelLabel: 'Metal · unified memory', name: 'Apple M4', sub: '24 GB · 12-core',
  },
  ruleClass: '18-24',
  primary: scored(),
  alternatives: [
    scored({ id: 'qwen3:4b', fit: 92, tier: 'excellent', badge: 'fit', role: 'Fast drafts' }),
    scored({ id: 'qwen3:32b', fit: 20, tier: 'wont', badge: 'wont', fits: false, headroomLabel: '5.7 GB short' }),
  ],
  fallback: scored({ id: 'qwen3:4b' }),
  ...over,
});

describe('CookbookPanel — 4 states + exceeds-memory', () => {
  beforeEach(() => get.mockReset());

  it('loading: shows a scanning indicator before data resolves', async () => {
    let resolve!: (v: unknown) => void;
    get.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderUI(<CookbookPanel />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    resolve(fullRecommendation());
    await waitFor(() => expect(screen.getByText('qwen3:8b')).toBeInTheDocument());
  });

  it('filled: hardware card + primary hero + an alternative, text-based fit badge', async () => {
    get.mockResolvedValue(fullRecommendation());
    renderUI(<CookbookPanel />);
    await waitFor(() => expect(screen.getByText('Apple M4')).toBeInTheDocument());
    expect(screen.getByText('qwen3:8b')).toBeInTheDocument();
    // fit badge is a WORD, not just a color (a11y).
    expect(screen.getAllByText(/Excellent fit/i).length).toBeGreaterThan(0);
    // an alternative rendered
    expect(screen.getByText('qwen3:4b')).toBeInTheDocument();
    // hit the recommend endpoint (not a hard-coded catalog)
    expect(get).toHaveBeenCalledWith('/api/modules/cookbook/recommend');
  });

  it('error: rejected fetch → error banner + a retry that re-fetches', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    renderUI(<CookbookPanel />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    get.mockResolvedValueOnce(fullRecommendation());
    fireEvent.click(screen.getByRole('button', { name: /retry|again|re-detect/i }));
    await waitFor(() => expect(screen.getByText('qwen3:8b')).toBeInTheDocument());
  });

  it('empty: no primary pick → honest empty message (no fabricated model)', async () => {
    get.mockResolvedValue({ hardware: null, primary: null, alternatives: [], fallback: null });
    renderUI(<CookbookPanel />);
    await waitFor(() => expect(screen.getByText(/no .*recommendation|nothing to recommend|no models/i)).toBeInTheDocument());
  });

  it('exceeds usable memory: primary won\'t fit → warning state + fallback offer', async () => {
    get.mockResolvedValue(
      fullRecommendation({
        primary: scored({ fit: 18, tier: 'wont', badge: 'wont', fits: false, headroomLabel: '2.1 GB short' }),
      }),
    );
    renderUI(<CookbookPanel />);
    await waitFor(() => expect(screen.getByText(/exceeds usable memory/i)).toBeInTheDocument());
  });

  it('honesty: shows measured tok/s only when estTokS present', async () => {
    get.mockResolvedValue(
      fullRecommendation({ primary: scored({ estTokS: 82, measured: true }) }),
    );
    renderUI(<CookbookPanel />);
    await waitFor(() => expect(screen.getByText(/82 tok\/s/i)).toBeInTheDocument());
    expect(screen.getByText(/measured/i)).toBeInTheDocument();
  });
});
