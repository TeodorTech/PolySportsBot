export const THRESHOLD_OPTIONS = [10000, 20000, 30000, 50000, 75000, 100000] as const;

/**
 * Consensus = % of total whale volume on the top (most-backed) outcome.
 * Returns null when there is no volume to avoid division by zero.
 */
export function calcConsensus(topOutcomeVolume: number, totalWhaleVolume: number): number | null {
  if (totalWhaleVolume <= 0) return null;
  return (topOutcomeVolume / totalWhaleVolume) * 100;
}

/** CSS variable name for the consensus percentage color. */
export function consensusColor(pct: number): string {
  if (pct >= 80) return 'var(--green)';
  if (pct >= 50) return 'var(--amber)';
  return 'var(--muted)';
}

export type MinTradeThreshold = typeof THRESHOLD_OPTIONS[number];
export const DEFAULT_THRESHOLD: MinTradeThreshold = 50000;

export function parseThreshold(raw: string | string[] | undefined): MinTradeThreshold {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return (THRESHOLD_OPTIONS as readonly number[]).includes(value)
    ? (value as MinTradeThreshold)
    : DEFAULT_THRESHOLD;
}
