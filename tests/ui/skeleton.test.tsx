import { describe, expect, it } from 'vitest';
import { Skeleton } from '../../src/components/Skeleton';
import { renderUI } from './helpers';

describe('vF8 — Skeleton', () => {
  it('renders `count` decorative shimmer bars', () => {
    const { container } = renderUI(<Skeleton count={3} height="2rem" />);
    const bars = container.querySelectorAll('.ollamas-skeleton');
    expect(bars.length).toBe(3);
    // decorative → hidden from the a11y tree (the busy region carries the label)
    bars.forEach((b) => expect(b).toHaveAttribute('aria-hidden', 'true'));
  });

  it('applies sizing via inline style', () => {
    const { container } = renderUI(<Skeleton width="50%" height="1rem" />);
    const bar = container.querySelector('.ollamas-skeleton') as HTMLElement;
    expect(bar.style.width).toBe('50%');
    expect(bar.style.height).toBe('1rem');
  });
});
