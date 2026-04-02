'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { TIME_RANGES, TimeRange, DEFAULT_RANGE } from '@/lib/timeRange';

interface Props {
  current: TimeRange;
  labelMap: Record<string, string>;
}

export default function TimeRangeFilter({ current, labelMap }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleSelect = useCallback(
    (range: TimeRange) => {
      const params = new URLSearchParams(searchParams.toString());
      if (range === DEFAULT_RANGE) {
        params.delete('range');
      } else {
        params.set('range', range);
      }
      params.delete('page');
      const qs = params.toString();
      router.push(pathname + (qs ? '?' + qs : ''));
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {TIME_RANGES.map(({ value, labelKey }) => {
        const isActive = value === current;
        return (
          <button
            key={value}
            onClick={() => handleSelect(value)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all"
            style={{
              background: isActive ? 'var(--amber)' : 'var(--surface2)',
              color: isActive ? 'var(--bg)' : 'var(--subtle)',
              border: `1px solid ${isActive ? 'var(--amber)' : 'var(--border)'}`,
            }}
          >
            {labelMap[labelKey]}
          </button>
        );
      })}
    </div>
  );
}
