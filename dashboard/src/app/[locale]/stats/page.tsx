import { getTranslations } from 'next-intl/server';
import sql from '@/lib/db';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { getSportEmoji } from '@/lib/sportEmoji';

interface SettledEvent {
  id: string;
  title: string;
  odds: string | null;
  whales_won: boolean;
  whale_count: string;
  whale_volume: string;
  avg_price: string;
}

async function getStatsData() {
  const events = await sql`
    SELECT
      e.id,
      e.title,
      e.odds,
      e.whales_won,
      COUNT(w.id) as whale_count,
      SUM(w.trade_value) as whale_volume,
      AVG(w.price) as avg_price
    FROM events e
    LEFT JOIN whale_activity w ON e.id = w.event_id
    WHERE e.whales_won IS NOT NULL
    GROUP BY e.id
    ORDER BY e.id DESC
  ` as unknown as SettledEvent[];

  if (events.length === 0) {
    return null;
  }

  const totalEvents = events.length;
  const wins = events.filter(e => e.whales_won === true);
  const losses = events.filter(e => e.whales_won === false);
  const actualWins = wins.length;

  // Expected wins = sum of implied probabilities (avg price per event = implied prob)
  const expectedWins = events.reduce((sum, e) => {
    const impliedProb = Number(e.avg_price) || 0;
    return sum + impliedProb;
  }, 0);

  // Raw win rate
  const rawWinRate = (actualWins / totalEvents) * 100;

  // Expected win rate (market's baseline)
  const expectedWinRate = (expectedWins / totalEvents) * 100;

  // Edge = actual wins - expected wins (in percentage points)
  const edge = rawWinRate - expectedWinRate;

  // Adjusted win rate: sum(odds * win) / total — weights wins by difficulty
  // For won events, weight = 1/avg_price (the decimal odds payout)
  const adjustedWinScore = events.reduce((sum, e) => {
    if (e.whales_won === true) {
      const impliedProb = Number(e.avg_price) || 0;
      const decimalOdds = impliedProb > 0 ? 1 / impliedProb : 1;
      return sum + decimalOdds;
    }
    return sum;
  }, 0);
  const adjustedWinRate = (adjustedWinScore / totalEvents) * 100;

  // ROI: only for events where odds are set
  const eventsWithOdds = events.filter(e => e.odds !== null && Number(e.odds) > 0);
  let roi: number | null = null;
  let roiEventCount = 0;

  if (eventsWithOdds.length > 0) {
    const totalStaked = eventsWithOdds.reduce((sum, e) => sum + Number(e.whale_volume || 0), 0);
    const totalReturned = eventsWithOdds.reduce((sum, e) => {
      if (e.whales_won === true) {
        return sum + Number(e.whale_volume || 0) * Number(e.odds);
      }
      return sum; // loss = 0 return
    }, 0);
    roi = totalStaked > 0 ? ((totalReturned - totalStaked) / totalStaked) * 100 : 0;
    roiEventCount = eventsWithOdds.length;
  }

  return {
    totalEvents,
    actualWins,
    losses: losses.length,
    rawWinRate,
    expectedWinRate,
    edge,
    adjustedWinRate,
    roi,
    roiEventCount,
    events,
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
            {/* Raw Win Rate */}
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
                {ts('rawWinRate')}
              </p>
              <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--amber)' }}>
                {data.rawWinRate.toFixed(1)}%
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
                {data.actualWins}W — {data.losses}L / {data.totalEvents} {ts('events')}
              </p>
            </div>

            {/* Expected Win Rate */}
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
                {ts('expectedWinRate')}
              </p>
              <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--text)' }}>
                {data.expectedWinRate.toFixed(1)}%
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
                {ts('expectedWinRateDesc')}
              </p>
            </div>

            {/* Edge */}
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
                {ts('edge')}
              </p>
              <p
                className="text-3xl font-bold font-mono tracking-tight"
                style={{ color: data.edge >= 0 ? 'var(--green)' : 'var(--red)' }}
              >
                {data.edge >= 0 ? '+' : ''}{data.edge.toFixed(1)}pp
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
                {ts('edgeDesc')}
              </p>
            </div>

            {/* ROI */}
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
                {ts('roi')}
              </p>
              {data.roi !== null ? (
                <>
                  <p
                    className="text-3xl font-bold font-mono tracking-tight"
                    style={{ color: data.roi >= 0 ? 'var(--green)' : 'var(--red)' }}
                  >
                    {data.roi >= 0 ? '+' : ''}{data.roi.toFixed(1)}%
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
                    {ts('roiFrom')} {data.roiEventCount} {ts('events')}
                  </p>
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
            {/* Adjusted Win Rate */}
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
                {ts('adjustedWinRate')}
              </p>
              <p className="text-2xl font-bold font-mono tracking-tight" style={{ color: 'var(--amber)' }}>
                {data.adjustedWinRate.toFixed(1)}%
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>
                {ts('adjustedWinRateDesc')}
              </p>
            </div>

            {/* Win Streak Insight */}
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
                {ts('totalSettled')}
              </p>
              <p className="text-2xl font-bold font-mono tracking-tight" style={{ color: 'var(--text)' }}>
                {data.totalEvents}
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>
                {data.actualWins} {ts('wins')} · {data.losses} {ts('losses')}
              </p>
            </div>

            {/* Market Edge Summary */}
            <div className="p-5 rounded-xl card-hover" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>
                {ts('marketVerdict')}
              </p>
              <p
                className="text-2xl font-bold tracking-tight"
                style={{ color: data.edge >= 5 ? 'var(--green)' : data.edge >= 0 ? 'var(--amber)' : 'var(--red)' }}
              >
                {data.edge >= 5 ? ts('verdictStrong') : data.edge >= 0 ? ts('verdictNeutral') : ts('verdictWeak')}
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>
                {ts('marketVerdictDesc')}
              </p>
            </div>
          </div>

          {/* Per-event breakdown */}
          <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                {ts('perEventBreakdown')}
              </h2>
              <span className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
                {data.totalEvents}
              </span>
            </div>

            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {data.events.map((event) => {
                const emoji = getSportEmoji(event.title);
                const won = event.whales_won === true;
                const impliedProb = Number(event.avg_price) * 100;
                const decimalOdds = Number(event.avg_price) > 0 ? 1 / Number(event.avg_price) : null;

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
                        <span
                          className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide shrink-0"
                          style={{
                            background: won ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                            color: won ? 'var(--green)' : 'var(--red)',
                            border: `1px solid ${won ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                          }}
                        >
                          {won ? t('statusWin') : t('statusLoss')}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs flex-wrap" style={{ color: 'var(--subtle)' }}>
                        <span>{ts('impliedProb')}: <span className="font-mono font-semibold" style={{ color: 'var(--muted)' }}>{impliedProb.toFixed(0)}%</span></span>
                        {decimalOdds && (
                          <span>{ts('decimalOdds')}: <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>{decimalOdds.toFixed(2)}x</span></span>
                        )}
                        {event.odds && (
                          <span>{ts('settledOdds')}: <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>@{Number(event.odds).toFixed(2)}</span></span>
                        )}
                        <span>{event.whale_count} {t('whaleCount')}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Explanation footer */}
          <div className="p-5 rounded-xl text-xs space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--subtle)' }}>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{ts('edge')}:</span> {ts('glossaryEdge')}</p>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{ts('expectedWinRate')}:</span> {ts('glossaryExpected')}</p>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{ts('adjustedWinRate')}:</span> {ts('glossaryAdjusted')}</p>
            <p><span className="font-semibold" style={{ color: 'var(--muted)' }}>{ts('roi')}:</span> {ts('glossaryRoi')}</p>
          </div>
        </>
      )}

      {/* Footer */}
      <footer className="divider pt-8 pb-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs" style={{ color: 'var(--subtle)' }}>
        <span>🐋 {t('title')} — {t('heroTagline')}</span>
        <span>Data sourced from Polymarket</span>
      </footer>
    </div>
  );
}
