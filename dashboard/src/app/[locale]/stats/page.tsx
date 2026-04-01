import { getTranslations } from 'next-intl/server';
import sql from '@/lib/db';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { getSportEmoji } from '@/lib/sportEmoji';

interface SettledEvent {
  id: string;
  title: string;
  sport: string | null;
  odds: string | null;
  whales_won: boolean;
  whale_count: string;
  whale_volume: string;
  avg_price: string;
  // consensus: % of whale volume on the winning outcome
  top_outcome: string;
  top_outcome_volume: string;
}

interface SportStat {
  sport: string;
  total: number;
  wins: number;
  winRate: number;
  edge: number;
  expectedWinRate: number;
}

interface ConsensusBucket {
  label: string;   // e.g. "High (>80%)"
  minPct: number;
  maxPct: number;
  total: number;
  wins: number;
  winRate: number | null;
}

async function getStatsData() {
  // Main settled events query — also computes top outcome volume per event for consensus
  const events = await sql`
    SELECT
      e.id,
      e.title,
      e.sport,
      e.odds,
      e.whales_won,
      COUNT(w.id) as whale_count,
      SUM(w.trade_value) as whale_volume,
      AVG(w.price) as avg_price,
      (
        SELECT w2.outcome
        FROM whale_activity w2
        WHERE w2.event_id = e.id
        GROUP BY w2.outcome
        ORDER BY SUM(w2.trade_value) DESC
        LIMIT 1
      ) as top_outcome,
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
    WHERE e.whales_won IS NOT NULL
    GROUP BY e.id
    ORDER BY e.id DESC
  ` as unknown as SettledEvent[];

  if (events.length === 0) return null;

  const totalEvents = events.length;
  const actualWins = events.filter(e => e.whales_won === true).length;
  const losses = totalEvents - actualWins;

  const expectedWins = events.reduce((sum, e) => sum + (Number(e.avg_price) || 0), 0);
  const rawWinRate = (actualWins / totalEvents) * 100;
  const expectedWinRate = (expectedWins / totalEvents) * 100;
  const edge = rawWinRate - expectedWinRate;

  const adjustedWinScore = events.reduce((sum, e) => {
    if (e.whales_won === true) {
      const p = Number(e.avg_price) || 0;
      return sum + (p > 0 ? 1 / p : 1);
    }
    return sum;
  }, 0);
  const adjustedWinRate = (adjustedWinScore / totalEvents) * 100;

  const eventsWithOdds = events.filter(e => e.odds !== null && Number(e.odds) > 0);
  let roi: number | null = null;
  let roiEventCount = 0;
  if (eventsWithOdds.length > 0) {
    const totalStaked = eventsWithOdds.reduce((sum, e) => sum + Number(e.whale_volume || 0), 0);
    const totalReturned = eventsWithOdds.reduce((sum, e) => {
      if (e.whales_won === true) return sum + Number(e.whale_volume || 0) * Number(e.odds);
      return sum;
    }, 0);
    roi = totalStaked > 0 ? ((totalReturned - totalStaked) / totalStaked) * 100 : 0;
    roiEventCount = eventsWithOdds.length;
  }

  // --- Sport breakdown ---
  const sportMap = new Map<string, { total: number; wins: number; expectedWins: number }>();
  for (const e of events) {
    const sport = e.sport || 'Sports';
    const entry = sportMap.get(sport) ?? { total: 0, wins: 0, expectedWins: 0 };
    entry.total += 1;
    if (e.whales_won === true) entry.wins += 1;
    entry.expectedWins += Number(e.avg_price) || 0;
    sportMap.set(sport, entry);
  }
  const sportStats: SportStat[] = Array.from(sportMap.entries())
    .map(([sport, s]) => ({
      sport,
      total: s.total,
      wins: s.wins,
      winRate: (s.wins / s.total) * 100,
      expectedWinRate: (s.expectedWins / s.total) * 100,
      edge: ((s.wins / s.total) * 100) - ((s.expectedWins / s.total) * 100),
    }))
    .sort((a, b) => b.total - a.total);

  // --- Consensus breakdown ---
  // Consensus = top_outcome_volume / whale_volume for each event
  // Buckets: Low <50%, Medium 50-80%, High >80%
  const buckets: ConsensusBucket[] = [
    { label: 'High (>80%)', minPct: 80, maxPct: 100, total: 0, wins: 0, winRate: null },
    { label: 'Medium (50–80%)', minPct: 50, maxPct: 80, total: 0, wins: 0, winRate: null },
    { label: 'Low (<50%)', minPct: 0, maxPct: 50, total: 0, wins: 0, winRate: null },
  ];

  for (const e of events) {
    const totalVol = Number(e.whale_volume) || 0;
    const topVol = Number(e.top_outcome_volume) || 0;
    if (totalVol === 0) continue;
    const consensusPct = (topVol / totalVol) * 100;
    for (const bucket of buckets) {
      if (consensusPct >= bucket.minPct && consensusPct <= bucket.maxPct) {
        bucket.total += 1;
        if (e.whales_won === true) bucket.wins += 1;
        break;
      }
    }
  }
  for (const b of buckets) {
    if (b.total > 0) b.winRate = (b.wins / b.total) * 100;
  }

  return {
    totalEvents, actualWins, losses,
    rawWinRate, expectedWinRate, edge,
    adjustedWinRate, roi, roiEventCount,
    sportStats, buckets, events,
  };
}

export default async function StatsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('Dashboard');
  const ts = await getTranslations('Stats');
  const data = await getStatsData();

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
        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            {ts('title')}
          </h1>
          <p className="text-base" style={{ color: 'var(--muted)' }}>
            {ts('subtitle')}
          </p>
        </div>
      </header>

      {!data ? (
        <div className="p-10 text-center rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          {ts('noData')}
        </div>
      ) : (
        <>
          {/* Primary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('rawWinRate')}</p>
              <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--amber)' }}>{data.rawWinRate.toFixed(1)}%</p>
              <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{data.actualWins}W — {data.losses}L / {data.totalEvents} {ts('events')}</p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('expectedWinRate')}</p>
              <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--text)' }}>{data.expectedWinRate.toFixed(1)}%</p>
              <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{ts('expectedWinRateDesc')}</p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('edge')}</p>
              <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: data.edge >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {data.edge >= 0 ? '+' : ''}{data.edge.toFixed(1)}pp
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{ts('edgeDesc')}</p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('roi')}</p>
              {data.roi !== null ? (
                <>
                  <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: data.roi >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {data.roi >= 0 ? '+' : ''}{data.roi.toFixed(1)}%
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{ts('roiFrom')} {data.roiEventCount} {ts('events')}</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--subtle)' }}>N/A</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{ts('roiNone')}</p>
                </>
              )}
            </div>
          </div>

          {/* Secondary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('adjustedWinRate')}</p>
              <p className="text-2xl font-bold font-mono tracking-tight" style={{ color: 'var(--amber)' }}>{data.adjustedWinRate.toFixed(1)}%</p>
              <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>{ts('adjustedWinRateDesc')}</p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('totalSettled')}</p>
              <p className="text-2xl font-bold font-mono tracking-tight" style={{ color: 'var(--text)' }}>{data.totalEvents}</p>
              <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>{data.actualWins} {ts('wins')} · {data.losses} {ts('losses')}</p>
            </div>

            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('marketVerdict')}</p>
              <p className="text-2xl font-bold tracking-tight" style={{ color: data.edge >= 5 ? 'var(--green)' : data.edge >= 0 ? 'var(--amber)' : 'var(--red)' }}>
                {data.edge >= 5 ? ts('verdictStrong') : data.edge >= 0 ? ts('verdictNeutral') : ts('verdictWeak')}
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>{ts('marketVerdictDesc')}</p>
            </div>
          </div>

          {/* Sport Breakdown + Consensus side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Sport Breakdown */}
            <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                  {ts('sportBreakdown')}
                </h2>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {data.sportStats.map((s) => {
                  const emoji = getSportEmoji(s.sport, s.sport);
                  const edgeColor = s.edge >= 5 ? 'var(--green)' : s.edge >= 0 ? 'var(--amber)' : 'var(--red)';
                  return (
                    <div key={s.sport} className="px-5 py-4 flex items-center gap-4" style={{ background: 'var(--surface)' }}>
                      <span className="text-xl shrink-0 w-8 text-center">{emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{s.sport}</span>
                          <span className="text-xs font-mono font-bold" style={{ color: edgeColor }}>
                            {s.edge >= 0 ? '+' : ''}{s.edge.toFixed(1)}pp
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--subtle)' }}>
                          <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>{s.winRate.toFixed(0)}%</span>
                          <span>win rate</span>
                          <span>·</span>
                          <span>{s.wins}W {s.total - s.wins}L</span>
                          <span>·</span>
                          <span>exp. {s.expectedWinRate.toFixed(0)}%</span>
                        </div>
                        {/* Mini bar */}
                        <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${s.winRate}%`, background: s.edge >= 0 ? 'var(--green)' : 'var(--red)' }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Consensus Breakdown */}
            <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                  {ts('consensusBreakdown')}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{ts('consensusDesc')}</p>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {data.buckets.map((b) => {
                  const wr = b.winRate;
                  const barColor = wr === null ? 'var(--subtle)' : wr >= 55 ? 'var(--green)' : wr >= 45 ? 'var(--amber)' : 'var(--red)';
                  return (
                    <div key={b.label} className="px-5 py-4" style={{ background: 'var(--surface)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{b.label}</span>
                        <span className="text-xs" style={{ color: 'var(--subtle)' }}>{b.total} {ts('events')}</span>
                      </div>
                      {b.total === 0 ? (
                        <p className="text-xs" style={{ color: 'var(--subtle)' }}>{ts('noData')}</p>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 mb-2 text-xs" style={{ color: 'var(--subtle)' }}>
                            <span className="text-lg font-bold font-mono" style={{ color: barColor }}>
                              {wr !== null ? `${wr.toFixed(0)}%` : '—'}
                            </span>
                            <span>{ts('winRate')}</span>
                            <span>·</span>
                            <span>{b.wins}W {b.total - b.wins}L</span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${wr ?? 0}%`, background: barColor }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="px-5 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>{ts('consensusGlossary')}</p>
              </div>
            </section>
          </div>

          {/* Per-event breakdown */}
          <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>{ts('perEventBreakdown')}</h2>
              <span className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>{data.totalEvents}</span>
            </div>

            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {data.events.map((event) => {
                const emoji = getSportEmoji(event.title, event.sport);
                const won = event.whales_won === true;
                const impliedProb = Number(event.avg_price) * 100;
                const decimalOdds = Number(event.avg_price) > 0 ? 1 / Number(event.avg_price) : null;
                const totalVol = Number(event.whale_volume) || 0;
                const topVol = Number(event.top_outcome_volume) || 0;
                const consensusPct = totalVol > 0 ? (topVol / totalVol) * 100 : 0;

                return (
                  <Link
                    key={event.id}
                    href={`/${locale}/events/${event.id}`}
                    className="group px-5 py-4 flex items-center gap-4 transition-all"
                    style={{ background: 'var(--surface)' }}
                  >
                    <span className="text-2xl shrink-0 w-10 text-center">{emoji}</span>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm md:text-base font-semibold line-clamp-1" style={{ color: won ? 'var(--text)' : 'var(--muted)' }}>
                          {event.title}
                        </h3>
                        <div className="flex items-center gap-2 shrink-0">
                          {event.sport && (
                            <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: 'var(--surface2)', color: 'var(--subtle)', border: '1px solid var(--border)' }}>
                              {event.sport}
                            </span>
                          )}
                          <span
                            className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide"
                            style={{
                              background: won ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                              color: won ? 'var(--green)' : 'var(--red)',
                              border: `1px solid ${won ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                            }}
                          >
                            {won ? t('statusWin') : t('statusLoss')}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs flex-wrap" style={{ color: 'var(--subtle)' }}>
                        <span>{ts('impliedProb')}: <span className="font-mono font-semibold" style={{ color: 'var(--muted)' }}>{impliedProb.toFixed(0)}%</span></span>
                        {decimalOdds && (
                          <span>{ts('decimalOdds')}: <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>{decimalOdds.toFixed(2)}x</span></span>
                        )}
                        {event.odds && (
                          <span>{ts('settledOdds')}: <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>@{Number(event.odds).toFixed(2)}</span></span>
                        )}
                        <span>{ts('consensus')}: <span className="font-mono font-semibold" style={{ color: consensusPct >= 80 ? 'var(--green)' : consensusPct >= 50 ? 'var(--amber)' : 'var(--muted)' }}>{consensusPct.toFixed(0)}%</span></span>
                        <span>{event.whale_count} {t('whaleCount')}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Glossary */}
          <div className="p-5 rounded-xl text-xs space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--subtle)' }}>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{ts('edge')}:</span> {ts('glossaryEdge')}</p>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{ts('expectedWinRate')}:</span> {ts('glossaryExpected')}</p>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{ts('adjustedWinRate')}:</span> {ts('glossaryAdjusted')}</p>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{ts('roi')}:</span> {ts('glossaryRoi')}</p>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{ts('consensus')}:</span> {ts('glossaryConsensus')}</p>
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
