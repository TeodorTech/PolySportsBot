import { getTranslations } from 'next-intl/server';
import sql from '@/lib/db';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { getSportEmoji } from '@/lib/sportEmoji';
import { calcOverallRoi } from '@/lib/roi';
import { formatVolume } from '@/lib/format';
import { Suspense } from 'react';
import TimeRangeFilter from '@/components/TimeRangeFilter';
import MinTradeFilter from '@/components/MinTradeFilter';
import { parseRange, rangeToDate, TIME_RANGES, type TimeRange } from '@/lib/timeRange';
import { parseThreshold, type MinTradeThreshold, parseSports, parseMinVolume, type MinVolumeThreshold } from '@/lib/thresholds';
import SportFilter from '@/components/SportFilter';
import MinVolumeFilter from '@/components/MinVolumeFilter';
import TeamsLeaderboard from '@/components/TeamsLeaderboard';

const MIN_EVENTS = 3;
// Soccer outcomes are noisy (draws, lots of teams, low-volume leagues) — exclude from the
// default team analysis but still allow users to opt back in via the sport filter.
const DEFAULT_EXCLUDED_SPORTS = ['Soccer', 'soccer'];

interface TeamRow {
  event_id: string;
  sport: string | null;
  outcome: string;
  odds: string | null;
  result_outcome: string | null;
  whales_won: boolean;
  team_volume: string;
  team_avg_price: string;
  team_big_trade_count: string;
  event_top_outcome: string | null;
}

interface TeamStat {
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

async function getTeamsData(range: TimeRange, threshold: MinTradeThreshold, sports: string[] | null, minVolume: MinVolumeThreshold) {
  const since = rangeToDate(range);
  const dateFilter = since ? sql`AND e.created_at >= ${since}` : sql``;

  const namedSports = sports ? sports.filter(s => s !== 'Sports') : [];
  const includeNull = sports ? sports.includes('Sports') : false;
  const sportFilter = sports && sports.length > 0
    ? namedSports.length > 0 && includeNull
      ? sql`AND (e.sport IN ${sql(namedSports)} OR e.sport IS NULL)`
      : namedSports.length > 0
        ? sql`AND e.sport IN ${sql(namedSports)}`
        : sql`AND e.sport IS NULL`
    : sql`AND (e.sport IS NULL OR e.sport NOT IN ${sql(DEFAULT_EXCLUDED_SPORTS)})`;

  const volumeFilter = minVolume > 0 ? sql`AND e.total_volume >= ${minVolume}` : sql``;

  // One row per (event, outcome) whales put volume on. We compute per-team (sport, outcome) stats below.
  // A team "wins" when the event's result_outcome matches the team's outcome.
  const rows = await sql`
    SELECT
      e.id as event_id,
      e.sport,
      w.outcome,
      e.odds,
      e.result_outcome,
      e.whales_won,
      SUM(w.trade_value) as team_volume,
      AVG(w.price) as team_avg_price,
      SUM(CASE WHEN w.trade_value >= ${threshold} THEN 1 ELSE 0 END) as team_big_trade_count,
      (
        SELECT w2.outcome
        FROM whale_activity w2
        WHERE w2.event_id = e.id
        GROUP BY w2.outcome
        ORDER BY SUM(w2.trade_value) DESC
        LIMIT 1
      ) as event_top_outcome
    FROM events e
    JOIN whale_activity w ON e.id = w.event_id
    WHERE e.whales_won IS NOT NULL
      AND e.result_outcome IS NOT NULL
      AND w.outcome IS NOT NULL
    ${dateFilter}
    ${sportFilter}
    ${volumeFilter}
    GROUP BY e.id, e.sport, w.outcome, e.odds, e.result_outcome, e.whales_won
    HAVING SUM(w.trade_value) > 0
  ` as unknown as TeamRow[];

  // Available sports for filter UI — date-scoped only so dropdown doesn't collapse
  const sportListRows = await sql`
    SELECT DISTINCT e.sport
    FROM events e
    WHERE e.whales_won IS NOT NULL
    ${dateFilter}
    ORDER BY e.sport ASC NULLS LAST
  ` as unknown as { sport: string | null }[];
  const availableSports: string[] = sportListRows.map(r => r.sport || 'Sports');

  if (rows.length === 0) return { availableSports, sports, empty: true as const };

  // Only consider rows where whales actually backed this team as the top outcome of the event.
  // Otherwise every market's "Yes" + "No" + every alt outcome would count as a tracked team.
  const backed = rows.filter(r => r.event_top_outcome && r.outcome === r.event_top_outcome);

  // Group by (sport, outcome)
  type Acc = {
    sport: string;
    outcome: string;
    events: number;
    wins: number;
    expectedWins: number;
    volume: number;
    convictionEvents: number;
    roiEvents: { won: boolean; odds: number }[];
  };
  const map = new Map<string, Acc>();

  for (const r of backed) {
    const sport = r.sport || 'Sports';
    const key = `${sport}::${r.outcome}`;
    const entry: Acc = map.get(key) ?? {
      sport,
      outcome: r.outcome,
      events: 0,
      wins: 0,
      expectedWins: 0,
      volume: 0,
      convictionEvents: 0,
      roiEvents: [],
    };

    const won = !!(r.result_outcome && r.result_outcome === r.outcome);
    const avgPrice = Number(r.team_avg_price) || 0;
    const volume = Number(r.team_volume) || 0;
    const bigTrades = Number(r.team_big_trade_count) || 0;
    const oddsNum = r.odds !== null ? Number(r.odds) : 0;

    entry.events += 1;
    if (won) entry.wins += 1;
    entry.expectedWins += avgPrice;
    entry.volume += volume;
    if (bigTrades > 0) entry.convictionEvents += 1;
    if (oddsNum > 0) entry.roiEvents.push({ won, odds: oddsNum });

    map.set(key, entry);
  }

  const teamStats: TeamStat[] = Array.from(map.entries())
    .filter(([, a]) => a.events >= MIN_EVENTS)
    .map(([key, a]) => {
      const winRate = (a.wins / a.events) * 100;
      const expectedWinRate = (a.expectedWins / a.events) * 100;
      const roiResult = calcOverallRoi(a.roiEvents);
      return {
        key,
        sport: a.sport,
        outcome: a.outcome,
        events: a.events,
        wins: a.wins,
        winRate,
        expectedWinRate,
        edge: winRate - expectedWinRate,
        volume: a.volume,
        convictionEvents: a.convictionEvents,
        roi: roiResult?.roi ?? null,
        roiPnl: roiResult?.pnl ?? null,
        roiEventCount: roiResult?.eventCount ?? 0,
      };
    });

  if (teamStats.length === 0) return { availableSports, sports, empty: true as const };

  const byEdgeDesc = [...teamStats].sort((a, b) => b.edge - a.edge);
  const byEdgeAsc = [...teamStats].sort((a, b) => a.edge - b.edge);
  const byVolume = [...teamStats].sort((a, b) => b.volume - a.volume);

  return {
    teamStats: byEdgeDesc,
    darlings: byEdgeDesc.slice(0, 5),
    fades: byEdgeAsc.slice(0, 5),
    mostBacked: byVolume[0],
    biggestEdge: byEdgeDesc[0],
    biggestFade: byEdgeAsc[0],
    totalTeams: teamStats.length,
    threshold,
    availableSports,
    sports,
  };
}

export default async function TeamsPage({ params, searchParams }: { params: Promise<{ locale: string }>, searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { locale } = await params;
  const { range: rangeParam, minTrade: minTradeParam, sports: sportsParam, minVolume: minVolumeParam } = await searchParams;
  const range = parseRange(rangeParam);
  const threshold = parseThreshold(minTradeParam);
  const sports = parseSports(sportsParam);
  const minVolume = parseMinVolume(minVolumeParam);
  const t = await getTranslations('Dashboard');
  const tt = await getTranslations('Teams');
  const data = await getTeamsData(range, threshold, sports, minVolume);
  const labelMap = Object.fromEntries(TIME_RANGES.map(({ labelKey }) => [labelKey, t(labelKey as Parameters<typeof t>[0])]));

  return (
    <div className="space-y-10 md:space-y-14">
      {/* Header */}
      <header className="space-y-4">
        <nav>
          <Link
            href={`/${locale}`}
            className="inline-flex items-center gap-2 text-sm font-medium transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            {t('backToMarkets')}
          </Link>
        </nav>
        <div className="space-y-4">
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              {tt('title')}
            </h1>
            <p className="text-base" style={{ color: 'var(--muted)' }}>
              {tt('subtitle')}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Suspense fallback={<div className="h-8" />}>
              <SportFilter current={sports} sports={data?.availableSports ?? []} />
            </Suspense>
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
          </div>
        </div>
      </header>

      {!data || data.empty ? (
        <div className="p-10 text-center rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          {tt('noData')}
        </div>
      ) : (
        <>
          {/* Primary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{tt('teamsTracked')}</p>
              <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--amber)' }}>{data.totalTeams}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{tt('teamsTrackedDesc')}</p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{tt('biggestEdge')}</p>
              <p className="text-2xl font-bold tracking-tight truncate" style={{ color: 'var(--green)' }} title={data.biggestEdge.outcome}>
                {getSportEmoji('', data.biggestEdge.sport)} {data.biggestEdge.outcome}
              </p>
              <p className="text-xs mt-1 font-mono font-semibold" style={{ color: 'var(--green)' }}>
                +{data.biggestEdge.edge.toFixed(1)}pp · {data.biggestEdge.events} {tt('events')}
              </p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{tt('biggestFade')}</p>
              <p className="text-2xl font-bold tracking-tight truncate" style={{ color: 'var(--red)' }} title={data.biggestFade.outcome}>
                {getSportEmoji('', data.biggestFade.sport)} {data.biggestFade.outcome}
              </p>
              <p className="text-xs mt-1 font-mono font-semibold" style={{ color: 'var(--red)' }}>
                {data.biggestFade.edge.toFixed(1)}pp · {data.biggestFade.events} {tt('events')}
              </p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{tt('mostBacked')}</p>
              <p className="text-2xl font-bold tracking-tight truncate" style={{ color: 'var(--amber)' }} title={data.mostBacked.outcome}>
                {getSportEmoji('', data.mostBacked.sport)} {data.mostBacked.outcome}
              </p>
              <p className="text-xs mt-1 font-mono font-semibold" style={{ color: 'var(--amber)' }}>
                ${(data.mostBacked.volume / 1_000_000).toFixed(2)}M · {data.mostBacked.events} {tt('events')}
              </p>
            </div>
          </div>

          {/* Darlings vs Fades side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Darlings */}
            <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                  {tt('darlingsTitle')}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{tt('darlingsDesc')}</p>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {data.darlings.map((s) => (
                  <div key={s.key} className="px-5 py-4 flex items-center gap-4" style={{ background: 'var(--surface)' }}>
                    <span className="text-xl shrink-0 w-8 text-center">{getSportEmoji('', s.sport)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{s.outcome}</span>
                        <span className="text-xs font-mono font-bold" style={{ color: 'var(--green)' }}>
                          +{s.edge.toFixed(1)}pp
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--subtle)' }}>
                        <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>{s.winRate.toFixed(0)}%</span>
                        <span>{tt('winRate').toLowerCase()}</span>
                        <span>·</span>
                        <span>{s.wins}W {s.events - s.wins}L</span>
                        <span>·</span>
                        <span>{formatVolume(s.volume)}</span>
                      </div>
                      <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                        <div className="h-full rounded-full" style={{ width: `${s.winRate}%`, background: 'var(--green)' }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Fades */}
            <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                  {tt('fadesTitle')}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{tt('fadesDesc')}</p>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {data.fades.map((s) => (
                  <div key={s.key} className="px-5 py-4 flex items-center gap-4" style={{ background: 'var(--surface)' }}>
                    <span className="text-xl shrink-0 w-8 text-center">{getSportEmoji('', s.sport)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{s.outcome}</span>
                        <span className="text-xs font-mono font-bold" style={{ color: 'var(--red)' }}>
                          {s.edge.toFixed(1)}pp
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--subtle)' }}>
                        <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>{s.winRate.toFixed(0)}%</span>
                        <span>{tt('winRate').toLowerCase()}</span>
                        <span>·</span>
                        <span>{s.wins}W {s.events - s.wins}L</span>
                        <span>·</span>
                        <span>{formatVolume(s.volume)}</span>
                      </div>
                      <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                        <div className="h-full rounded-full" style={{ width: `${100 - s.winRate}%`, background: 'var(--red)' }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Full leaderboard */}
          <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                {tt('leaderboard')}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{tt('leaderboardDesc')}</p>
            </div>
            <TeamsLeaderboard
              rows={data.teamStats}
              labels={{
                team: tt('team'),
                backed: tt('backed'),
                winRate: tt('winRate'),
                expected: tt('expected'),
                edge: tt('edge'),
                volume: tt('volume'),
                roi: tt('roi'),
                conviction: tt('conviction'),
              }}
            />
            <div className="px-5 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>{tt('minEventsNote')}</p>
            </div>
          </section>

          {/* Glossary */}
          <div className="p-5 rounded-xl text-xs space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--subtle)' }}>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{tt('team')}:</span> {tt('glossaryTeam')}</p>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{tt('edge')}:</span> {tt('glossaryEdge')}</p>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{tt('roi')}:</span> {tt('glossaryRoi')}</p>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{tt('glossaryPpLabel')}:</span> {tt('glossaryPp')}</p>
          </div>
        </>
      )}

      <footer className="divider pt-8 pb-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs" style={{ color: 'var(--subtle)' }}>
        <span>🐋 {t('title')} — {t('heroTagline')}</span>
        <span>Data sourced from Polymarket</span>
      </footer>
    </div>
  );
}
