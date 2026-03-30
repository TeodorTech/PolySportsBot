import {getTranslations} from 'next-intl/server';
import sql from '@/lib/db';
import {ArrowRight} from 'lucide-react';
import Link from 'next/link';
import {getSportEmoji} from '@/lib/sportEmoji';

async function getStats() {
  const settled = await sql`
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE whales_won = true) as wins
    FROM events
    WHERE whales_won IS NOT NULL
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
    SELECT e.id, e.title, e.total_volume, e.whales_won, e.status,
           COUNT(w.id) as whale_count,
           SUM(w.trade_value) as whale_volume
    FROM events e
    LEFT JOIN whale_activity w ON e.id = w.event_id
    WHERE e.whales_won IS NULL
    GROUP BY e.id
    ORDER BY e.total_volume DESC
    LIMIT 20
  `;
}

async function getSettledMarkets() {
  return await sql`
    SELECT e.id, e.title, e.total_volume, e.whales_won,
           COUNT(w.id) as whale_count
    FROM events e
    LEFT JOIN whale_activity w ON e.id = w.event_id
    WHERE e.whales_won IS NOT NULL
    GROUP BY e.id
    ORDER BY e.total_volume DESC
    LIMIT 50
  `;
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('Dashboard');
  const [stats, trending, settled] = await Promise.all([
    getStats(),
    getTrendingMarkets(),
    getSettledMarkets(),
  ]);

  const maxVolume = trending.length > 0
    ? Math.max(...trending.map((e) => Number(e.whale_volume) || 0))
    : 1;

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
          <div className="flex gap-4">
            <Link href="/en" className="text-xs uppercase tracking-widest hover:opacity-100 transition-opacity" style={{color: locale === 'en' ? 'var(--amber)' : 'var(--subtle)'}}>EN</Link>
            <Link href="/ro" className="text-xs uppercase tracking-widest hover:opacity-100 transition-opacity" style={{color: locale === 'ro' ? 'var(--amber)' : 'var(--subtle)'}}>RO</Link>
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
              const emoji = getSportEmoji(event.title);
              const whaleVolume = Number(event.whale_volume) || 0;
              const confidence = maxVolume > 0 ? (whaleVolume / maxVolume) * 100 : 0;

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
                    </div>

                    <div className="confidence-bar">
                      <div className="confidence-bar-fill" style={{width: `${confidence}%`}} />
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
              const emoji = getSportEmoji(event.title);
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
                    </div>
                  </div>

                  <ArrowRight className="w-4 h-4 shrink-0" style={{color: 'var(--subtle)'}} />
                </Link>
              );
            })}
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
