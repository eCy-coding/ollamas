// vF8 — zero-dep loading skeleton. Pure CSS shimmer (token colors, see index.css
// `.ollamas-skeleton`), honours prefers-reduced-motion. Decorative → aria-hidden;
// wrap the loading region in an element with aria-busy="true" for screen readers.
interface SkeletonProps {
  width?: string;
  height?: string;
  rounded?: string;
  count?: number;
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = '1rem',
  rounded = 'var(--ollamas-radius-md)',
  count = 1,
  className = '',
}: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`ollamas-skeleton ${className}`}
          style={{ width, height, borderRadius: rounded }}
        />
      ))}
    </>
  );
}
