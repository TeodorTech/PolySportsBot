'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { MIN_ODDS_OPTIONS, DEFAULT_MIN_ODDS, type MinOddsThreshold } from '@/lib/thresholds';

interface Props {
  current: MinOddsThreshold;
}

function formatOdds(val: number): string {
  if (val === 1) return 'Any odds';
  if (val === 2) return '≥ 2.0';
  return `≥ ${val.toFixed(1)}`;
}

export default function MinOddsFilter({ current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = Number(e.target.value) as MinOddsThreshold;
      const params = new URLSearchParams(searchParams.toString());
      if (value === DEFAULT_MIN_ODDS) {
        params.delete('minOdds');
      } else {
        params.set('minOdds', String(value));
      }
      router.push(pathname + '?' + params.toString());
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider shrink-0" style={{ color: 'var(--subtle)' }}>
        Odds
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
        {MIN_ODDS_OPTIONS.map((val) => (
          <option key={val} value={val}>
            {formatOdds(val)}
          </option>
        ))}
      </select>
    </div>
  );
}
