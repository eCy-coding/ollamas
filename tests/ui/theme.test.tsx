import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderUI } from './helpers';
import { ThemeToggle } from '../../src/components/ThemeToggle';

// vF9 — theme flips the single [data-theme] attribute + persists the choice.
describe('ThemeToggle (vF9)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark, flips to light on click, persists, and reflects aria-pressed', async () => {
    renderUI(<ThemeToggle />);
    // ThemeProvider effect applied the default (matchMedia stub → dark).
    expect(document.documentElement.dataset.theme).toBe('dark');

    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false'); // dark active → light not pressed

    await userEvent.click(btn);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('ollamas.theme')).toBe('light');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });
});
