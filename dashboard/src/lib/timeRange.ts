export type TimeRange = '7d' | '15d' | '1m' | '3m' | '1y' | 'all';

export const TIME_RANGES: { value: TimeRange; labelKey: string }[] = [
  { value: '7d',  labelKey: 'range7d'  },
  { value: '15d', labelKey: 'range15d' },
  { value: '1m',  labelKey: 'range1m'  },
  { value: '3m',  labelKey: 'range3m'  },
  { value: '1y',  labelKey: 'range1y'  },
  { value: 'all', labelKey: 'rangeAll' },
];

export const DEFAULT_RANGE: TimeRange = '3m';

const VALID_RANGES: TimeRange[] = ['7d', '15d', '1m', '3m', '1y', 'all'];

export function parseRange(raw: string | string[] | undefined): TimeRange {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return VALID_RANGES.includes(value as TimeRange) ? (value as TimeRange) : DEFAULT_RANGE;
}

export function rangeToDate(range: TimeRange): Date | null {
  if (range === 'all') return null;
  switch (range) {
    case '7d': {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return d;
    }
    case '15d': {
      const d = new Date();
      d.setDate(d.getDate() - 15);
      return d;
    }
    case '1m': {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      return d;
    }
    case '3m': {
      const d = new Date();
      d.setMonth(d.getMonth() - 3);
      return d;
    }
    case '1y': {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      return d;
    }
  }
}
