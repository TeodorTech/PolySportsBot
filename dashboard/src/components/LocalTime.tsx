'use client';

export default function LocalTime({ iso, className, style }: { iso: string; className?: string; style?: React.CSSProperties }) {
  const date = new Date(iso);
  const formatted = date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return <span className={className} style={style}>{formatted}</span>;
}
