import { getTranslations } from 'next-intl/server';
import sql from '@/lib/db';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getSportEmoji } from '@/lib/sportEmoji';
import { calcOverallRoi, OVERALL_STAKE } from '@/lib/roi';
import { calcConsensus, parseThreshold, parseSports, parseMinVolume, type MinTradeThreshold, type MinVolumeThreshold } from '@/lib/thresholds';
import { formatVolume } from '@/lib/format';
import { parseRange, rangeToDate, TIME_RANGES, type TimeRange } from '@/lib/timeRange';
import TimeRangeFilter from '@/components/TimeRangeFilter';
import MinTradeFilter from '@/components/MinTradeFilter';
import MinVolumeFilter from '@/components/MinVolumeFilter';
import TeamEventHistory from '@/components/TeamEventHistory';

interface EventRow {
  event_id: string;
  title: string;
  game_start_time: string | null;
  created_at: string;
  result_outcome: string | null;
  odds: string | null;
  total_volume: string | null;
  team_volume: string;
  team_avg_price: string;
  team_big_trades: string;
  total_whale_volume: string;
  top_outcome: string | null;
}

async function getTeamData(
  sport: string,
  outcome: string,
  range: TimeRange,
  threshold: MinTradeThreshold,
  minVolume: MinVolumeThreshold,
) {
  const since = rangeToDate(range);
  const dateFilter = since ? sql`AND e.created_at >= ${since}` : sql``;
  const sportFilter = sport === 'Sports' ? sql`AND e.sport IS NULL` : sql`AND e.sport = ${sport}`;
  const volumeFilter = minVolume > 0 ? sql`AND e.total_volume >= ${minVolume}` : sql``;

  const rows = await sql`
    SELECT
      e.id            AS event_id,
      e.title         AS title,
      e.game_start_time,
      e.created_at,
      e.result_outcome,
      e.odds,
      e.total_volume,
      SUM(CASE WHEN w.outcome = ${outcome} THEN w.trade_value ELSE 0 END)                          AS team_volume,
      AVG(CASE WHEN w.outcome = ${outcome} THEN w.price END)                                       AS team_avg_price,
      SUM(CASE WHEN w.outcome = ${outcome} AND w.trade_value >= ${threshold} THEN 1 ELSE 0 END)    AS team_big_trades,
      SUM(w.trade_value)                                                                           AS total_whale_volume,
      (
        SELECT w2.outcome
        FROM whale_activity w2
        WHERE w2.event_id = e.id
        GROUP BY w2.outcome
        ORDER BY SUM(w2.trade_value) DESC
        LIMIT 1
      )                                                                                            AS top_outcome
    FROM events e
    JOIN whale_activity w ON e.id = w.event_id
    WHERE e.whales_won IS NOT NULL
      AND e.result_outcome IS NOT NULL
      AND w.outcome IS NOT NULL
    ${dateFilter}
    ${sportFilter}
    ${volumeFilter}
    GROUP BY e.id
    HAVING SUM(CASE WHEN w.outcome = ${outcome} THEN w.trade_value ELSE 0 END) > 0
    ORDER BY e.created_at DESC
  ` as unknown as EventRow[];

  const backed = rows.filter(r => r.top_outcome === outcome);
  if (backed.length === 0) return null;

  let wins = 0;
  let expectedWins = 0;
  let totalTeamVolume = 0;
  let convictionEvents = 0;
  let convictionWins = 0;
  let nonConvictionEvents = 0;
  let nonConvictionWins = 0;
  let highConsensusEvents = 0;
  let highConsensusWins = 0;
  let lowConsensusEvents = 0;
  let lowConsensusWins = 0;
  const roiEvents: { won: boolean; odds: number }[] = [];

  type EventDetail = {
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
  };

  const events: EventDetail[] = [];

  for (const r of backed) {
    const won = !!(r.result_outcome && r.result_outcome === outcome);
    const avgPrice = Number(r.team_avg_price) || 0;
    const teamVol = Number(r.team_volume) || 0;
    const totalWhaleVol = Number(r.total_whale_volume) || 0;
    const bigTrades = Number(r.team_big_trades) || 0;
    const odds = r.odds !== null ? Number(r.odds) : null;
    const consensus = calcConsensus(teamVol, totalWhaleVol);

    if (won) wins += 1;
    expectedWins += avgPrice;
    totalTeamVolume += teamVol;

    if (bigTrades > 0) {
      convictionEvents += 1;
      if (won) convictionWins += 1;
    } else {
      nonConvictionEvents += 1;
      if (won) nonConvictionWins += 1;
    }

    if (consensus !== null) {
      if (consensus >= 60) {
        highConsensusEvents += 1;
        if (won) highConsensusWins += 1;
      } else {
        lowConsensusEvents += 1;
        if (won) lowConsensusWins += 1;
      }
    }

    let pnl: number | null = null;
    if (odds && odds > 0) {
      roiEvents.push({ won, odds });
      pnl = won ? OVERALL_STAKE * (odds - 1) : -OVERALL_STAKE;
    }

    events.push({
      event_id: r.event_id,
      title: r.title,
      date: r.created_at,
      game_start_time: r.game_start_time,
      won,
      result_outcome: r.result_outcome,
      team_volume: teamVol,
      avg_price: avgPrice,
      big_trades: bigTrades,
      consensus,
      odds,
      pnl,
    });
  }

  const totalEvents = backed.length;
  const winRate = (wins / totalEvents) * 100;
  const expectedWinRate = (expectedWins / totalEvents) * 100;
  const edge = winRate - expectedWinRate;
  const roi = calcOverallRoi(roiEvents);

  // Most recent first; recent form = first 10 reversed for display so newest is rightmost.
  const recentForm = events.slice(0, 10).map(e => e.won).reverse();

  return {
    sport,
    outcome,
    totalEvents,
    wins,
    losses: totalEvents - wins,
    winRate,
    expectedWinRate,
    edge,
    totalVolume: totalTeamVolume,
    roi,
    convictionEvents,
    convictionWins,
    convictionWinRate: convictionEvents > 0 ? (convictionWins / convictionEvents) * 100 : null,
    nonConvictionEvents,
    nonConvictionWins,
    nonConvictionWinRate: nonConvictionEvents > 0 ? (nonConvictionWins / nonConvictionEvents) * 100 : null,
    highConsensusEvents,
    highConsensusWinRate: highConsensusEvents > 0 ? (highConsensusWins / highConsensusEvents) * 100 : null,
    lowConsensusEvents,
    lowConsensusWinRate: lowConsensusEvents > 0 ? (lowConsensusWins / lowConsensusEvents) * 100 : null,
    recentForm,
    events,
  };
}

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; key: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { locale, key } = await params;
  const { range: rangeParam, minTrade: minTradeParam, minVolume: minVolumeParam, sports: sportsParam } = await searchParams;

  const decoded = decodeURIComponent(key);
  const sep = decoded.indexOf('::');
  if (sep < 0) notFound();
  const sport = decoded.slice(0, sep);
  const outcome = decoded.slice(sep + 2);
  if (!sport || !outcome) notFound();

  const range = parseRange(rangeParam);
  const threshold = parseThreshold(minTradeParam);
  const minVolume = parseMinVolume(minVolumeParam);
  // Read but unused here — preserved in querystring on back-link
  void parseSports(sportsParam);

  const t = await getTranslations('Dashboard');
  const tt = await getTranslations('Teams');
  const td = await getTranslations('TeamDetail');

  const data = await getTeamData(sport, outcome, range, threshold, minVolume);
  const labelMap = Object.fromEntries(TIME_RANGES.map(({ labelKey }) => [labelKey, t(labelKey as Parameters<typeof t>[0])]));

  const qsForBack = new URLSearchParams();
  if (rangeParam) qsForBack.set('range', String(rangeParam));
  if (minTradeParam) qsForBack.set('minTrade', String(minTradeParam));
  if (minVolumeParam) qsForBack.set('minVolume', String(minVolumeParam));
  if (sportsParam) qsForBack.set('sports', String(sportsParam));
  const backHref = `/${locale}/teams${qsForBack.toString() ? `?${qsForBack.toString()}` : ''}`;

  return (
    <div className="space-y-10 md:space-y-14">
      <header className="space-y-4">
        <nav>
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 text-sm font-medium transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            {td('backToTeams')}
          </Link>
        </nav>
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-5xl">{getSportEmoji('', sport)}</span>
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              {outcome}
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {sport} · {td('subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Suspense fallback={<div className="h-8" />}>
            <MinVolumeFilter current={minVolume} />
          </Suspense>
          <span className="w-px h-4 shrink-0" style={{ background: 'var(--border)' }} />
          <Suspense fallback={<div className="h-8" />}>
            <MinTradeFilter current={threshold} />
          </Suspense>
          <span className="w-px h-4 shrink-0" style={{ background: 'var(--border)' }} />
          <Suspense fallback={<div className="h-8" />}>
            <TimeRangeFilter current={range} labelMap={labelMap} />
          </Suspense>
        </div>
      </header>

      {!data ? (
        <div className="p-10 text-center rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          {td('noData')}
        </div>
      ) : (
        <>
          {/* Headline KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{td('record')}</p>
              <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--text)' }}>
                {data.wins}–{data.losses}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{data.totalEvents} {tt('events')}</p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{tt('winRate')}</p>
              <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--amber)' }}>{data.winRate.toFixed(0)}%</p>
              <p className="text-xs mt-1 font-mono" style={{ color: 'var(--subtle)' }}>
                vs. {data.expectedWinRate.toFixed(0)}% {td('expected').toLowerCase()}
              </p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{tt('edge')}</p>
              <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: data.edge >= 5 ? 'var(--green)' : data.edge >= 0 ? 'var(--amber)' : 'var(--red)' }}>
                {data.edge >= 0 ? '+' : ''}{data.edge.toFixed(1)}pp
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{td('vsMarket')}</p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{tt('roi')}</p>
              {data.roi ? (
                <>
                  <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: data.roi.roi >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {data.roi.roi >= 0 ? '+' : ''}{data.roi.roi.toFixed(0)}%
                  </p>
                  <p className="text-xs mt-1 font-mono" style={{ color: 'var(--subtle)' }}>
                    {data.roi.pnl >= 0 ? '+' : ''}${data.roi.pnl.toFixed(0)} / ${OVERALL_STAKE}·{data.roi.eventCount}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--subtle)' }}>—</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{td('noOdds')}</p>
                </>
              )}
            </div>
          </div>

          {/* Recent form + Splits */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Recent form */}
            <section className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-bold tracking-tight mb-1" style={{ color: 'var(--text)' }}>{td('recentForm')}</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--subtle)' }}>{td('recentFormDesc')}</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {data.recentForm.length === 0 ? (
                  <span className="text-xs" style={{ color: 'var(--subtle)' }}>—</span>
                ) : (
                  data.recentForm.map((won, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold"
                      style={{
                        background: won ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: won ? 'var(--green)' : 'var(--red)',
                        border: `1px solid ${won ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                      }}
                      title={won ? 'Win' : 'Loss'}
                    >
                      {won ? 'W' : 'L'}
                    </span>
                  ))
                )}
              </div>
              <div className="mt-4 pt-4 grid grid-cols-2 gap-3 text-xs" style={{ borderTop: '1px solid var(--border)' }}>
                <div>
                  <div className="font-semibold" style={{ color: 'var(--subtle)' }}>{tt('volume')}</div>
                  <div className="font-mono font-bold mt-0.5" style={{ color: 'var(--text)' }}>{formatVolume(data.totalVolume)}</div>
                </div>
                <div>
                  <div className="font-semibold" style={{ color: 'var(--subtle)' }}>{td('avgPerEvent')}</div>
                  <div className="font-mono font-bold mt-0.5" style={{ color: 'var(--text)' }}>{formatVolume(data.totalVolume / data.totalEvents)}</div>
                </div>
              </div>
            </section>

            {/* Conviction split */}
            <section className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-bold tracking-tight mb-1" style={{ color: 'var(--text)' }}>{td('convictionSplit')}</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--subtle)' }}>{td('convictionSplitDesc')}</p>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{td('withConviction')}</span>
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--amber)' }}>
                      {data.convictionWinRate !== null ? `${data.convictionWinRate.toFixed(0)}%` : '—'}
                    </span>
                  </div>
                  <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--subtle)' }}>
                    {data.convictionWins}W {data.convictionEvents - data.convictionWins}L · {data.convictionEvents} {tt('events')}
                  </div>
                  <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${data.convictionWinRate ?? 0}%`, background: 'var(--amber)' }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{td('withoutConviction')}</span>
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--muted)' }}>
                      {data.nonConvictionWinRate !== null ? `${data.nonConvictionWinRate.toFixed(0)}%` : '—'}
                    </span>
                  </div>
                  <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--subtle)' }}>
                    {data.nonConvictionWins}W {data.nonConvictionEvents - data.nonConvictionWins}L · {data.nonConvictionEvents} {tt('events')}
                  </div>
                  <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${data.nonConvictionWinRate ?? 0}%`, background: 'var(--muted)' }} />
                  </div>
                </div>
              </div>
            </section>

            {/* Consensus split */}
            <section className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-bold tracking-tight mb-1" style={{ color: 'var(--text)' }}>{td('consensusSplit')}</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--subtle)' }}>{td('consensusSplitDesc')}</p>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{td('highConsensus')}</span>
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--green)' }}>
                      {data.highConsensusWinRate !== null ? `${data.highConsensusWinRate.toFixed(0)}%` : '—'}
                    </span>
                  </div>
                  <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--subtle)' }}>
                    {data.highConsensusEvents} {tt('events')}
                  </div>
                  <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${data.highConsensusWinRate ?? 0}%`, background: 'var(--green)' }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{td('lowConsensus')}</span>
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--muted)' }}>
                      {data.lowConsensusWinRate !== null ? `${data.lowConsensusWinRate.toFixed(0)}%` : '—'}
                    </span>
                  </div>
                  <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--subtle)' }}>
                    {data.lowConsensusEvents} {tt('events')}
                  </div>
                  <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${data.lowConsensusWinRate ?? 0}%`, background: 'var(--muted)' }} />
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Event history */}
          <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>{td('historyTitle')}</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{td('historyDesc')}</p>
            </div>
            <TeamEventHistory
              events={data.events}
              locale={locale}
              labels={{
                event: td('event'),
                result: td('result'),
                volume: tt('volume'),
                consensus: td('consensus'),
                odds: td('odds'),
                pnl: td('pnl'),
                conviction: tt('conviction'),
              }}
            />
          </section>
        </>
      )}
    </div>
  );
}
