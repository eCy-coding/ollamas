import { createContext, useContext, type ReactNode } from 'react';
import { hasCapability, type Capability, type Permissions } from '../lib/capabilities';

// vF11 — AccessGate pattern (adopted from rbac-ui, reimplemented zero-dep).
// Context holds the backend-granted permissions (null = unknown → deny-by-default).
// This is UX reflection of the backend grant, NOT a security boundary (the
// boundary is the backend ToolRegistry tier-allowlist).
const CapabilityContext = createContext<Permissions | null>(null);

export function CapabilityProvider({
  permissions,
  children,
}: {
  permissions: Permissions | null;
  children: ReactNode;
}) {
  return <CapabilityContext.Provider value={permissions}>{children}</CapabilityContext.Provider>;
}

// Deny-by-default: no provider / unknown permissions → false.
export function useCapability(cap: Capability): boolean {
  return hasCapability(useContext(CapabilityContext), cap);
}

// Render children only when the capability is granted; otherwise the fallback.
export function CapabilityGate({
  need,
  fallback = null,
  children,
}: {
  need: Capability;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return <>{useCapability(need) ? children : fallback}</>;
}
