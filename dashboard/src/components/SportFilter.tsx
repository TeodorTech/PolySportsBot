'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { getSportEmoji } from '@/lib/sportEmoji';

interface Props {
  current: string[] | null;
  sports: string[];
}

export default function SportFilter({ current, sports }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const toggle = useCallback((sport: string) => {
    const active = new Set(current ?? []);
    if (active.has(sport)) active.delete(sport);
    else active.add(sport);
    const params = new URLSearchParams(searchParams.toString());
    if (active.size === 0) params.delete('sports');
    else params.set('sports', Array.from(active).join(','));
    router.push(pathname + '?' + params.toString());
  }, [current, router, pathname, searchParams]);

  const clearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('sports');
    router.push(pathname + '?' + params.toString());
  }, [router, pathname, searchParams]);

  if (sports.length === 0) return null;

  const active = new Set(current ?? []);
  const allSelected = active.size === 0;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={clearAll}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
        style={{
          background: allSelected ? 'var(--amber)' : 'var(--surface2)',
          color: allSelected ? 'var(--bg)' : 'var(--subtle)',
          border: `1px solid ${allSelected ? 'var(--amber)' : 'var(--border)'}`,
          cursor: 'pointer',
        }}
      >
        All
      </button>
      {sports.map(s => {
        const isActive = active.has(s);
        return (
          <button
            key={s}
            onClick={() => toggle(s)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: isActive ? 'var(--amber)' : 'var(--surface2)',
              color: isActive ? 'var(--bg)' : 'var(--subtle)',
              border: `1px solid ${isActive ? 'var(--amber)' : 'var(--border)'}`,
              cursor: 'pointer',
            }}
          >
            {getSportEmoji('', s)} {s}
          </button>
        );
      })}
    </div>
  );
}
