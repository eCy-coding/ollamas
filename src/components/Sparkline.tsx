// vF10 — zero-dependency SVG sparkline (pattern adopted from fnando/sparkline,
// MIT: normalize → <polyline>). stroke=currentColor so it inherits the theme/
// rating color; no chart library = no bundle cost.
interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  ariaLabel: string;
  className?: string;
}

export function Sparkline({ data, width = 100, height = 24, ariaLabel, className }: SparklineProps) {
  if (data.length === 0) {
    return <svg role="img" aria-label={ariaLabel} width={width} height={height} className={className} />;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pad = 2;
  const usableH = height - pad * 2;
  const points = data
    .map((v, i) => {
      const x = data.length > 1 ? (i / (data.length - 1)) * width : width / 2;
      const y = pad + usableH - ((v - min) / range) * usableH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
