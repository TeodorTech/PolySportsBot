'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { VOLUME_OPTIONS, DEFAULT_MIN_VOLUME, type MinVolumeThreshold } from '@/lib/thresholds';

function formatVolume(val: number): string {
  if (val === 0) return 'Any volume';
  if (val >= 1_000_000) return `$${val / 1_000_000}M+`;
  return `$${val / 1000}k+`;
}

interface Props {
  current: MinVolumeThreshold;
}

export default function MinVolumeFilter({ current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = Number(e.target.value) as MinVolumeThreshold;
      const params = new URLSearchParams(searchParams.toString());
      if (value === DEFAULT_MIN_VOLUME) {
        params.delete('minVolume');
      } else {
        params.set('minVolume', String(value));
      }
      router.push(pathname + '?' + params.toString());
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider shrink-0" style={{ color: 'var(--subtle)' }}>
        Vol
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
        {VOLUME_OPTIONS.map(val => (
          <option key={val} value={val}>
            {formatVolume(val)}
          </option>
        ))}
      </select>
    </div>
  );
}
