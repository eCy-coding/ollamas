import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ErrorBoundary } from 'react-error-boundary';
import { ErrorFallback } from '../../src/components/ErrorFallback';
import { renderUI } from './helpers';

function Boom(): never {
  throw new Error('kaboom in panel');
}

describe('vF8 — ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the fallback and calls onError when a child throws', () => {
    // React logs the caught error; silence it so the run stays clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();

    renderUI(
      <ErrorBoundary FallbackComponent={ErrorFallback} onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Something broke in the cockpit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
