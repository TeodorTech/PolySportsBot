import { getTranslations } from 'next-intl/server';
import sql from '@/lib/db';
import { notFound } from 'next/navigation';
import { ArrowLeft, TrendingUp, ShieldCheck, History } from 'lucide-react';
import Link from 'next/link';
import WhaleChart from '@/components/WhaleChart';
import { revalidatePath } from 'next/cache';

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

  // Aggregate volume per outcome
  const volumePerOutcome = activity.reduce((acc: Record<string, number>, curr) => {
    acc[curr.outcome] = (acc[curr.outcome] || 0) + Number(curr.trade_value);
    return acc;
  }, {});

  const chartData = Object.entries(volumePerOutcome).map(([outcome, value]) => ({
    outcome,
    value: value as number
  })).sort((a, b) => b.value - a.value);

  return {
    event: event[0],
    activity,
    chartData
  };
}

// Global server action for settlement
async function toggleSettlement(eventId: string, locale: string, outcome: boolean | null) {
  'use server';
  await sql`
    UPDATE events SET whales_won = ${outcome} WHERE id = ${eventId}
  `;
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

  return (
    <div className="space-y-6 md:space-y-10">
      {/* Navigation & Header */}
      <nav>
        <Link href={`/${locale}`} className="inline-flex items-center gap-2 text-zinc-500 hover:text-blue-400 transition-colors text-sm font-medium">
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </nav>

      <header className="flex flex-col gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-500 text-xs font-bold uppercase tracking-wider border border-blue-500/20">
              High Volume Match
            </span>
            <span className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider border ${
              data.event.whales_won !== null ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-zinc-800 text-zinc-400 border-zinc-700'
            }`}>
              {data.event.whales_won !== null ? t('settled') : t('ongoing')}
            </span>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-white leading-tight">
            {data.event.title}
          </h1>
          <p className="text-zinc-500 text-sm md:text-lg">
            Analyzing {data.activity.length} whale movements worth ${(Number(data.event.total_volume) / 1000000).toFixed(1)}M in total liquidity.
          </p>
        </div>

        {/* Admin Controls */}
        <div className="p-4 md:p-6 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3 w-full md:max-w-sm">
          <div className="flex items-center gap-2 text-zinc-400 text-sm font-semibold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
            {t('admin')}
          </div>
          <div className="flex flex-col gap-2">
            <form action={toggleSettlement.bind(null, id, locale, true)}>
              <button type="submit" className={`w-full py-3 px-4 rounded-xl text-sm font-bold transition-all ${
                data.event.whales_won === true ? 'bg-emerald-600 text-emerald-50' : 'bg-zinc-800 text-zinc-400 hover:bg-emerald-600/20 hover:text-emerald-400'
              }`}>
                {t('settleWhalesWon')}
              </button>
            </form>
            <form action={toggleSettlement.bind(null, id, locale, false)}>
              <button type="submit" className={`w-full py-3 px-4 rounded-xl text-sm font-bold transition-all ${
                data.event.whales_won === false ? 'bg-rose-600 text-rose-50' : 'bg-zinc-800 text-zinc-400 hover:bg-rose-600/20 hover:text-rose-400'
              }`}>
                {t('settleWhalesLost')}
              </button>
            </form>
            <form action={toggleSettlement.bind(null, id, locale, null)}>
              <button type="submit" className="w-full py-3 px-4 rounded-xl text-sm font-bold bg-zinc-950 text-zinc-600 hover:text-zinc-400 transition-colors">
                {t('notSettled')}
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content: Chart & Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-10">
        <section className="lg:col-span-2 space-y-6">
          <div className="p-5 md:p-8 rounded-3xl bg-zinc-900/50 border border-zinc-800">
            <div className="flex items-center justify-between mb-6 md:mb-8">
              <h2 className="text-base md:text-xl font-bold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-400 shrink-0" />
                {t('whaleMoneyBreakdown')}
              </h2>
            </div>
            <WhaleChart data={data.chartData} />
          </div>

          <div className="p-5 md:p-8 rounded-3xl bg-zinc-900/50 border border-zinc-800">
            <h2 className="text-base md:text-xl font-bold flex items-center gap-2 mb-6 md:mb-8">
              <History className="w-5 h-5 text-purple-400 shrink-0" />
              {t('whaleActivity')}
            </h2>
            <div className="overflow-x-auto -mx-5 md:mx-0 px-5 md:px-0">
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr className="text-left border-b border-zinc-800">
                    <th className="pb-3 text-xs font-bold uppercase tracking-widest text-zinc-600">{t('outcome')}</th>
                    <th className="pb-3 text-xs font-bold uppercase tracking-widest text-zinc-600">{t('side')}</th>
                    <th className="pb-3 text-xs font-bold uppercase tracking-widest text-zinc-600">{t('price')}</th>
                    <th className="pb-3 text-xs font-bold uppercase tracking-widest text-zinc-600">{t('value')}</th>
                    <th className="pb-3 text-xs font-bold uppercase tracking-widest text-zinc-600 hidden sm:table-cell">{t('timestamp')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {data.activity.map((trade) => (
                    <tr key={trade.id} className="group">
                      <td className="py-3 text-sm font-bold text-zinc-100 group-hover:text-blue-400 transition-colors max-w-[120px] truncate">
                        {trade.outcome}
                      </td>
                      <td className={`py-3 text-sm font-black ${trade.side === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {trade.side}
                      </td>
                      <td className="py-3 text-sm text-zinc-400 font-mono">
                        {(Number(trade.price) * 100).toFixed(1)}¢
                      </td>
                      <td className="py-3 text-sm font-bold text-zinc-200 whitespace-nowrap">
                        ${Number(trade.trade_value).toLocaleString()}
                      </td>
                      <td className="py-3 text-sm text-zinc-500 hidden sm:table-cell whitespace-nowrap">
                        {new Date(trade.timestamp_utc).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Sidebar Insights */}
        <aside className="space-y-4 md:space-y-6">
          <div className="p-6 md:p-8 rounded-3xl bg-blue-600 space-y-4 relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-xl md:text-2xl font-black text-white leading-tight">Whale Sentiment</h3>
              <p className="text-blue-100 text-sm opacity-80 mt-1">The most aggressive whale volume is currently betting on <span className="underline decoration-2 underline-offset-4">{data.chartData[0]?.outcome || 'N/A'}</span>.</p>
            </div>
            <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
          </div>

          <div className="p-6 md:p-8 rounded-3xl border border-zinc-800 space-y-4 md:space-y-6">
            <h3 className="text-base md:text-lg font-bold text-zinc-200">Market Insights</h3>
            <div className="space-y-3 md:space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-zinc-500">Total Whale Bets</span>
                <span className="text-zinc-200 font-bold">{data.activity.length}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-zinc-500">Avg. Trade Size</span>
                <span className="text-zinc-200 font-bold">
                  ${(data.activity.reduce((a: number, b: WhaleTrade) => a + Number(b.trade_value), 0) / data.activity.length).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-zinc-500">Market Liquidity</span>
                <span className="text-zinc-200 font-bold">High</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
