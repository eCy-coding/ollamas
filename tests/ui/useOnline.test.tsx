import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnline } from '../../src/hooks/useOnline';

describe('useOnline (vF15)', () => {
  let onlineGetter: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    onlineGetter = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });
  afterEach(() => onlineGetter.mockRestore());

  it('reflects the initial navigator.onLine value', () => {
    onlineGetter.mockReturnValue(false);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(false);
  });

  it('flips on offline/online events', () => {
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current).toBe(false);
    act(() => window.dispatchEvent(new Event('online')));
    expect(result.current).toBe(true);
  });

  it('removes its listeners on unmount (no post-unmount update)', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useOnline());
    unmount();
    expect(remove).toHaveBeenCalledWith('online', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('offline', expect.any(Function));
    remove.mockRestore();
  });
});
