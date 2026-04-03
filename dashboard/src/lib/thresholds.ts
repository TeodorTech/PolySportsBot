export const THRESHOLD_OPTIONS = [10000, 20000, 30000, 50000, 75000, 100000] as const;
export type MinTradeThreshold = typeof THRESHOLD_OPTIONS[number];
export const DEFAULT_THRESHOLD: MinTradeThreshold = 50000;

export function parseThreshold(raw: string | string[] | undefined): MinTradeThreshold {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return (THRESHOLD_OPTIONS as readonly number[]).includes(value)
    ? (value as MinTradeThreshold)
    : DEFAULT_THRESHOLD;
}
