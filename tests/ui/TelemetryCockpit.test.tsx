import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { TelemetryCockpit } from '../../src/components/TelemetryCockpit';
import { renderUI } from './helpers';

describe('TelemetryCockpit (pure)', () => {
  it('shows init placeholder when telemetry is null', () => {
    renderUI(<TelemetryCockpit telemetry={null} onRefresh={vi.fn()} />);
    expect(screen.getByText(/System initializes host telemetry channels/i)).toBeInTheDocument();
  });

  it('renders metric labels when telemetry is provided', () => {
    const telemetry = {
      mode: 'live',
      isLive: true,
      os: { platform: 'darwin', release: '24.6.0', arch: 'arm64', uptime: 1000 },
      metrics: { cpuLoad1Min: 1.2, memory: { total: 16, free: 8, percentageUsed: 50 } },
      workspacePath: '/tmp',
      permissions: {},
      hasBackupEnabled: false,
    } as never;
    renderUI(<TelemetryCockpit telemetry={telemetry} onRefresh={vi.fn()} />);
    expect(screen.getByText(/System Mode/i)).toBeInTheDocument();
    expect(screen.getByText(/OS Platform/i)).toBeInTheDocument();
  });
});
