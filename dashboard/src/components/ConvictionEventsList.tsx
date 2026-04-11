'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getSportEmoji } from '@/lib/sportEmoji';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ConvictionEvent {
  id: string;
  title: string;
  sport: string | null;
  odds: string | null;
  result_outcome: string | null;
  big_trade_outcome: string | null;
  big_trade_volume: string;
  big_trade_count: string;
  avg_price: string;
  total_whale_volume: string;
}

interface Props {
  events: ConvictionEvent[];
  locale: string;
  labels: {
    convictionBacked: string;
    convictionResult: string;
    impliedProb: string;
    decimalOdds: string;
    settledOdds: string;
    convictionTradesSuffix: string;
    statusWin: string;
    statusLoss: string;
  };
  pageSize?: number;
}

export default function ConvictionEventsList({ events, locale, labels, pageSize = 10 }: Props) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(events.length / pageSize);
  const pageEvents = events.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div>
      <div className="divide-y" style={{ borderColor: 'var(--border)', borderTop: '1px solid var(--border)' }}>
        {pageEvents.map((event) => {
          const emoji = getSportEmoji(event.title, event.sport);
          const won = event.result_outcome && event.big_trade_outcome && event.result_outcome === event.big_trade_outcome;
          const impliedProb = Number(event.avg_price) * 100;
          const entryOdds = Number(event.avg_price) > 0 ? 1 / Number(event.avg_price) : null;
          const totalVol = Number(event.total_whale_volume) || 0;
          return (
            <Link
              key={event.id}
              href={`/${locale}/events/${event.id}`}
              className="group px-5 py-4 flex items-center gap-4 transition-all"
              style={{ background: 'var(--surface)' }}
            >
              <span className="text-xl shrink-0 w-8 text-center">{emoji}</span>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold line-clamp-1" style={{ color: won ? 'var(--text)' : 'var(--muted)' }}>
                    {event.title}
                  </h3>
                  <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide shrink-0" style={{
                    background: won ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    color: won ? 'var(--green)' : 'var(--red)',
                    border: `1px solid ${won ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                  }}>
                    {won ? labels.statusWin : labels.statusLoss}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: 'var(--subtle)' }}>
                  <span>{labels.convictionBacked}: <span className="font-semibold" style={{ color: 'var(--amber)' }}>{event.big_trade_outcome}</span></span>
                  <span>·</span>
                  <span>{labels.convictionResult}: <span className="font-semibold" style={{ color: 'var(--muted)' }}>{event.result_outcome || '—'}</span></span>
                  <span>·</span>
                  {impliedProb > 0 && (
                    <>
                      <span>{labels.impliedProb}: <span className="font-mono font-semibold" style={{ color: 'var(--muted)' }}>{impliedProb.toFixed(0)}%</span></span>
                      <span>·</span>
                    </>
                  )}
                  {entryOdds && (
                    <>
                      <span>{labels.decimalOdds}: <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>{entryOdds.toFixed(2)}x</span></span>
                      <span>·</span>
                    </>
                  )}
                  {event.odds && (
                    <>
                      <span>{labels.settledOdds}: <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>@{Number(event.odds).toFixed(2)}</span></span>
                      <span>·</span>
                    </>
                  )}
                  {totalVol > 0 && (
                    <>
                      <span className="font-mono">${(totalVol / 1000).toFixed(0)}K vol</span>
                      <span>·</span>
                    </>
                  )}
                  <span className="font-mono">${(Number(event.big_trade_volume) / 1000).toFixed(0)}K conviction</span>
                  <span>·</span>
                  <span>{event.big_trade_count} {labels.convictionTradesSuffix}</span>
                </div>
              </div>
            </Link>
          );
        })}
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
