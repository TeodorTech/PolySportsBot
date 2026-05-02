'use client';

import { useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { getSportEmoji } from '@/lib/sportEmoji';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { OVERALL_STAKE } from '@/lib/roi';
import { formatVolume } from '@/lib/format';

export interface TeamRow {
  key: string;
  sport: string;
  outcome: string;
  events: number;
  wins: number;
  winRate: number;
  expectedWinRate: number;
  edge: number;
  volume: number;
  convictionEvents: number;
  roi: number | null;
  roiPnl: number | null;
  roiEventCount: number;
}

interface Props {
  rows: TeamRow[];
  labels: {
    team: string;
    backed: string;
    winRate: string;
    expected: string;
    edge: string;
    volume: string;
    roi: string;
    conviction: string;
  };
  pageSize?: number;
}

export default function TeamsLeaderboard({ rows, labels, pageSize = 10 }: Props) {
  const [page, setPage] = useState(0);
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || 'en';
  const qs = searchParams?.toString();
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  const hrefFor = (key: string) => {
    const path = `/${locale}/teams/${encodeURIComponent(key)}`;
    return qs ? `${path}?${qs}` : path;
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ background: 'var(--surface)', color: 'var(--subtle)' }}>
              <th className="px-5 py-3 text-left">{labels.team}</th>
              <th className="px-3 py-3 text-right">{labels.backed}</th>
              <th className="px-3 py-3 text-right">{labels.winRate}</th>
              <th className="px-3 py-3 text-right">{labels.expected}</th>
              <th className="px-3 py-3 text-right">{labels.edge}</th>
              <th className="px-3 py-3 text-right">{labels.volume}</th>
              <th className="px-5 py-3 text-right">{labels.roi}</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {pageRows.map((s) => {
              const edgeColor = s.edge >= 5 ? 'var(--green)' : s.edge >= 0 ? 'var(--amber)' : 'var(--red)';
              const roiColor = s.roi === null ? 'var(--subtle)' : s.roi >= 0 ? 'var(--green)' : 'var(--red)';
              return (
                <tr
                  key={s.key}
                  className="team-row cursor-pointer"
                  style={{ background: 'var(--surface)' }}
                  onClick={() => router.push(hrefFor(s.key))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(hrefFor(s.key));
                    }
                  }}
                  tabIndex={0}
                  role="link"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg shrink-0 w-7 text-center">{getSportEmoji('', s.sport)}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{s.outcome}</div>
                        <div className="text-xs" style={{ color: 'var(--subtle)' }}>
                          {s.sport}
                          {s.convictionEvents > 0 && (
                            <> · <span style={{ color: 'var(--amber)' }}>{s.convictionEvents} {labels.conviction.toLowerCase()}</span></>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>
                    {s.wins}W {s.events - s.wins}L
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold" style={{ color: 'var(--amber)' }}>
                    {s.winRate.toFixed(0)}%
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>
                    {s.expectedWinRate.toFixed(0)}%
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-bold" style={{ color: edgeColor }}>
                    {s.edge >= 0 ? '+' : ''}{s.edge.toFixed(1)}pp
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs" style={{ color: 'var(--muted)' }}>
                    {formatVolume(s.volume)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono font-semibold text-xs" style={{ color: roiColor }}>
                    {s.roi !== null ? (
                      <>
                        {s.roi >= 0 ? '+' : ''}{s.roi.toFixed(0)}%
                        <span className="block text-[10px] font-normal" style={{ color: 'var(--subtle)' }}>
                          {s.roiPnl! >= 0 ? '+' : ''}${s.roiPnl!.toFixed(0)} / ${OVERALL_STAKE}·{s.roiEventCount}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--subtle)' }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)} of {rows.length}
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
