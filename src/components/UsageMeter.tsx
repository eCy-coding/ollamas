import type { UsageStatus } from '../lib/usage';

// vF12 — accessible quota meter. A quota is a quantity in a known range, so this
// uses role="meter" (not progressbar) per WAI-ARIA; zero-dep, theme-aware bar.
const STATUS_COLOR: Record<UsageStatus, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  over: 'bg-rose-500',
};

export function UsageMeter({
  percent,
  label,
  status,
}: {
  percent: number;
  label: string;
  status: UsageStatus;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="meter"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${clamped}%`}
      aria-label={label}
      className="w-full bg-immersive-panel rounded-full h-2.5 border border-immersive-border overflow-hidden"
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${STATUS_COLOR[status]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
