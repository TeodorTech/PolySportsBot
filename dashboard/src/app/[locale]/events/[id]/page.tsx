import { getTranslations } from 'next-intl/server';
import sql from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import WhaleChart from '@/components/WhaleChart';
import { getSportEmoji } from '@/lib/sportEmoji';
import { revalidatePath } from 'next/cache';
import { calcConsensus, consensusColor } from '@/lib/thresholds';
import LocalTime from '@/components/LocalTime';

interface WhaleTrade {
  id: number;
  event_id: string;
  outcome: string;
  side: string;
  price: string;
  trade_value: string;
  timestamp_utc: string;
}

async function getEventData(id: string) {
  const event = await sql`
    SELECT * FROM events WHERE id = ${id}
  `;

  if (!event || event.length === 0) return null;

  const activity = await sql`
    SELECT * FROM whale_activity
    WHERE event_id = ${id}
    ORDER BY timestamp_utc DESC
  ` as unknown as WhaleTrade[];

  const volumePerOutcome = activity.reduce((acc: Record<string, number>, curr) => {
    acc[curr.outcome] = (acc[curr.outcome] || 0) + Number(curr.trade_value);
    return acc;
  }, {});

  const chartData = Object.entries(volumePerOutcome).map(([outcome, value]) => ({
    outcome,
    value: value as number
  })).sort((a, b) => b.value - a.value);

  // Whale sentiment and consensus based on conviction trades (>= $50k) only
  const CONVICTION_THRESHOLD = 50000;
  const convictionTrades = activity.filter(t => Number(t.trade_value) >= CONVICTION_THRESHOLD);

  const convictionVolumePerOutcome = convictionTrades.reduce((acc: Record<string, number>, curr) => {
    acc[curr.outcome] = (acc[curr.outcome] || 0) + Number(curr.trade_value);
    return acc;
  }, {});

  const convictionChartData = Object.entries(convictionVolumePerOutcome).map(([outcome, value]) => ({
    outcome,
    value: value as number
  })).sort((a, b) => b.value - a.value);

  // Outcome whales backed most (by conviction volume)
  const whaleOutcome = convictionChartData[0]?.outcome ?? chartData[0]?.outcome ?? null;

  const totalAllVolume = chartData.reduce((s, d) => s + d.value, 0);
  const consensusPct = calcConsensus(chartData[0]?.value ?? 0, totalAllVolume);

  return {
    event: event[0],
    activity,
    chartData,
    whaleOutcome,
    consensusPct,
  };
}

async function deleteEvent(formData: FormData) {
  'use server';
  const eventId = formData.get('eventId') as string;
  const locale = formData.get('locale') as string;
  await sql`DELETE FROM whale_activity WHERE event_id = ${eventId}`;
  await sql`DELETE FROM events WHERE id = ${eventId}`;
  redirect(`/${locale}`);
}

async function toggleSettlement(formData: FormData) {
  'use server';
  const eventId = formData.get('eventId') as string;
  const locale = formData.get('locale') as string;
  const resultOutcome = formData.get('result_outcome') as string | null;
  const whaleOutcome = formData.get('whale_outcome') as string | null;
  const oddsRaw = parseFloat(formData.get('odds') as string);

  const isUnsettled = formData.get('unsettled') === '1';
  if (isUnsettled) {
    await sql`UPDATE events SET whales_won = NULL, result_outcome = NULL, odds = NULL, status = 'active' WHERE id = ${eventId}`;
  } else if (resultOutcome) {
    const whalesWon = resultOutcome === whaleOutcome;
    const odds = !isNaN(oddsRaw) ? oddsRaw : null;
    await sql`UPDATE events SET whales_won = ${whalesWon}, result_outcome = ${resultOutcome}, odds = ${odds}, status = 'closed' WHERE id = ${eventId}`;
  }

  revalidatePath(`/${locale}/events/${eventId}`);
}

export default async function EventPage({
  params
}: {
  params: Promise<{ id: string; locale: string }>
}) {
  const { id, locale } = await params;
  const data = await getEventData(id);
  if (!data) notFound();

  const t = await getTranslations('Dashboard');
  const emoji = getSportEmoji(data.event.title, data.event.sport);

  // Outcomes for settlement dropdown — prefer stored array, fall back to whale_activity outcomes
  const outcomeOptions: string[] = data.event.outcomes?.length
    ? data.event.outcomes
    : data.chartData.map((d: { outcome: string }) => d.outcome);

  const totalWhaleVolume = data.activity.reduce((a: number, b: WhaleTrade) => a + Number(b.trade_value), 0);
  const avgTradeSize = data.activity.length > 0 ? totalWhaleVolume / data.activity.length : 0;

  return (
    <div className="space-y-8 md:space-y-12">
      {/* Navigation */}
      <nav>
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-2 text-sm font-medium transition-colors"
          style={{color: 'var(--muted)'}}
        >
          <ArrowLeft className="w-4 h-4" />
          {t('backToMarkets')}
        </Link>
      </nav>

      {/* Header */}
      <header className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-3xl">{emoji}</span>
          {data.event.whales_won === null ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider" style={{background: 'rgba(34, 197, 94, 0.1)', color: 'var(--green)', border: '1px solid rgba(34, 197, 94, 0.2)'}}>
              <span className="live-dot" />
              {t('ongoing')}
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider" style={{
              background: data.event.whales_won ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: data.event.whales_won ? 'var(--green)' : 'var(--red)',
              border: `1px solid ${data.event.whales_won ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
            }}>
              {t('settled')} — {data.event.whales_won ? t('statusWin') : t('statusLoss')}
            </span>
          )}
        </div>
        <h1 className="text-2xl md:text-4xl font-bold tracking-tight leading-tight" style={{color: 'var(--text)'}}>
          {data.event.title}
        </h1>
        <p className="text-sm md:text-base" style={{color: 'var(--muted)'}}>
          {data.activity.length} {t('whaleCount')} · ${(Number(data.event.total_volume) / 1000000).toFixed(1)}M {t('volume').toLowerCase()}
          {data.event.game_start_time && (
            <span className="ml-3" style={{color: 'var(--subtle)'}}>
              · 🕐 <LocalTime iso={data.event.game_start_time} />
            </span>
          )}
        </p>
      </header>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        {/* Left Column — Chart & Table */}
        <section className="lg:col-span-2 space-y-6">
          {/* Chart */}
          <div className="p-5 md:p-8 rounded-xl" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
            <h2 className="text-base md:text-lg font-bold mb-6" style={{color: 'var(--text)'}}>
              {t('whaleMoneyBreakdown')}
            </h2>
            <WhaleChart data={data.chartData} />
          </div>

          {/* Activity Table */}
          <div className="p-5 md:p-8 rounded-xl" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
            <h2 className="text-base md:text-lg font-bold mb-6" style={{color: 'var(--text)'}}>
              {t('whaleActivity')}
            </h2>
            <div className="overflow-x-auto -mx-5 md:mx-0 px-5 md:px-0">
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr style={{borderBottom: '1px solid var(--border)'}}>
                    <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wider" style={{color: 'var(--subtle)'}}>{t('outcome')}</th>
                    <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wider" style={{color: 'var(--subtle)'}}>{t('side')}</th>
                    <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wider" style={{color: 'var(--subtle)'}}>{t('price')}</th>
                    <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wider" style={{color: 'var(--subtle)'}}>{t('value')}</th>
                    <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wider hidden sm:table-cell" style={{color: 'var(--subtle)'}}>{t('timestamp')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.activity.map((trade) => {
                    const isConviction = Number(trade.trade_value) >= 50000;
                    return (
                    <tr key={trade.id} className="group" style={{borderBottom: '1px solid var(--border)'}}>
                      <td className="py-3 text-sm font-semibold max-w-[140px] truncate" style={{color: 'var(--text)'}}>
                        {trade.outcome}
                      </td>
                      <td className="py-3 text-sm font-bold" style={{color: trade.side === 'BUY' ? 'var(--green)' : 'var(--red)'}}>
                        {trade.side}
                      </td>
                      <td className="py-3 text-sm font-mono" style={{color: 'var(--muted)'}}>
                        {(Number(trade.price) * 100).toFixed(1)}¢
                      </td>
                      <td className="py-3 text-sm font-bold whitespace-nowrap" style={{color: isConviction ? 'var(--amber)' : 'var(--text)'}}>
                        ${Number(trade.trade_value).toLocaleString()}
                      </td>
                      <td className="py-3 text-sm hidden sm:table-cell whitespace-nowrap" style={{color: 'var(--subtle)'}}>
                        {new Date(trade.timestamp_utc).toLocaleTimeString()}
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Right Column — Insights */}
        <aside className="space-y-4">
          {/* Whale Sentiment */}
          <div className="p-6 rounded-xl" style={{background: 'var(--surface2)', border: '1px solid var(--border)'}}>
            <h3 className="text-base font-bold mb-2" style={{color: 'var(--amber)'}}>
              {t('whaleSentiment')}
            </h3>
            <p className="text-sm leading-relaxed" style={{color: 'var(--muted)'}}>
              {t('sentimentDescription')} <span className="font-bold" style={{color: 'var(--text)'}}>{data.whaleOutcome || 'N/A'}</span>.
            </p>
            {data.consensusPct !== null && (
              <div className="mt-3 pt-3" style={{borderTop: '1px solid var(--border)'}}>
                <div className="flex justify-between items-center text-sm mb-1.5">
                  <span style={{color: 'var(--muted)'}}>Consensus</span>
                  <span className="font-bold" style={{color: consensusColor(data.consensusPct)}}>
                    {data.consensusPct.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{background: 'var(--border)'}}>
                  <div className="h-full rounded-full" style={{width: `${data.consensusPct}%`, background: consensusColor(data.consensusPct)}} />
                </div>
              </div>
            )}
          </div>

          {/* Settle */}
          <div className="p-6 rounded-xl space-y-4" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{color: 'var(--subtle)'}}>
              {t('admin')}
            </h3>
            {data.whaleOutcome && (
              <p className="text-xs" style={{color: 'var(--muted)'}}>
                {t('whaleBacked')}: <span className="font-bold" style={{color: 'var(--amber)'}}>{data.whaleOutcome}</span>
              </p>
            )}
            <form action={toggleSettlement} className="space-y-3">
              <input type="hidden" name="eventId" value={id} />
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="whale_outcome" value={data.whaleOutcome ?? ''} />
              <select
                name="result_outcome"
                defaultValue={data.event.result_outcome ?? ''}
                className="w-full py-2 px-3 rounded-lg text-sm"
                style={{background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)'}}
              >
                <option value="">{t('selectWinner')}</option>
                {outcomeOptions.map((o: string) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              <input
                type="number"
                name="odds"
                step="0.01"
                min="1"
                placeholder={t('oddsPlaceholder')}
                defaultValue={data.event.odds ?? ''}
                className="w-full py-2 px-3 rounded-lg text-sm"
                style={{background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)'}}
              />
              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-lg text-sm font-bold transition-all"
                style={{background: 'var(--amber)', color: '#111318'}}
              >
                {t('settleSubmit')}
              </button>
              {data.event.whales_won !== null && (
                <button
                  name="unsettled"
                  value="1"
                  type="submit"
                  className="w-full py-2 px-4 rounded-lg text-xs transition-all"
                  style={{color: 'var(--subtle)'}}
                >
                  {t('notSettled')}
                </button>
              )}
            </form>
          </div>

          {/* Delete */}
          <div className="p-6 rounded-xl" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{color: 'var(--subtle)'}}>
              Danger Zone
            </h3>
            <form action={deleteEvent}>
              <input type="hidden" name="eventId" value={id} />
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-lg text-sm font-bold transition-all"
                style={{background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)', border: '1px solid rgba(239, 68, 68, 0.2)'}}
              >
                Delete Event
              </button>
            </form>
          </div>

          {/* Market Insights */}
          <div className="p-6 rounded-xl space-y-4" style={{background: 'var(--surface)', border: '1px solid var(--border)'}}>
            <h3 className="text-base font-bold" style={{color: 'var(--text)'}}>
              {t('marketInsights')}
            </h3>
            <div className="space-y-3">
              {data.event.game_start_time && (
                <>
                  <div className="flex justify-between items-center text-sm">
                    <span style={{color: 'var(--muted)'}}>Game Start</span>
                    <LocalTime iso={data.event.game_start_time} className="font-bold font-mono text-right" style={{color: 'var(--text)', fontSize: '0.75rem'}} />
                  </div>
                  <div className="divider" />
                </>
              )}
              <div className="flex justify-between items-center text-sm">
                <span style={{color: 'var(--muted)'}}>{t('whaleBets')}</span>
                <span className="font-bold" style={{color: 'var(--text)'}}>{data.activity.length}</span>
              </div>
              <div className="divider" />
              <div className="flex justify-between items-center text-sm">
                <span style={{color: 'var(--muted)'}}>{t('avgTradeSize')}</span>
                <span className="font-bold" style={{color: 'var(--text)'}}>
                  ${avgTradeSize.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="divider" />
              <div className="flex justify-between items-center text-sm">
                <span style={{color: 'var(--muted)'}}>{t('marketLiquidity')}</span>
                <span className="font-bold" style={{color: 'var(--green)'}}>{t('high')}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
