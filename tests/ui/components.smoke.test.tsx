import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderUI, mockFetch } from './helpers';

import { KeyVault } from '../../src/components/KeyVault';
import { MultiAgentPipeline } from '../../src/components/MultiAgentPipeline';
import { ReactAgentTab } from '../../src/components/ReactAgentTab';
import { WorkspaceTree } from '../../src/components/WorkspaceTree';
import { CommandLineTerminal } from '../../src/components/CommandLineTerminal';
import { BackupControl } from '../../src/components/BackupControl';
import { SelfTestGates } from '../../src/components/SelfTestGates';
import { SecurityPolicies } from '../../src/components/SecurityPolicies';
import { ClusterManager } from '../../src/components/ClusterManager';
import { SaaSAdmin } from '../../src/components/SaaSAdmin';

const noop = vi.fn();

// Each network component mounts with mocked fetch (default empty-ok) and must
// render its anchor text without throwing. anchor = stable label/heading.
// routes: endpoints that must return an array (component calls .map/.filter on
// the raw json). Default mock returns {} which is fine for object-shaped responses.
const cases: Array<{ name: string; el: ReactElement; anchor: RegExp; routes?: Record<string, unknown> }> = [
  { name: 'KeyVault', el: <KeyVault onNotify={noop} />, anchor: /Cryptographic API Key Vault/i },
  { name: 'MultiAgentPipeline', el: <MultiAgentPipeline onNotify={noop} workspacePath="/tmp" />, anchor: /Multi-Agent Development Pipeline/i, routes: { '/api/models/': [] } },
  { name: 'ReactAgentTab', el: <ReactAgentTab onNotify={noop} />, anchor: /Select Agent Provider/i, routes: { '/api/models/': [], '/api/agent/sessions': [] } },
  { name: 'WorkspaceTree', el: <WorkspaceTree onNotify={noop} activePath="/tmp" onPathChange={noop} isLive={false} />, anchor: /Target Directory Explorer/i },
  { name: 'CommandLineTerminal', el: <CommandLineTerminal onNotify={noop} isLive={false} />, anchor: /Interactive Sandbox Terminal/i },
  { name: 'BackupControl', el: <BackupControl onNotify={noop} />, anchor: /Client-Side Encrypted Backups/i },
  { name: 'SelfTestGates', el: <SelfTestGates />, anchor: /Verification Gates/i },
  { name: 'SecurityPolicies', el: <SecurityPolicies onNotify={noop} permissions={{} as never} onPermissionsChange={noop} />, anchor: /Security & Permissions Journal/i, routes: { '/api/security/log': [] } },
  { name: 'ClusterManager', el: <ClusterManager onNotify={noop} />, anchor: /Informed Consent Required/i },
  { name: 'SaaSAdmin', el: <SaaSAdmin onNotify={noop} />, anchor: /Upstream MCP servers/i },
];

describe('network components smoke', () => {
  it.each(cases)('$name renders its anchor without crashing', async ({ el, anchor, routes }) => {
    mockFetch(routes ?? {});
    renderUI(el);
    await waitFor(() => expect(screen.getAllByText(anchor).length).toBeGreaterThan(0));
  });
});
