import BankrollChart, { type BankrollPoint } from '@/components/BankrollChart';
import { OVERALL_BANKROLL } from '@/lib/roi';

interface Props {
  points: BankrollPoint[];
}

export default function BankrollSection({ points }: Props) {
  if (!points.some(p => p.overall !== null)) return null;

  return (
    <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <div className="px-5 py-4" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
        <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          $1,000 Account Evolution
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
          Simulated bankroll starting at $1,000 — <span style={{ color: 'var(--amber)' }}>$100/event (overall)</span> · <span style={{ color: 'var(--green)' }}>$250/event (conviction)</span>
        </p>
      </div>
      <div className="p-4" style={{ background: 'var(--surface)' }}>
        <BankrollChart data={points} bankroll={OVERALL_BANKROLL} />
      </div>
    </section>
  );
}
