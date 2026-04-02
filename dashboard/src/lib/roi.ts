export const OVERALL_BANKROLL = 1000;
export const OVERALL_STAKE = 100;
export const CONVICTION_BANKROLL = 1000;
export const CONVICTION_STAKE = 250;

export interface RoiEvent {
  won: boolean;
  odds: number; // decimal odds, e.g. 1.75
}

export interface RoiResult {
  pnl: number;
  roi: number; // percentage, e.g. 210 means +210%
  totalStaked: number;
  totalReturned: number;
  eventCount: number;
}

/** Overall ROI: flat OVERALL_STAKE per event, bankroll = OVERALL_BANKROLL */
export function calcOverallRoi(events: RoiEvent[]): RoiResult | null {
  if (events.length === 0) return null;
  const totalStaked = events.length * OVERALL_STAKE;
  const totalReturned = events.reduce((sum, e) => {
    return e.won ? sum + OVERALL_STAKE * e.odds : sum;
  }, 0);
  const pnl = totalReturned - totalStaked;
  const roi = (pnl / OVERALL_BANKROLL) * 100;
  return { pnl, roi, totalStaked, totalReturned, eventCount: events.length };
}

/** Conviction ROI: flat CONVICTION_STAKE per event, bankroll = CONVICTION_BANKROLL */
export function calcConvictionRoi(events: RoiEvent[]): RoiResult | null {
  if (events.length === 0) return null;
  const totalStaked = events.length * CONVICTION_STAKE;
  const totalReturned = events.reduce((sum, e) => {
    return e.won ? sum + CONVICTION_STAKE * e.odds : sum;
  }, 0);
  const pnl = totalReturned - totalStaked;
  const roi = (pnl / CONVICTION_BANKROLL) * 100;
  return { pnl, roi, totalStaked, totalReturned, eventCount: events.length };
}
