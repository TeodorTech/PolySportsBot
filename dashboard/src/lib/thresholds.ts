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

// Multi-sport filter: comma-separated sport names, null = all sports
export function parseSports(raw: string | string[] | undefined): string[] | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const sports = value.split(',').map(s => s.trim()).filter(Boolean);
  return sports.length > 0 ? sports : null;
}

// Event volume threshold options (in USD)
export const VOLUME_OPTIONS = [0, 100_000, 300_000, 500_000, 700_000, 1_000_000] as const;
export type MinVolumeThreshold = typeof VOLUME_OPTIONS[number];
export const DEFAULT_MIN_VOLUME: MinVolumeThreshold = 0;

export function parseMinVolume(raw: string | string[] | undefined): MinVolumeThreshold {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return (VOLUME_OPTIONS as readonly number[]).includes(value)
    ? (value as MinVolumeThreshold)
    : DEFAULT_MIN_VOLUME;
}

// Minimum decimal-odds threshold options (1 = no filter)
export const MIN_ODDS_OPTIONS = [1, 1.5, 1.6, 1.7, 1.8, 1.9, 2] as const;
export type MinOddsThreshold = typeof MIN_ODDS_OPTIONS[number];
export const DEFAULT_MIN_ODDS: MinOddsThreshold = 1;

export function parseMinOdds(raw: string | string[] | undefined): MinOddsThreshold {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return (MIN_ODDS_OPTIONS as readonly number[]).includes(value)
    ? (value as MinOddsThreshold)
    : DEFAULT_MIN_ODDS;
}
