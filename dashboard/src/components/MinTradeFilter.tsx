'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { THRESHOLD_OPTIONS, DEFAULT_THRESHOLD, type MinTradeThreshold } from '@/lib/thresholds';

interface Props {
  current: MinTradeThreshold;
}

function formatThreshold(val: number): string {
  return `$${(val / 1000).toFixed(0)}k+`;
}

export default function MinTradeFilter({ current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = Number(e.target.value) as MinTradeThreshold;
      const params = new URLSearchParams(searchParams.toString());
      if (value === DEFAULT_THRESHOLD) {
        params.delete('minTrade');
      } else {
        params.set('minTrade', String(value));
      }
      router.push(pathname + '?' + params.toString());
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
        Min trade
      </span>
      <select
        value={current}
        onChange={handleChange}
        className="text-xs font-semibold font-mono rounded-lg px-2 py-1.5 appearance-none cursor-pointer"
        style={{
          background: 'var(--surface2)',
          color: 'var(--amber)',
          border: '1px solid var(--border)',
          outline: 'none',
        }}
      >
        {THRESHOLD_OPTIONS.map((val) => (
          <option key={val} value={val}>
            {formatThreshold(val)}
          </option>
        ))}
      </select>
    </div>
  );
}
