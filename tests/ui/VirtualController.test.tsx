import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtualController } from '../../src/components/VirtualController';
import { renderUI, mockFetch } from './helpers';

describe('VirtualController', () => {
  it('renders heading + control buttons', () => {
    renderUI(<VirtualController />);
    expect(screen.getByRole('heading', { name: /virtual controller/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /press enter/i })).toBeInTheDocument();
  });

  it('POSTs to /api/cluster/execute when a control button is clicked', async () => {
    const fetchSpy = mockFetch({ '/api/cluster/execute': { ok: true } });
    const user = userEvent.setup();
    renderUI(<VirtualController />);

    await user.click(screen.getByRole('button', { name: /press enter/i }));

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/cluster/execute',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
