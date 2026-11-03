import { describe, expect, it } from 'vitest';
import { computeFreight, computeSettlement, discrepancyPercent, formatINR, gmvPaise, inspectionFee, mulDivRound, pickVehicleTier, rupees, splitTranches, weightDisputeAllowed, applyBps, tonnesToKg } from '../src';

describe('worked example: 10 t at ₹50/kg', () => {
  const gmv = gmvPaise(10_000, rupees(50));
  const s = computeSettlement({ gmv, commissionBps: 300, inspectionFee: inspectionFee(10_000), inspectionFeeFromFarmer: true, outstandingNegative: 0n });
  it('GMV ₹5,00,000', () => expect(gmv).toBe(rupees(500_000)));
  it('advance ₹1,50,000, balance ₹3,50,000', () => expect(splitTranches(gmv)).toEqual({ advance: rupees(150_000), balance: rupees(350_000) }));
  it('commission ₹15,000', () => expect(s.commission).toBe(rupees(15_000)));
  it('inspection fee ₹3,000', () => expect(s.inspectionFee).toBe(rupees(3_000)));
  it('farmer payout ₹4,82,000', () => expect(s.farmerPayout).toBe(rupees(482_000)));
});

describe('inspection fee tiers', () => {
  it.each([[1.9, 800], [2, 800], [2.5, 1500], [3, 1500], [7, 1500], [7.1, 3000]])('%s t → ₹%s', (t, fee) => {
    expect(inspectionFee(tonnesToKg(t))).toBe(rupees(fee));
  });
  it('honours DB-edited tiers in any order', () => {
    expect(inspectionFee(500, [{ maxKgInclusive: null, feePaise: 9n }, { maxKgInclusive: 1000, feePaise: 1n }])).toBe(1n);
  });
  it('throws if nothing covers the payload', () => expect(() => inspectionFee(5000, [{ maxKgInclusive: 1000, feePaise: 1n }])).toThrow());
});

describe('settlement', () => {
  const base = { gmv: rupees(500_000), commissionBps: 300, inspectionFee: rupees(3000), inspectionFeeFromFarmer: true };
  it('offsets a negative balance from the payout', () => {
    const s = computeSettlement({ ...base, outstandingNegative: rupees(9_000) });
    expect(s.negativeOffset).toBe(rupees(9_000));
    expect(s.negativeRemaining).toBe(0n);
    expect(s.farmerPayout).toBe(rupees(473_000));
  });
  it('carries forward a negative balance bigger than the payout, never paying below zero', () => {
    const s = computeSettlement({ ...base, outstandingNegative: rupees(600_000) });
    expect(s.farmerPayout).toBe(0n);
    expect(s.negativeRemaining).toBe(rupees(600_000) - rupees(482_000));
  });
  it('buyer-paid inspection fee is not deducted from the farmer', () => {
    expect(computeSettlement({ ...base, inspectionFeeFromFarmer: false, outstandingNegative: 0n }).farmerPayout).toBe(rupees(485_000));
  });
  it('charges commission on GMV net of dispute refund', () => {
    const s = computeSettlement({ ...base, outstandingNegative: 0n, buyerRefund: rupees(100_000) });
    expect(s.netGmv).toBe(rupees(400_000));
    expect(s.commission).toBe(rupees(12_000));
    expect(s.farmerPayout).toBe(rupees(385_000));
  });
  it('rejects a refund above GMV', () => expect(() => computeSettlement({ ...base, outstandingNegative: 0n, buyerRefund: rupees(500_001) })).toThrow());
  it('tranches always sum to GMV, even for odd paise', () => {
    for (const g of [1n, 3n, 7n, 99_999n, 123_456_789n]) {
      const { advance, balance } = splitTranches(g);
      expect(advance + balance).toBe(g);
    }
  });
  it('every rupee of GMV is accounted for', () => {
    const s = computeSettlement({ ...base, gmv: 123_456_789n, outstandingNegative: 5_000n });
    expect(s.farmerPayout + s.negativeOffset + s.commission + s.inspectionFee).toBe(123_456_789n);
  });
});

describe('freight', () => {
  const q = computeFreight({ distanceMetres: 200_000, vehicleRatePaisePerKm: rupees(45), loadingFeePaise: rupees(1000), quantityKg: 10_000 });
  it('matches the worked example', () => {
    expect(q.baseCostPaise).toBe(rupees(10_000));
    expect(q.finalFreightPaise).toBe(rupees(10_800));
    expect(q.markupPaise).toBe(rupees(800));
    expect(q.displayPtkmPaise).toBe(540n);
    expect(q.distanceKm).toBe(200);
    expect(q.tonnes).toBe(10);
  });
  it('handles fractional km exactly', () => {
    const f = computeFreight({ distanceMetres: 123_456, vehicleRatePaisePerKm: 4500n, loadingFeePaise: 0n, quantityKg: 1000 });
    expect(f.haulagePaise).toBe(555_552n);
    expect(f.baseCostPaise + f.markupPaise).toBe(f.finalFreightPaise);
  });
  it('rejects zero distance', () => expect(() => computeFreight({ distanceMetres: 0, vehicleRatePaisePerKm: 1n, loadingFeePaise: 0n, quantityKg: 1 })).toThrow());
  it('picks the smallest tier that fits', () => {
    const tiers = [{ id: 'big', minKg: 8000, maxKg: 16000, ratePaisePerKm: 3n }, { id: 'lcv', minKg: 3000, maxKg: 7000, ratePaisePerKm: 2n }, { id: 'pick', minKg: 0, maxKg: 2000, ratePaisePerKm: 1n }];
    expect(pickVehicleTier(2000, tiers).id).toBe('pick');
    expect(pickVehicleTier(2500, tiers).id).toBe('lcv');
    expect(pickVehicleTier(7500, tiers).id).toBe('big');
    expect(() => pickVehicleTier(99_000, tiers)).toThrow();
  });
});

describe('shrinkage guard', () => {
  it('blocks at exactly 2.5%', () => expect(weightDisputeAllowed(10_000, 9_750)).toBe(false));
  it('allows at 2.6%', () => expect(weightDisputeAllowed(10_000, 9_740)).toBe(true));
  it('blocks below tolerance and on overweight', () => { expect(weightDisputeAllowed(10_000, 9_900)).toBe(false); expect(weightDisputeAllowed(10_000, 10_100)).toBe(false); });
  it('uses exact arithmetic where float maths would misjudge', () => { expect(weightDisputeAllowed(1000, 975)).toBe(false); expect(weightDisputeAllowed(1000, 974)).toBe(true); });
  it('reports the discrepancy', () => expect(discrepancyPercent(10_000, 9_740)).toBe(2.6));
});

describe('money', () => {
  it('formats Indian grouping', () => {
    expect(formatINR(rupees(150_000))).toBe('₹1,50,000');
    expect(formatINR(rupees(100))).toBe('₹100');
    expect(formatINR(rupees(1_000))).toBe('₹1,000');
    expect(formatINR(rupees(12_345_678))).toBe('₹1,23,45,678');
    expect(formatINR(150n)).toBe('₹1.50');
    expect(formatINR(-rupees(800))).toBe('-₹800');
    expect(formatINR('50000000')).toBe('₹5,00,000');
  });
  it('rounds half-up', () => { expect(mulDivRound(5n, 1n, 10n)).toBe(1n); expect(mulDivRound(4n, 1n, 10n)).toBe(0n); expect(mulDivRound(-5n, 1n, 10n)).toBe(-1n); });
  it('bps', () => expect(applyBps(rupees(500_000), 300)).toBe(rupees(15_000)));
});
