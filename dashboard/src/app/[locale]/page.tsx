import {getTranslations} from 'next-intl/server';
import sql from '@/lib/db';
import {ArrowRight} from 'lucide-react';
import Link from 'next/link';
import {getSportEmoji} from '@/lib/sportEmoji';
import { Suspense } from 'react';
import TimeRangeFilter from '@/components/TimeRangeFilter';
import { parseRange, rangeToDate, DEFAULT_RANGE, TIME_RANGES, type TimeRange } from '@/lib/timeRange';
import { calcConsensus, consensusColor } from '@/lib/thresholds';

async function getStats(range: TimeRange) {
  const since = rangeToDate(range);
  const settled = await sql`
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE whales_won = true) as wins
    FROM events
    WHERE whales_won IS NOT NULL
    ${since ? sql`AND created_at >= ${since}` : sql``}
  `;

  const totalVolume = await sql`
    SELECT SUM(total_volume) as total FROM events
  `;

  const activeCount = await sql`
    SELECT COUNT(*) as total FROM events WHERE whales_won IS NULL
  `;

  return {
    successRate: settled[0].total > 0 ? (settled[0].wins / settled[0].total) * 100 : 0,
    totalVolume: totalVolume[0].total || 0,
    activeCount: activeCount[0].total || 0
  };
}

async function getTrendingMarkets() {
  return await sql`
    SELECT e.id, e.title, e.sport, e.total_volume, e.whales_won, e.status, e.game_start_time,
           COUNT(w.id) as whale_count,
           SUM(w.trade_value) as whale_volume,
           (
             SELECT SUM(w2.trade_value)
             FROM whale_activity w2
             WHERE w2.event_id = e.id
             GROUP BY w2.outcome
             ORDER BY SUM(w2.trade_value) DESC
             LIMIT 1
           ) as top_outcome_volume
    FROM events e
    LEFT JOIN whale_activity w ON e.id = w.event_id
    WHERE e.whales_won IS NULL
    GROUP BY e.id
    ORDER BY e.total_volume DESC
    LIMIT 20
  `;
}

const PAGE_SIZE = 10;

async function getSettledMarkets(page: number, range: TimeRange) {
  const since = rangeToDate(range);
  const offset = (page - 1) * PAGE_SIZE;
  const rows = await sql`
    SELECT e.id, e.title, e.sport, e.total_volume, e.whales_won, e.odds,
           COUNT(w.id) as whale_count
    FROM events e
    LEFT JOIN whale_activity w ON e.id = w.event_id
    WHERE e.whales_won IS NOT NULL
    ${since ? sql`AND e.created_at >= ${since}` : sql``}
    GROUP BY e.id
    ORDER BY e.created_at DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
  `;
  const hasNext = rows.length > PAGE_SIZE;
  return { rows: hasNext ? rows.slice(0, PAGE_SIZE) : rows, hasNext };
}

function buildPageHref(locale: string, page: number, range: TimeRange) {
  const params = new URLSearchParams();
  if (range !== DEFAULT_RANGE) params.set('range', range);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return `/${locale}${qs ? '?' + qs : ''}`;
}

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ locale: string }>, searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { locale } = await params;
  const { page: pageParam, range: rangeParam } = await searchParams;
  const page = Math.max(1, parseInt((pageParam as string) || '1', 10));
  const range = parseRange(rangeParam);
  const t = await getTranslations('Dashboard');
  const [stats, trending, { rows: settled, hasNext }] = await Promise.all([
    getStats(range),
    getTrendingMarkets(),
    getSettledMarkets(page, range),
  ]);

  const labelMap = Object.fromEntries(TIME_RANGES.map(({ labelKey }) => [labelKey, t(labelKey as Parameters<typeof t>[0])]));

  return (
    <div className="space-y-10 md:space-y-14">
      {/* Hero */}
      <header className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🐋</span>
            <span className="text-lg font-bold tracking-tight" style={{color: 'var(--text)'}}>
              {t('title')}
            </span>
          </div>
          <div className="flex items-center gap-5">
            <Link href={`/${locale}/stats`} className="text-xs font-semibold uppercase tracking-widest hover:opacity-100 transition-opacity" style={{color: 'var(--subtle)'}}>Stats</Link>
            <div className="flex gap-4">
              <Link href="/en" className="text-xs uppercase tracking-widest hover:opacity-100 transition-opacity" style={{color: locale === 'en' ? 'var(--amber)' : 'var(--subtle)'}}>EN</Link>
              <Link href="/ro" className="text-xs uppercase tracking-widest hover:opacity-100 transition-opacity" style={{color: locale === 'ro' ? 'var(--amber)' : 'var(--subtle)'}}>RO</Link>
            </div>
          </div>
        </div>

        <div className="space-y-3 max-w-2xl">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight" style={{color: 'var(--text)'}}>
            {t('subtitle')}
          </h1>
          <p className="text-base md:text-lg" style={{color: 'var(--muted)'}}>
            {t('heroTagline')}
          </p>
        </div>
      </header>

      {/* Time Range Filter */}
      <Suspense fallback={<div className="h-8" />}>
        <TimeRangeFilter current={range} labelMap={labelMap} />
      </Suspense>

      {/* Stats Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl card-hover" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{color: 'var(--subtle)'}}>
            {t('whaleSuccessRate')}
          </p>
          <p className="text-3xl font-bold font-mono tracking-tight" style={{color: 'var(--amber)'}}>
            {stats.successRate.toFixed(1)}%
          </p>
        </div>

        <div className="p-5 rounded-xl card-hover" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{color: 'var(--subtle)'}}>
            {t('totalVolume')}
          </p>
          <p className="text-3xl font-bold font-mono tracking-tight" style={{color: 'var(--text)'}}>
            ${(stats.totalVolume / 1000000).toFixed(1)}M
          </p>
        </div>

        <div className="p-5 rounded-xl card-hover" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{color: 'var(--subtle)'}}>
            {t('activeMarkets')}
          </p>
          <p className="text-3xl font-bold font-mono tracking-tight" style={{color: 'var(--text)'}}>
            {stats.activeCount}
          </p>
        </div>
      </div>

      {/* Trending Markets */}
      <section className="rounded-2xl overflow-hidden" style={{border: '1px solid var(--border)'}}>
        <div className="px-5 py-4 flex items-center justify-between" style={{background: 'var(--surface2)', borderBottom: '1px solid var(--border)'}}>
          <h2 className="text-base font-bold tracking-tight" style={{color: 'var(--text)'}}>
            {t('upcomingEvents')}
          </h2>
          <span className="flex items-center gap-1.5 text-xs font-semibold" style={{color: 'var(--green)'}}>
            <span className="live-dot" />
            {trending.length}
          </span>
        </div>

        {trending.length === 0 ? (
          <div className="p-10 text-center" style={{color: 'var(--muted)'}}>
            {t('noEvents')}
          </div>
        ) : (
          <div className="divide-y" style={{borderColor: 'var(--border)'}}>
            {trending.map((event) => {
              const emoji = getSportEmoji(event.title, event.sport);
              const whaleVolume = Number(event.whale_volume) || 0;
              const topVolume = Number(event.top_outcome_volume) || 0;
              const consensus = calcConsensus(topVolume, whaleVolume);

              return (
                <Link
                  key={event.id}
                  href={`/${locale}/events/${event.id}`}
                  className="group px-5 py-4 flex items-center gap-4 transition-all"
                  style={{background: 'var(--surface)'}}
                >
                  <span className="text-2xl shrink-0 w-10 text-center">{emoji}</span>

                  <div className="flex-1 min-w-0 space-y-2">
                    <h3 className="text-sm md:text-base font-semibold line-clamp-2" style={{color: 'var(--text)'}}>
                      {event.title}
                    </h3>

                    <div className="flex items-center gap-4 text-xs" style={{color: 'var(--muted)'}}>
                      <span>{event.whale_count || 0} {t('whaleCount')}</span>
                      <span style={{color: 'var(--subtle)'}}>·</span>
                      <span>{t('volume')}: ${(Number(event.total_volume) / 1000000).toFixed(1)}M</span>
                      {consensus !== null && (
                        <>
                          <span style={{color: 'var(--subtle)'}}>·</span>
                          <span className="font-semibold" style={{color: consensusColor(consensus)}}>
                            {consensus.toFixed(0)}% consensus
                          </span>
                        </>
                      )}
                      {event.game_start_time && (
                        <>
                          <span style={{color: 'var(--subtle)'}}>·</span>
                          <span style={{color: 'var(--subtle)'}}>
                            🕐 {new Date(event.game_start_time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <ArrowRight className="w-4 h-4 shrink-0" style={{color: 'var(--subtle)'}} />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* History */}
      <section className="rounded-2xl overflow-hidden" style={{border: '1px solid var(--border)'}}>
        <div className="px-5 py-4 flex items-center justify-between" style={{background: 'var(--surface2)', borderBottom: '1px solid var(--border)'}}>
          <h2 className="text-base font-bold tracking-tight" style={{color: 'var(--text)'}}>
            {t('history')}
          </h2>
          <span className="text-xs font-semibold" style={{color: 'var(--subtle)'}}>
            {settled.length}
          </span>
        </div>

        {settled.length === 0 ? (
          <div className="p-10 text-center" style={{color: 'var(--muted)'}}>
            {t('noHistory')}
          </div>
        ) : (
          <div className="divide-y" style={{borderColor: 'var(--border)'}}>
            {settled.map((event) => {
              const emoji = getSportEmoji(event.title, event.sport);
              const won = event.whales_won === true;

              return (
                <Link
                  key={event.id}
                  href={`/${locale}/events/${event.id}`}
                  className="group px-5 py-4 flex items-center gap-4 transition-all"
                  style={{background: 'var(--surface)'}}
                >
                  <span className="text-2xl shrink-0 w-10 text-center">{emoji}</span>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm md:text-base font-semibold line-clamp-2" style={{color: 'var(--muted)'}}>
                        {event.title}
                      </h3>
                      <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide shrink-0" style={{
                        background: won ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        color: won ? 'var(--green)' : 'var(--red)',
                        border: `1px solid ${won ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                      }}>
                        {won ? t('statusWin') : t('statusLoss')}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs" style={{color: 'var(--subtle)'}}>
                      <span>{event.whale_count || 0} {t('whaleCount')}</span>
                      <span>·</span>
                      <span>${(Number(event.total_volume) / 1000000).toFixed(1)}M</span>
                      {event.odds && (
                        <>
                          <span>·</span>
                          <span className="font-bold font-mono" style={{color: 'var(--amber)'}}>@{Number(event.odds).toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <ArrowRight className="w-4 h-4 shrink-0" style={{color: 'var(--subtle)'}} />
                </Link>
              );
            })}
          </div>
        )}
        {(page > 1 || hasNext) && (
          <div className="px-5 py-4 flex items-center justify-between" style={{borderTop: '1px solid var(--border)'}}>
            <Link
              href={buildPageHref(locale, page - 1, range)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${page <= 1 ? 'pointer-events-none opacity-30' : ''}`}
              style={{background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)'}}
            >
              ← {t('prevPage')}
            </Link>
            <span className="text-xs" style={{color: 'var(--subtle)'}}>
              {t('pageLabel')} {page}
            </span>
            <Link
              href={buildPageHref(locale, page + 1, range)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${!hasNext ? 'pointer-events-none opacity-30' : ''}`}
              style={{background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)'}}
            >
              {t('nextPage')} →
            </Link>
          </div>
        )}
      </section>
      {/* Footer */}
      <footer className="divider pt-8 pb-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs" style={{color: 'var(--subtle)'}}>
        <span>🐋 {t('title')} — {t('heroTagline')}</span>
        <span>Data sourced from Polymarket</span>
      </footer>
    </div>
  );
}
