import { getTranslations } from 'next-intl/server';
import sql from '@/lib/db';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { getSportEmoji } from '@/lib/sportEmoji';
import { calcOverallRoi, calcConvictionRoi, OVERALL_BANKROLL, OVERALL_STAKE, CONVICTION_BANKROLL, CONVICTION_STAKE } from '@/lib/roi';
import { Suspense } from 'react';
import TimeRangeFilter from '@/components/TimeRangeFilter';
import MinTradeFilter from '@/components/MinTradeFilter';
import { parseRange, rangeToDate, TIME_RANGES, type TimeRange } from '@/lib/timeRange';
import BankrollSection from '@/components/BankrollSection';
import { parseThreshold, calcConsensus, type MinTradeThreshold, parseSports, parseMinVolume, type MinVolumeThreshold } from '@/lib/thresholds';
import ConvictionEventsList from '@/components/ConvictionEventsList';
import SportFilter from '@/components/SportFilter';
import MinVolumeFilter from '@/components/MinVolumeFilter';

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

interface ConvictionRow {
  id: string;
  title: string;
  sport: string | null;
  odds: string | null;
  result_outcome: string | null;
  whales_won: boolean;
  big_trade_outcome: string | null;
  big_trade_volume: string;
  big_trade_count: string;
  avg_price: string;
  total_whale_volume: string;
}

async function getStatsData(range: TimeRange, threshold: MinTradeThreshold, sports: string[] | null, minVolume: MinVolumeThreshold) {
  const since = rangeToDate(range);
  const dateFilter = since ? sql`AND e.created_at >= ${since}` : sql``;

  // Multi-sport filter — split into named sports and whether 'Sports' (null) is included
  const namedSports = sports ? sports.filter(s => s !== 'Sports') : [];
  const includeNull = sports ? sports.includes('Sports') : false;
  const sportFilter = sports && sports.length > 0
    ? namedSports.length > 0 && includeNull
      ? sql`AND (e.sport IN ${sql(namedSports)} OR e.sport IS NULL)`
      : namedSports.length > 0
        ? sql`AND e.sport IN ${sql(namedSports)}`
        : sql`AND e.sport IS NULL`
    : sql``;

  // Event total volume filter
  const volumeFilter = minVolume > 0 ? sql`AND e.total_volume >= ${minVolume}` : sql``;

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
    ${dateFilter}
    ${sportFilter}
    ${volumeFilter}
    GROUP BY e.id
    ORDER BY e.created_at DESC
  ` as unknown as SettledEvent[];

  // Available sports for the filter UI — scoped to date range only, not sport/volume filters
  // so the dropdown always shows all sports even when one is active
  const sportListRows = await sql`
    SELECT DISTINCT e.sport
    FROM events e
    WHERE e.whales_won IS NOT NULL
    ${dateFilter}
    ORDER BY e.sport ASC NULLS LAST
  ` as unknown as { sport: string | null }[];
  const availableSports: string[] = sportListRows.map(r => r.sport || 'Sports');

  if (events.length === 0) return { availableSports, sports, empty: true as const };

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

  // Overall ROI: flat $100 per event (10% of $1000 bankroll)
  const eventsWithOdds = events.filter(e => e.odds !== null && Number(e.odds) > 0);
  const overallRoiResult = calcOverallRoi(
    eventsWithOdds.map(e => ({ won: e.whales_won === true, odds: Number(e.odds) }))
  );
  const roi = overallRoiResult?.roi ?? null;
  const roiPnl = overallRoiResult?.pnl ?? null;
  const roiEventCount = overallRoiResult?.eventCount ?? 0;

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

  // --- Conviction trades (>= threshold) breakdown ---
  const convictionRows = await sql`
    SELECT
      e.id,
      e.title,
      e.sport,
      e.odds,
      e.result_outcome,
      e.whales_won,
      (
        SELECT w2.outcome
        FROM whale_activity w2
        WHERE w2.event_id = e.id
        GROUP BY w2.outcome
        ORDER BY SUM(w2.trade_value) DESC
        LIMIT 1
      ) as big_trade_outcome,
      (
        SELECT SUM(w2.trade_value)
        FROM whale_activity w2
        WHERE w2.event_id = e.id AND w2.trade_value >= ${threshold}
      ) as big_trade_volume,
      (
        SELECT COUNT(*)
        FROM whale_activity w2
        WHERE w2.event_id = e.id AND w2.trade_value >= ${threshold}
      ) as big_trade_count,
      (
        SELECT AVG(w2.price)
        FROM whale_activity w2
        WHERE w2.event_id = e.id
      ) as avg_price,
      (
        SELECT SUM(w2.trade_value)
        FROM whale_activity w2
        WHERE w2.event_id = e.id
      ) as total_whale_volume
    FROM events e
    WHERE e.whales_won IS NOT NULL
    ${dateFilter}
    ${sportFilter}
    ${volumeFilter}
    ORDER BY e.created_at DESC
  ` as unknown as ConvictionRow[];

  const convictionEvents = convictionRows.filter(r => Number(r.big_trade_count) > 0);
  const convictionTotal = convictionEvents.length;
  const convictionWins = convictionEvents.filter(r =>
    r.result_outcome && r.big_trade_outcome && r.result_outcome === r.big_trade_outcome
  ).length;
  const convictionWinRate = convictionTotal > 0 ? (convictionWins / convictionTotal) * 100 : null;
  const totalBigTrades = convictionRows.reduce((sum, r) => sum + Number(r.big_trade_count), 0);

  // Conviction ROI: flat $250 per event (25% of $1000 bankroll)
  const convictionWithOdds = convictionEvents.filter(r => r.odds !== null && Number(r.odds) > 0);
  const convictionRoiResult = calcConvictionRoi(
    convictionWithOdds.map(r => ({
      won: !!(r.result_outcome && r.big_trade_outcome && r.result_outcome === r.big_trade_outcome),
      odds: Number(r.odds),
    }))
  );
  const convictionRoi = convictionRoiResult?.roi ?? null;
  const convictionPnl = convictionRoiResult?.pnl ?? null;

  // --- No-conviction events (zero trades >= $50k) ---
  const noConvictionEvents = convictionRows.filter(r => Number(r.big_trade_count) === 0);
  const noConvTotal = noConvictionEvents.length;
  const noConvWins = noConvictionEvents.filter(r => r.whales_won === true).length;
  const noConvWinRate = noConvTotal > 0 ? (noConvWins / noConvTotal) * 100 : null;
  const noConvWithOdds = noConvictionEvents.filter(r => r.odds !== null && Number(r.odds) > 0);
  const noConvRoiResult = calcOverallRoi(
    noConvWithOdds.map(r => ({ won: r.whales_won === true, odds: Number(r.odds) }))
  );
  const noConvRoi = noConvRoiResult?.roi ?? null;
  const noConvPnl = noConvRoiResult?.pnl ?? null;

  // --- Big trade granular analytics ---
  // Per-event: for events with settled outcomes, look at individual trade sizes and signals

  // Query: for each settled event, get per-trade detail for trades >= 50k
  const bigTradeRows = await sql`
    SELECT
      e.id,
      e.whales_won,
      e.odds,
      e.result_outcome,
      w.trade_value,
      w.price,
      w.outcome,
      w.timestamp_utc,
      e.created_at as event_created_at,
      (
        SELECT w2.outcome
        FROM whale_activity w2
        WHERE w2.event_id = e.id
        GROUP BY w2.outcome
        ORDER BY SUM(w2.trade_value) DESC
        LIMIT 1
      ) as consensus_outcome,
      (
        SELECT COUNT(DISTINCT w3.outcome)
        FROM whale_activity w3
        WHERE w3.event_id = e.id AND w3.trade_value >= 50000
      ) as big_trade_outcomes_count,
      (
        SELECT COUNT(*)
        FROM whale_activity w3
        WHERE w3.event_id = e.id AND w3.trade_value >= 50000
      ) as big_trade_count_total,
      (
        SELECT MAX(w3.trade_value)
        FROM whale_activity w3
        WHERE w3.event_id = e.id AND w3.trade_value >= 50000
      ) as max_trade_in_event
    FROM whale_activity w
    JOIN events e ON e.id = w.event_id
    WHERE e.whales_won IS NOT NULL
      AND w.trade_value >= 50000
      AND e.result_outcome IS NOT NULL
    ${dateFilter}
    ${sportFilter}
    ${volumeFilter}
    ORDER BY w.trade_value DESC
  `;

  // 1. Trade size tiers — win rate by trade size bucket
  // For each big trade, did that specific trade back the winning outcome?
  type TierStat = { total: number; wins: number; winRate: number | null };
  const tiers: Record<string, TierStat> = {
    '$50k–$100k': { total: 0, wins: 0, winRate: null },
    '$100k–$250k': { total: 0, wins: 0, winRate: null },
    '$250k+': { total: 0, wins: 0, winRate: null },
  };

  for (const r of bigTradeRows) {
    const val = Number(r.trade_value);
    const tradeBacked = r.outcome;
    const tradeWon = r.result_outcome && tradeBacked && r.result_outcome === tradeBacked;
    let tier: string;
    if (val < 100000) tier = '$50k–$100k';
    else if (val < 250000) tier = '$100k–$250k';
    else tier = '$250k+';
    tiers[tier].total += 1;
    if (tradeWon) tiers[tier].wins += 1;
  }
  for (const t of Object.values(tiers)) {
    if (t.total > 0) t.winRate = (t.wins / t.total) * 100;
  }
  const tradeSizeTiers = Object.entries(tiers).map(([label, s]) => ({ label, ...s }));

  // 2. Odds band — group by the price at which the big trade was placed
  // price is the implied probability (0–1), so "favourite" = price > 0.6, "mid" = 0.4–0.6, "longshot" < 0.4
  type BandStat = { label: string; total: number; wins: number; winRate: number | null; minPrice: number; maxPrice: number };
  const oddsBands: BandStat[] = [
    { label: 'Heavy fav (>70%)', minPrice: 0.70, maxPrice: 1.0, total: 0, wins: 0, winRate: null },
    { label: 'Favourite (50–70%)', minPrice: 0.50, maxPrice: 0.70, total: 0, wins: 0, winRate: null },
    { label: 'Pick\'em (35–50%)', minPrice: 0.35, maxPrice: 0.50, total: 0, wins: 0, winRate: null },
    { label: 'Underdog (<35%)', minPrice: 0.0, maxPrice: 0.35, total: 0, wins: 0, winRate: null },
  ];
  for (const r of bigTradeRows) {
    const price = Number(r.price);
    const tradeWon = r.result_outcome && r.outcome && r.result_outcome === r.outcome;
    const band = oddsBands.find(b => price >= b.minPrice && price < b.maxPrice)
      ?? (price >= 1.0 ? oddsBands[0] : oddsBands[oddsBands.length - 1]);
    band.total += 1;
    if (tradeWon) band.wins += 1;
  }
  for (const b of oddsBands) {
    if (b.total > 0) b.winRate = (b.wins / b.total) * 100;
  }

  // 3. Lone whale vs corroborated — per event, was there only 1 big trade or multiple?
  // Use event-level: events with exactly 1 big trade vs events with 2+ big trades
  const settledBigTradeEvents = bigTradeRows.reduce((map, r) => {
    if (!map.has(r.id)) map.set(r.id, r);
    return map;
  }, new Map<string, typeof bigTradeRows[0]>());

  let loneWon = 0, loneTotal = 0, corrWon = 0, corrTotal = 0;
  for (const r of settledBigTradeEvents.values()) {
    const count = Number(r.big_trade_count_total);
    // "won" here = big_trade_outcome (top outcome by volume among $50k+ trades) matched result_outcome
    // We re-use the same logic as convictionWins
    const bigTradeOutcome = bigTradeRows.filter(bt => bt.id === r.id)
      .reduce((best, bt) => {
        if (!best || Number(bt.trade_value) > Number(best.trade_value)) return bt;
        return best;
      }, null as typeof bigTradeRows[0] | null)?.outcome;
    const eventWon = r.result_outcome && bigTradeOutcome && r.result_outcome === bigTradeOutcome;
    if (count === 1) {
      loneTotal += 1;
      if (eventWon) loneWon += 1;
    } else {
      corrTotal += 1;
      if (eventWon) corrWon += 1;
    }
  }
  const loneWinRate = loneTotal > 0 ? (loneWon / loneTotal) * 100 : null;
  const corrWinRate = corrTotal > 0 ? (corrWon / corrTotal) * 100 : null;

  // 4. Divergent signal — events where the single largest trade goes AGAINST the majority consensus outcome
  // i.e. max_trade_outcome !== consensus_outcome
  let divTotal = 0, divWon = 0;
  let alignTotal = 0, alignWon = 0;

  for (const r of settledBigTradeEvents.values()) {
    // Find the single biggest trade for this event
    const biggestTrade = bigTradeRows
      .filter(bt => bt.id === r.id)
      .reduce((best, bt) => (!best || Number(bt.trade_value) > Number(best.trade_value)) ? bt : best, null as typeof bigTradeRows[0] | null);
    if (!biggestTrade) continue;
    const biggestOutcome = biggestTrade.outcome;
    const consensus = r.consensus_outcome;
    const eventWon = r.result_outcome && biggestOutcome && r.result_outcome === biggestOutcome;
    if (consensus && biggestOutcome && biggestOutcome !== consensus) {
      // Divergent: biggest trade goes against crowd
      divTotal += 1;
      if (eventWon) divWon += 1;
    } else {
      alignTotal += 1;
      if (eventWon) alignWon += 1;
    }
  }
  const divWinRate = divTotal > 0 ? (divWon / divTotal) * 100 : null;
  const alignWinRate = alignTotal > 0 ? (alignWon / alignTotal) * 100 : null;

  // 5. Both-sides split — events where $50k+ trades landed on 2+ different outcomes
  // big_trade_outcomes_count >= 2 means at least one big trade on each side
  // For each such event, track which side had more volume and whether that side won
  let splitTotal = 0, splitWon = 0;
  const splitEventIds = new Set<string>();

  for (const r of settledBigTradeEvents.values()) {
    if (Number(r.big_trade_outcomes_count) >= 2) {
      splitEventIds.add(r.id);
      splitTotal += 1;
      // "won" = the outcome with the most big-trade volume on it matched the result
      // Re-use the same biggest-trade logic: does the dominant big-trade outcome match result?
      const biggestTradeOutcome = bigTradeRows
        .filter(bt => bt.id === r.id)
        .reduce((best, bt) => (!best || Number(bt.trade_value) > Number(best.trade_value)) ? bt : best, null as typeof bigTradeRows[0] | null)?.outcome;
      if (r.result_outcome && biggestTradeOutcome && r.result_outcome === biggestTradeOutcome) splitWon += 1;
    }
  }
  const splitWinRate = splitTotal > 0 ? (splitWon / splitTotal) * 100 : null;
  const splitPct = settledBigTradeEvents.size > 0 ? (splitTotal / settledBigTradeEvents.size) * 100 : null;

  // --- Consensus breakdown ---
  // Consensus = top_outcome_volume / whale_volume for each event
  // Buckets: Low <50%, Medium 50-80%, High >80%
  const buckets: ConsensusBucket[] = [
    { label: 'Perfect (100%)', minPct: 100, maxPct: 100, total: 0, wins: 0, winRate: null },
    { label: 'High (80–99%)', minPct: 80, maxPct: 100, total: 0, wins: 0, winRate: null },
    { label: 'Medium (50–80%)', minPct: 50, maxPct: 80, total: 0, wins: 0, winRate: null },
  ];

  for (const e of events) {
    const totalVol = Number(e.whale_volume) || 0;
    const topVol = Number(e.top_outcome_volume) || 0;
    const consensusPct = calcConsensus(topVol, totalVol);
    if (consensusPct === null) continue;
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

  // --- Bankroll evolution chart ---
  // Walk events chronologically (oldest first) and simulate a $1000 bankroll
  const chronoEvents = [...events].reverse(); // events is DESC by id, reverse = ASC
  const bankrollPoints: import('@/components/BankrollChart').BankrollPoint[] = [];
  let overallBalance = OVERALL_BANKROLL;
  let convictionBalance = CONVICTION_BANKROLL;
  let hasAnyConvictionOdds = false;

  // Track conviction balance separately — only changes on events with big trades
  const convictionEventIds = new Set(convictionEvents.map(e => e.id));

  for (let i = 0; i < chronoEvents.length; i++) {
    const e = chronoEvents[i];
    const hasOdds = e.odds !== null && Number(e.odds) > 0;
    const label = `#${i + 1}`;

    // Overall: $100 stake per event, only when odds are available
    if (hasOdds) {
      overallBalance -= OVERALL_STAKE;
      if (e.whales_won === true) overallBalance += OVERALL_STAKE * Number(e.odds);
    }

    // Conviction: $250 stake, only on conviction events with odds
    const isConvictionWithOdds = convictionEventIds.has(e.id) && hasOdds;
    const wasFirstConviction = !hasAnyConvictionOdds && isConvictionWithOdds;
    if (isConvictionWithOdds) {
      hasAnyConvictionOdds = true;
      const convRow = convictionEvents.find(r => r.id === e.id)!;
      const convWon = !!(convRow.result_outcome && convRow.big_trade_outcome && convRow.result_outcome === convRow.big_trade_outcome);
      convictionBalance -= CONVICTION_STAKE;
      if (convWon) convictionBalance += CONVICTION_STAKE * Number(e.odds);
    }

    bankrollPoints.push({
      label,
      overall: hasOdds ? Math.round(overallBalance) : null,
      // On the very first conviction event, show the pre-trade balance (CONVICTION_BANKROLL)
      // so the line visually starts at $1000 rather than the post-trade result.
      // After that, carry forward the running balance so the line stays connected.
      conviction: wasFirstConviction
        ? CONVICTION_BANKROLL
        : hasAnyConvictionOdds ? Math.round(convictionBalance) : null,
    });
  }

  return {
    totalEvents, actualWins, losses,
    rawWinRate, expectedWinRate, edge,
    adjustedWinRate, roi, roiPnl, roiEventCount,
    sportStats, buckets, events,
    convictionTotal, convictionWins, convictionWinRate, totalBigTrades,
    convictionRoi, convictionPnl, convictionRoiCount: convictionWithOdds.length, convictionEvents,
    bankrollPoints,
    tradeSizeTiers, oddsBands,
    loneWinRate, loneTotal, loneWon,
    corrWinRate, corrTotal, corrWon,
    divWinRate, divTotal, divWon,
    alignWinRate, alignTotal, alignWon,
    splitTotal, splitWon, splitWinRate, splitPct,
    totalBigTradeEvents: settledBigTradeEvents.size,
    noConvTotal, noConvWins, noConvWinRate, noConvRoi, noConvPnl,
    noConvRoiCount: noConvWithOdds.length,
    threshold,
    availableSports,
    sports,
  };
}

export default async function StatsPage({ params, searchParams }: { params: Promise<{ locale: string }>, searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { locale } = await params;
  const { range: rangeParam, minTrade: minTradeParam, sports: sportsParam, minVolume: minVolumeParam } = await searchParams;
  const range = parseRange(rangeParam);
  const threshold = parseThreshold(minTradeParam);
  const sports = parseSports(sportsParam);
  const minVolume = parseMinVolume(minVolumeParam);
  const t = await getTranslations('Dashboard');
  const ts = await getTranslations('Stats');
  const data = await getStatsData(range, threshold, sports, minVolume);
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
              {ts('title')}
            </h1>
            <p className="text-base" style={{ color: 'var(--muted)' }}>
              {ts('subtitle')}
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
                  <p className="text-xs mt-1 font-mono font-semibold" style={{ color: data.roiPnl! >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {data.roiPnl! >= 0 ? '+' : ''}${data.roiPnl!.toFixed(0)} · $100/event
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{ts('roiFrom')} {data.roiEventCount} {ts('events')}</p>
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

          {/* Conviction Trades */}
          <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>{ts('convictionTitle')}</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{ts('convictionDesc')}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: 'var(--border)' }}>
              <div className="px-5 py-5" style={{ background: 'var(--surface)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('convictionWinRate')}</p>
                {data.convictionWinRate !== null ? (
                  <>
                    <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: data.convictionWinRate >= data.rawWinRate ? 'var(--green)' : 'var(--amber)' }}>
                      {data.convictionWinRate.toFixed(1)}%
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
                      {data.convictionWins}W — {data.convictionTotal - data.convictionWins}L / {data.convictionTotal} {ts('events')}
                    </p>
                  </>
                ) : (
                  <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--subtle)' }}>N/A</p>
                )}
              </div>

              <div className="px-5 py-5" style={{ background: 'var(--surface)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('convictionVsOverall')}</p>
                {data.convictionWinRate !== null ? (
                  <>
                    <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: data.convictionWinRate - data.rawWinRate >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {data.convictionWinRate - data.rawWinRate >= 0 ? '+' : ''}{(data.convictionWinRate - data.rawWinRate).toFixed(1)}pp
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{ts('convictionVsOverallDesc')}</p>
                  </>
                ) : (
                  <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--subtle)' }}>N/A</p>
                )}
              </div>

              <div className="px-5 py-5" style={{ background: 'var(--surface)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('roi')}</p>
                {data.convictionRoi !== null ? (
                  <>
                    <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: data.convictionRoi >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {data.convictionRoi >= 0 ? '+' : ''}{data.convictionRoi.toFixed(1)}%
                    </p>
                    <p className="text-xs mt-1 font-mono font-semibold" style={{ color: data.convictionPnl! >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {data.convictionPnl! >= 0 ? '+' : ''}${data.convictionPnl!.toFixed(0)} · $250/event
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{ts('roiFrom')} {data.convictionRoiCount} {ts('events')}</p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--subtle)' }}>N/A</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{ts('roiNone')}</p>
                  </>
                )}
              </div>
            </div>

            {data.convictionEvents.length > 0 && (
              <ConvictionEventsList
                events={data.convictionEvents}
                locale={locale}
                labels={{
                  convictionBacked: ts('convictionBacked'),
                  convictionResult: ts('convictionResult'),
                  impliedProb: ts('impliedProb'),
                  decimalOdds: ts('decimalOdds'),
                  settledOdds: ts('settledOdds'),
                  convictionTradesSuffix: ts('convictionTradesSuffix'),
                  statusWin: t('statusWin'),
                  statusLoss: t('statusLoss'),
                }}
              />
            )}
          </section>

          {/* No-Conviction Events */}
          <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>{ts('noConvTitle')}</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
                Events where every trade was under <span className="font-mono font-semibold" style={{ color: 'var(--amber)' }}>${(data.threshold / 1000).toFixed(0)}k</span> — the small-money baseline.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: 'var(--border)' }}>
              <div className="px-5 py-5" style={{ background: 'var(--surface)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>Win Rate (&lt;${(data.threshold / 1000).toFixed(0)}k trades)</p>
                {data.noConvWinRate !== null ? (
                  <>
                    <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: data.noConvWinRate >= data.rawWinRate ? 'var(--green)' : 'var(--amber)' }}>
                      {data.noConvWinRate.toFixed(1)}%
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
                      {data.noConvWins}W — {data.noConvTotal - data.noConvWins}L / {data.noConvTotal} {ts('events')}
                    </p>
                  </>
                ) : (
                  <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--subtle)' }}>N/A</p>
                )}
              </div>

              <div className="px-5 py-5" style={{ background: 'var(--surface)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('convictionVsOverall')}</p>
                {data.noConvWinRate !== null ? (
                  <>
                    <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: data.noConvWinRate - data.rawWinRate >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {data.noConvWinRate - data.rawWinRate >= 0 ? '+' : ''}{(data.noConvWinRate - data.rawWinRate).toFixed(1)}pp
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{ts('noConvVsOverallDesc')}</p>
                  </>
                ) : (
                  <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--subtle)' }}>N/A</p>
                )}
              </div>

              <div className="px-5 py-5" style={{ background: 'var(--surface)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('roi')}</p>
                {data.noConvRoi !== null ? (
                  <>
                    <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: data.noConvRoi >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {data.noConvRoi >= 0 ? '+' : ''}{data.noConvRoi.toFixed(1)}%
                    </p>
                    <p className="text-xs mt-1 font-mono font-semibold" style={{ color: data.noConvPnl! >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {data.noConvPnl! >= 0 ? '+' : ''}${data.noConvPnl!.toFixed(0)} · $100/event
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{ts('roiFrom')} {data.noConvRoiCount} {ts('events')}</p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--subtle)' }}>N/A</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{ts('roiNone')}</p>
                  </>
                )}
              </div>
            </div>

          </section>

          {/* Bankroll Evolution */}
          <BankrollSection points={data.bankrollPoints} />

          {/* Big Trade Deep Dive */}
          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>{ts('bigTradeTitle')}</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{ts('bigTradeSubtitle')}</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Trade Size Tiers */}
              <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  <h3 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>{ts('tierTitle')}</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{ts('tierDesc')}</p>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {data.tradeSizeTiers.map((tier) => {
                    const wr = tier.winRate;
                    const barColor = wr === null ? 'var(--subtle)' : wr >= 60 ? 'var(--green)' : wr >= 48 ? 'var(--amber)' : 'var(--red)';
                    return (
                      <div key={tier.label} className="px-5 py-4" style={{ background: 'var(--surface)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold font-mono" style={{ color: 'var(--text)' }}>{tier.label}</span>
                          <span className="text-xs" style={{ color: 'var(--subtle)' }}>{tier.total} trades</span>
                        </div>
                        {tier.total === 0 ? (
                          <p className="text-xs" style={{ color: 'var(--subtle)' }}>No data</p>
                        ) : (
                          <>
                            <div className="flex items-center gap-3 mb-2 text-xs" style={{ color: 'var(--subtle)' }}>
                              <span className="text-xl font-bold font-mono" style={{ color: barColor }}>
                                {wr !== null ? `${wr.toFixed(0)}%` : '—'}
                              </span>
                              <span>{ts('winRate')}</span>
                              <span>·</span>
                              <span>{tier.wins}W {tier.total - tier.wins}L</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                              <div className="h-full rounded-full" style={{ width: `${wr ?? 0}%`, background: barColor }} />
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="px-5 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>{ts('tierGlossary')}</p>
                </div>
              </section>

              {/* Odds Band */}
              <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  <h3 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>{ts('oddsBandTitle')}</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{ts('oddsBandDesc')}</p>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {data.oddsBands.map((band) => {
                    const wr = band.winRate;
                    const implied = ((band.minPrice + band.maxPrice) / 2 * 100);
                    const edge = wr !== null ? wr - implied : null;
                    const barColor = wr === null ? 'var(--subtle)' : (edge ?? 0) >= 5 ? 'var(--green)' : (edge ?? 0) >= -5 ? 'var(--amber)' : 'var(--red)';
                    return (
                      <div key={band.label} className="px-5 py-4" style={{ background: 'var(--surface)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{band.label}</span>
                          <div className="flex items-center gap-2">
                            {edge !== null && (
                              <span className="text-xs font-mono font-bold" style={{ color: barColor }}>
                                {edge >= 0 ? '+' : ''}{edge.toFixed(1)}pp edge
                              </span>
                            )}
                            <span className="text-xs" style={{ color: 'var(--subtle)' }}>{band.total} trades</span>
                          </div>
                        </div>
                        {band.total === 0 ? (
                          <p className="text-xs" style={{ color: 'var(--subtle)' }}>No data</p>
                        ) : (
                          <>
                            <div className="flex items-center gap-3 mb-2 text-xs" style={{ color: 'var(--subtle)' }}>
                              <span className="text-xl font-bold font-mono" style={{ color: barColor }}>
                                {wr !== null ? `${wr.toFixed(0)}%` : '—'}
                              </span>
                              <span>{ts('winRate')}</span>
                              <span>·</span>
                              <span>{band.wins}W {band.total - band.wins}L</span>
                              <span>·</span>
                              <span>exp. {implied.toFixed(0)}%</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                              <div className="h-full rounded-full" style={{ width: `${wr ?? 0}%`, background: barColor }} />
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="px-5 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>{ts('oddsBandGlossary')}</p>
                </div>
              </section>
            </div>

            {/* Lone Whale vs Corroborated + Divergent Signal + Both-Sides Split */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Lone vs Corroborated */}
              <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  <h3 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>{ts('loneTitle')}</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{ts('loneDesc')}</p>
                </div>
                <div className="grid grid-cols-2 divide-x" style={{ borderColor: 'var(--border)' }}>
                  {[
                    { label: ts('loneSingle'), wr: data.loneWinRate, w: data.loneWon, total: data.loneTotal },
                    { label: ts('loneMultiple'), wr: data.corrWinRate, w: data.corrWon, total: data.corrTotal },
                  ].map(({ label, wr, w, total }) => {
                    const barColor = wr === null ? 'var(--subtle)' : wr >= 55 ? 'var(--green)' : wr >= 45 ? 'var(--amber)' : 'var(--red)';
                    return (
                      <div key={label} className="px-5 py-5" style={{ background: 'var(--surface)' }}>
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{label}</p>
                        {total === 0 ? (
                          <p className="text-2xl font-bold font-mono" style={{ color: 'var(--subtle)' }}>N/A</p>
                        ) : (
                          <>
                            <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: barColor }}>
                              {wr !== null ? `${wr.toFixed(1)}%` : '—'}
                            </p>
                            <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{w}W — {total - w}L / {total} events</p>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="px-5 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>{ts('loneGlossary')}</p>
                </div>
              </section>

              {/* Divergent Signal */}
              <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  <h3 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>{ts('divTitle')}</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{ts('divDesc')}</p>
                </div>
                <div className="grid grid-cols-2 divide-x" style={{ borderColor: 'var(--border)' }}>
                  {[
                    { label: ts('divAligned'), wr: data.alignWinRate, w: data.alignWon, total: data.alignTotal },
                    { label: ts('divDivergent'), wr: data.divWinRate, w: data.divWon, total: data.divTotal },
                  ].map(({ label, wr, w, total }) => {
                    const barColor = wr === null ? 'var(--subtle)' : wr >= 55 ? 'var(--green)' : wr >= 45 ? 'var(--amber)' : 'var(--red)';
                    return (
                      <div key={label} className="px-5 py-5" style={{ background: 'var(--surface)' }}>
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{label}</p>
                        {total === 0 ? (
                          <p className="text-2xl font-bold font-mono" style={{ color: 'var(--subtle)' }}>N/A</p>
                        ) : (
                          <>
                            <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: barColor }}>
                              {wr !== null ? `${wr.toFixed(1)}%` : '—'}
                            </p>
                            <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{w}W — {total - w}L / {total} events</p>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="px-5 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>{ts('divGlossary')}</p>
                </div>
              </section>

              {/* Both-Sides Split */}
              <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  <h3 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>{ts('splitTitle')}</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{ts('splitDesc')}</p>
                </div>
                <div className="grid grid-cols-2 divide-x" style={{ borderColor: 'var(--border)' }}>
                  <div className="px-5 py-5" style={{ background: 'var(--surface)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('splitEventCount')}</p>
                    <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--amber)' }}>
                      {data.splitTotal}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
                      {data.splitPct !== null ? `${data.splitPct.toFixed(0)}% of ${data.totalBigTradeEvents} events` : '—'}
                    </p>
                  </div>
                  <div className="px-5 py-5" style={{ background: 'var(--surface)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>{ts('splitWinRate')}</p>
                    {data.splitTotal === 0 ? (
                      <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: 'var(--subtle)' }}>N/A</p>
                    ) : (
                      <>
                        <p className="text-3xl font-bold font-mono tracking-tight" style={{
                          color: data.splitWinRate !== null && data.splitWinRate >= 55 ? 'var(--green)' : data.splitWinRate !== null && data.splitWinRate >= 45 ? 'var(--amber)' : 'var(--red)'
                        }}>
                          {data.splitWinRate !== null ? `${data.splitWinRate.toFixed(1)}%` : '—'}
                        </p>
                        <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>{data.splitWon}W — {data.splitTotal - data.splitWon}L</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="px-5 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>{ts('splitGlossary')}</p>
                </div>
              </section>

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
