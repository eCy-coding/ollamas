import { WifiOff } from 'lucide-react';
import { useLingui } from '@lingui/react';
import { useOnline } from '../hooks/useOnline';

// vF15 — header badge shown only when the browser is offline; the Workbox cache
// still serves last-known data, so this tells the user the cockpit is stale.
// role="status" + aria-live announces the state change to assistive tech.
export function OfflineBadge() {
  const { _ } = useLingui();
  const online = useOnline();
  if (online) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      title={_('app.offline.hint')}
      className="flex items-center gap-1.5 text-xs text-status-warn bg-amber-500/15 border border-amber-500/20 px-3 py-1 rounded-full font-mono font-medium"
    >
      <WifiOff className="w-3.5 h-3.5" />
      {_('app.offline.badge')}
    </span>
  );
}
