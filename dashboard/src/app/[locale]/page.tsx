import {getTranslations} from 'next-intl/server';
import sql from '@/lib/db';
import {TrendingUp, BarChart3, Users} from 'lucide-react';
import Link from 'next/link';

async function getStats() {
  // Count only settled events for success rate
  const settled = await sql`
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE whales_won = true) as wins
    FROM events
    WHERE whales_won IS NOT NULL
  `;

  const totalVolume = await sql`
    SELECT SUM(total_volume) as total FROM events
  `;

  return {
    successRate: settled[0].total > 0 ? (settled[0].wins / settled[0].total) * 100 : 0,
    totalVolume: totalVolume[0].total || 0,
    totalEvents: settled[0].total
  };
}

async function getRecentWhaleActivity() {
  return await sql`
    SELECT e.id, e.title, e.total_volume, e.whales_won, e.status,
           COUNT(w.id) as whale_count,
           SUM(w.trade_value) as whale_volume
    FROM events e
    LEFT JOIN whale_activity w ON e.id = w.event_id
    GROUP BY e.id
    ORDER BY e.total_volume DESC
    LIMIT 20
  `;
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('Dashboard');
  const stats = await getStats();
  const events = await getRecentWhaleActivity();

  return (
    <div className="space-y-8 md:space-y-12">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
            {t('title')}
          </h1>
          <p className="mt-1 text-zinc-400 text-base sm:text-lg">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex gap-4">
          <Link href="/en" className="text-xs uppercase tracking-widest text-zinc-500 hover:text-blue-400 transition-colors">EN</Link>
          <Link href="/ro" className="text-xs uppercase tracking-widest text-zinc-500 hover:text-blue-400 transition-colors">RO</Link>
        </div>
      </header>

      {/* Global Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <div className="p-6 md:p-8 rounded-2xl glass card-hover flex flex-col justify-between min-h-32 md:h-40">
          <div className="flex items-center gap-2 text-zinc-400 font-medium">
            <BarChart3 className="w-5 h-5 text-blue-500 shrink-0" />
            {t('whaleSuccessRate')}
          </div>
          <div className="text-4xl md:text-5xl font-mono font-bold tracking-tighter text-blue-400">
            {stats.successRate.toFixed(1)}%
          </div>
        </div>

        <div className="p-6 md:p-8 rounded-2xl glass card-hover flex flex-col justify-between min-h-32 md:h-40">
          <div className="flex items-center gap-2 text-zinc-400 font-medium">
            <TrendingUp className="w-5 h-5 text-emerald-500 shrink-0" />
            {t('volume')} (Total)
          </div>
          <div className="text-4xl md:text-5xl font-mono font-bold tracking-tighter text-emerald-400">
            ${(stats.totalVolume / 1000000).toFixed(1)}M
          </div>
        </div>

        <div className="p-6 md:p-8 rounded-2xl glass card-hover flex flex-col justify-between min-h-32 md:h-40">
          <div className="flex items-center gap-2 text-zinc-400 font-medium">
            <Users className="w-5 h-5 text-purple-500 shrink-0" />
            Whale Count
          </div>
          <div className="text-4xl md:text-5xl font-mono font-bold tracking-tighter text-purple-400">
            {events.length} Active
          </div>
        </div>
      </div>

      {/* Events List */}
      <section className="space-y-4 md:space-y-6">
        <h2 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-200">
          {t('upcomingEvents')}
        </h2>

        {events.length === 0 ? (
          <div className="p-10 text-center border border-dashed border-zinc-800 rounded-2xl text-zinc-500">
            {t('noEvents')}
          </div>
        ) : (
          <div className="grid gap-3 md:gap-4">
            {events.map((event) => (
              <Link
                key={event.id}
                href={`/${locale}/events/${event.id}`}
                className="group p-4 md:p-6 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-blue-500/50 hover:bg-zinc-800/50 transition-all flex items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <h3 className="text-base md:text-xl font-semibold text-zinc-100 line-clamp-2 group-hover:text-blue-400 transition-colors">
                    {event.title}
                  </h3>
                  <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm text-zinc-500 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-950 text-zinc-400 font-medium whitespace-nowrap">
                      {event.whale_count || 0} Whales
                    </span>
                    <span className="text-zinc-600 hidden sm:inline">|</span>
                    <span className="whitespace-nowrap">{t('volume')}: <span className="text-zinc-300">${(Number(event.total_volume) / 1000000).toFixed(1)}M</span></span>
                  </div>
                </div>
                <div className="flex items-center gap-3 md:gap-6 shrink-0">
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-widest text-zinc-600 mb-0.5 hidden sm:block">Status</div>
                    <div className={`text-xs md:text-sm font-bold uppercase tracking-wide ${
                      event.whales_won === true ? 'text-emerald-500' :
                      event.whales_won === false ? 'text-rose-500' : 'text-blue-500'
                    }`}>
                      {event.whales_won === true ? '✓ Win' :
                       event.whales_won === false ? '✗ Loss' : t('ongoing')}
                    </div>
                  </div>
                  <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-zinc-700 group-hover:text-blue-500 transition-colors shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
