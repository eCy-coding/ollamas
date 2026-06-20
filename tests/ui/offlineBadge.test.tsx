import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderUI } from './helpers';
import { OfflineBadge } from '../../src/components/OfflineBadge';
import { activateLocale } from '../../src/lib/i18n';

describe('OfflineBadge (vF15)', () => {
  let onlineGetter: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    activateLocale('en');
    onlineGetter = vi.spyOn(navigator, 'onLine', 'get');
  });
  afterEach(() => onlineGetter.mockRestore());

  it('renders nothing when online', () => {
    onlineGetter.mockReturnValue(true);
    const { container } = renderUI(<OfflineBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an offline status badge (role=status) when offline', () => {
    onlineGetter.mockReturnValue(false);
    renderUI(<OfflineBadge />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(/Offline/i);
    expect(badge).toHaveAttribute('aria-live', 'polite');
  });
});
