'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { consensusColor } from '@/lib/thresholds';
import { formatVolume } from '@/lib/format';
import LocalTime from '@/components/LocalTime';

export interface TeamEventRow {
  event_id: string;
  title: string;
  date: string;
  game_start_time: string | null;
  won: boolean;
  result_outcome: string | null;
  team_volume: number;
  avg_price: number;
  big_trades: number;
  consensus: number | null;
  odds: number | null;
  pnl: number | null;
}

interface Props {
  events: TeamEventRow[];
  locale: string;
  labels: {
    event: string;
    result: string;
    volume: string;
    consensus: string;
    odds: string;
    pnl: string;
    conviction: string;
  };
  pageSize?: number;
}

export default function TeamEventHistory({ events, locale, labels, pageSize = 10 }: Props) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(events.length / pageSize));
  const pageRows = events.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ background: 'var(--surface)', color: 'var(--subtle)' }}>
              <th className="px-5 py-3 text-left">{labels.event}</th>
              <th className="px-3 py-3 text-right">{labels.result}</th>
              <th className="px-3 py-3 text-right">{labels.volume}</th>
              <th className="px-3 py-3 text-right">{labels.consensus}</th>
              <th className="px-3 py-3 text-right">{labels.odds}</th>
              <th className="px-5 py-3 text-right">{labels.pnl}</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {pageRows.map((e) => (
              <tr key={e.event_id} style={{ background: 'var(--surface)' }}>
                <td className="px-5 py-3 max-w-[360px]">
                  <Link
                    href={`/${locale}/events/${e.event_id}`}
                    className="block min-w-0 hover:underline"
                    style={{ color: 'var(--text)' }}
                  >
                    <div className="text-sm font-semibold truncate">{e.title}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                      <LocalTime iso={e.game_start_time || e.date} />
                      {e.big_trades > 0 && (
                        <> · <span style={{ color: 'var(--amber)' }}>{e.big_trades} {labels.conviction.toLowerCase()}</span></>
                      )}
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-3 text-right">
                  <span
                    className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-bold"
                    style={{
                      background: e.won ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: e.won ? 'var(--green)' : 'var(--red)',
                      border: `1px solid ${e.won ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    }}
                  >
                    {e.won ? 'W' : 'L'}
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>
                  {formatVolume(e.team_volume)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-semibold text-xs" style={{ color: e.consensus !== null ? consensusColor(e.consensus) : 'var(--subtle)' }}>
                  {e.consensus !== null ? `${e.consensus.toFixed(0)}%` : '—'}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>
                  {e.odds !== null ? e.odds.toFixed(2) : '—'}
                </td>
                <td className="px-5 py-3 text-right font-mono font-semibold text-xs" style={{ color: e.pnl === null ? 'var(--subtle)' : e.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {e.pnl === null ? '—' : `${e.pnl >= 0 ? '+' : ''}$${e.pnl.toFixed(0)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, events.length)} of {events.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded transition-opacity disabled:opacity-30"
              style={{ color: 'var(--text)' }}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-mono px-2" style={{ color: 'var(--subtle)' }}>
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="p-1 rounded transition-opacity disabled:opacity-30"
              style={{ color: 'var(--text)' }}
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
