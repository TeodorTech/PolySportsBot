import { describe, it, expect } from 'vitest';
import {
  calcOverallRoi,
  calcConvictionRoi,
  OVERALL_BANKROLL,
  OVERALL_STAKE,
  CONVICTION_BANKROLL,
  CONVICTION_STAKE,
} from '../roi';

describe('calcOverallRoi', () => {
  it('returns null for empty events', () => {
    expect(calcOverallRoi([])).toBeNull();
  });

  it('single win: pnl = stake * odds - stake, roi = pnl / bankroll * 100', () => {
    const result = calcOverallRoi([{ won: true, odds: 2.0 }]);
    // staked: 100, returned: 200, pnl: 100, roi: 100/1000*100 = 10%
    expect(result).not.toBeNull();
    expect(result!.totalStaked).toBe(OVERALL_STAKE * 1);
    expect(result!.totalReturned).toBe(OVERALL_STAKE * 2.0);
    expect(result!.pnl).toBeCloseTo(100);
    expect(result!.roi).toBeCloseTo(10);
  });

  it('single loss: pnl = -stake, roi negative', () => {
    const result = calcOverallRoi([{ won: false, odds: 1.75 }]);
    expect(result!.totalReturned).toBe(0);
    expect(result!.pnl).toBe(-OVERALL_STAKE);
    expect(result!.roi).toBeCloseTo(-10); // -100/1000*100
  });

  it('all losses', () => {
    const events = Array(5).fill({ won: false, odds: 1.5 });
    const result = calcOverallRoi(events);
    expect(result!.pnl).toBe(-OVERALL_STAKE * 5);
    expect(result!.roi).toBeCloseTo(-50);
  });

  it('all wins at odds 2.0 → 100% roi per win, 10 events = 100% roi', () => {
    const events = Array(10).fill({ won: true, odds: 2.0 });
    const result = calcOverallRoi(events);
    // staked: 1000, returned: 2000, pnl: 1000, roi: 1000/1000*100 = 100%
    expect(result!.pnl).toBeCloseTo(1000);
    expect(result!.roi).toBeCloseTo(100);
  });

  it('mixed: 3W 1L at odds 1.5', () => {
    const events = [
      { won: true, odds: 1.5 },
      { won: true, odds: 1.5 },
      { won: true, odds: 1.5 },
      { won: false, odds: 1.5 },
    ];
    const result = calcOverallRoi(events);
    // staked: 400, returned: 3*100*1.5=450, pnl: 50, roi: 50/1000*100=5%
    expect(result!.totalStaked).toBe(400);
    expect(result!.totalReturned).toBeCloseTo(450);
    expect(result!.pnl).toBeCloseTo(50);
    expect(result!.roi).toBeCloseTo(5);
  });

  it('roi is relative to fixed bankroll, not totalStaked', () => {
    // With 20 events at odds 2.0 all wins: staked=2000, pnl=2000
    // roi should be 2000/1000*100 = 200%, not 100%
    const events = Array(20).fill({ won: true, odds: 2.0 });
    const result = calcOverallRoi(events);
    expect(result!.roi).toBeCloseTo(200);
    expect(result!.roi).not.toBeCloseTo(100); // NOT totalStaked-relative
  });
});

describe('calcConvictionRoi', () => {
  it('returns null for empty events', () => {
    expect(calcConvictionRoi([])).toBeNull();
  });

  it('uses CONVICTION_STAKE and CONVICTION_BANKROLL constants', () => {
    expect(CONVICTION_STAKE).toBe(250);
    expect(CONVICTION_BANKROLL).toBe(1000);
  });

  it('single win: stake=250, odds=2.0 → pnl=250, roi=25%', () => {
    const result = calcConvictionRoi([{ won: true, odds: 2.0 }]);
    expect(result!.totalStaked).toBe(250);
    expect(result!.totalReturned).toBeCloseTo(500);
    expect(result!.pnl).toBeCloseTo(250);
    expect(result!.roi).toBeCloseTo(25);
  });

  it('single loss: pnl=-250, roi=-25%', () => {
    const result = calcConvictionRoi([{ won: false, odds: 1.75 }]);
    expect(result!.pnl).toBe(-250);
    expect(result!.roi).toBeCloseTo(-25);
  });

  /**
   * Real-world verification:
   * 13W / 1L, avg odds ≈ 1.723
   * staked = 14 * 250 = 3500
   * returned = 13 * 250 * 1.723 ≈ 5600
   * pnl ≈ 2100
   * roi = 2100 / 1000 * 100 = 210%
   */
  it('13W 1L at avg odds 1.723 → ~+210% roi', () => {
    const avgOdds = 1.723;
    const events = [
      ...Array(13).fill({ won: true, odds: avgOdds }),
      { won: false, odds: avgOdds },
    ];
    const result = calcConvictionRoi(events);
    expect(result!.eventCount).toBe(14);
    expect(result!.totalStaked).toBe(3500);
    // returned = 13 * 250 * 1.723 = 5599.75
    expect(result!.totalReturned).toBeCloseTo(13 * 250 * avgOdds, 1);
    // pnl ≈ 2100
    expect(result!.pnl).toBeCloseTo(2099.75, 0);
    // roi ≈ 210%
    expect(result!.roi).toBeCloseTo(210, 0);
  });

  it('roi denominator is fixed bankroll 1000, not totalStaked', () => {
    // 5 events all wins at odds 2.0
    // staked=1250, pnl=1250, roi=1250/1000*100=125%, not 100% (staked-relative)
    const events = Array(5).fill({ won: true, odds: 2.0 });
    const result = calcConvictionRoi(events);
    expect(result!.roi).toBeCloseTo(125);
    expect(result!.roi).not.toBeCloseTo(100);
  });

  it('breakeven: odds=1.0 all wins → pnl=0, roi=0%', () => {
    const events = Array(4).fill({ won: true, odds: 1.0 });
    const result = calcConvictionRoi(events);
    expect(result!.pnl).toBeCloseTo(0);
    expect(result!.roi).toBeCloseTo(0);
  });
});
