import { describe, expect, it } from 'vitest';
import { ALLOWED_DEGREES, checkReadings, checkTransition, DegreeType, findTransition, gstinCheckChar, gstinMatchesPan, GuardContext, haversineMetres, inspectionDay, isValidGstin, isValidPan, maskPhone, namesMatch, ORDER_TRANSITIONS, OrderState, phonesUnlocked, selfCertFallbackAt, slaDeadline, withinRadius, formatINR, istDateString } from '../src';

const ctx = (o: Partial<GuardContext> = {}): GuardContext => ({ advancePaid: true, balancePaid: true, freightPaid: true, logisticsMode: 'PLATFORM', inspected: true, selfCertified: false, podCaptured: true, allDisputesResolved: true, pendingSpotTests: 0, disputeWindowElapsed: true, ...o });

describe('order state machine', () => {
  it('rejects transitions not in the table', () => {
    const r = checkTransition('MATCHED', 'SETTLED', 'ADMIN', ctx());
    expect(r).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
  });
  it('rejects the wrong actor', () => expect(checkTransition('AWAITING_ADVANCE', 'ADVANCE_LOCKED', 'BUYER', ctx())).toMatchObject({ ok: false, code: 'ACTOR_NOT_ALLOWED' }));
  it('cannot depart without the 70% balance', () => expect(checkTransition('INSPECTED', 'IN_TRANSIT', 'LOGISTICS', ctx({ balancePaid: false }))).toMatchObject({ ok: false, code: 'GUARD_FAILED' }));
  it('cannot depart without inspection or self-cert', () => expect(checkTransition('SELF_CERTIFIED', 'IN_TRANSIT', 'FARMER', ctx({ inspected: false, selfCertified: false }))).toMatchObject({ ok: false, code: 'GUARD_FAILED' }));
  it('platform logistics cannot go without freight in escrow', () => {
    expect(checkTransition('LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'SYSTEM', ctx({ freightPaid: false }))).toMatchObject({ ok: false, code: 'GUARD_FAILED' });
    expect(checkTransition('INSPECTED', 'IN_TRANSIT', 'LOGISTICS', ctx({ freightPaid: false }))).toMatchObject({ ok: false, code: 'GUARD_FAILED' });
  });
  it('external logistics need no freight', () => expect(checkTransition('LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'SYSTEM', ctx({ logisticsMode: 'EXTERNAL', freightPaid: false })).ok).toBe(true));
  it('undeclared logistics cannot be secured', () => expect(checkTransition('LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'SYSTEM', ctx({ logisticsMode: null })).ok).toBe(false));
  it('settlement blocked while window open, disputes open or spot test pending', () => {
    expect(checkTransition('DISPUTE_WINDOW', 'SETTLED', 'SYSTEM', ctx({ disputeWindowElapsed: false })).ok).toBe(false);
    expect(checkTransition('DISPUTE_WINDOW', 'SETTLED', 'SYSTEM', ctx({ allDisputesResolved: false })).ok).toBe(false);
    expect(checkTransition('DISPUTE_WINDOW', 'SETTLED', 'SYSTEM', ctx({ pendingSpotTests: 1 })).ok).toBe(false);
  });
  it('no transition may leave a terminal state', () => {
    for (const t of ORDER_TRANSITIONS) expect(['SETTLED', 'REFUNDED', 'CANCELLED']).not.toContain(t.from);
  });
  it('farmer cannot default once produce has left, nor buyer once fully funded', () => {
    expect(findTransition('IN_TRANSIT', 'FARMER_DEFAULTED')).toBeUndefined();
    expect(findTransition('FULLY_FUNDED', 'BUYER_DEFAULTED')).toBeUndefined();
  });
  it('every state is reachable from the table', () => {
    const reached = new Set<string>(['MATCHED']);
    for (let i = 0; i < 30; i++) for (const t of ORDER_TRANSITIONS) if (reached.has(t.from)) reached.add(t.to);
    expect([...reached].sort()).toEqual(Object.values(OrderState).sort());
  });
  it('phones unlock only at MATCHED or later', () => {
    for (const s of ['RFQ_OPEN', 'BIDDING', 'LISTED'] as const) expect(phonesUnlocked(s)).toBe(false);
    for (const s of ['MATCHED', 'AWAITING_ADVANCE', 'SETTLED'] as const) expect(phonesUnlocked(s)).toBe(true);
  });
});

describe('bank-holder vs PAN names', () => {
  it.each([
    ['RAMESH KUMAR SHARMA', 'Ramesh Kumar Sharma'],
    ['Shri Ramesh  Kumar Sharma', 'ramesh kumar sharma'],
    ['Mr. R. K. Sharma', 'Ramesh Kumar Sharma'],
    ['SHARMA RAMESH', 'Ramesh Sharma'],
    ['Smt Anjali Das', 'ANJALI DAS'],
  ])('%s = %s', (a, b) => expect(namesMatch(a, b)).toBe(true));
  it.each([
    ['Ramesh Sharma', 'Suresh Sharma'],
    ['Ramesh Kumar Sharma', 'Ramesh Sharma'],
    ['R K S', 'Ramesh Kumar Sharma'],
    ['', 'Ramesh'],
    ['Mr', 'Mr'],
    ['A Das', 'B Das'],
  ])('%s ≠ %s', (a, b) => expect(namesMatch(a, b)).toBe(false));
});

describe('formats', () => {
  const g14 = '18AABCU9603R1Z';
  it('PAN', () => { expect(isValidPan('ABCDE1234F')).toBe(true); expect(isValidPan('abcde1234f')).toBe(false); });
  it('GSTIN checksum against a known-good number', () => expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true));
  it('GSTIN rejects a bad checksum', () => { const c = gstinCheckChar(g14); expect(isValidGstin(g14 + c)).toBe(true); expect(isValidGstin(g14 + (c === 'A' ? 'B' : 'A'))).toBe(false); });
  it('GSTIN embeds PAN', () => expect(gstinMatchesPan('27AAPFU0939F1ZV', 'AAPFU0939F')).toBe(true));
  it('masks phones', () => expect(maskPhone('+919876543210')).toBe('+91******3210'));
  it('only agriculture degrees are allowed', () => {
    expect(ALLOWED_DEGREES).toEqual([DegreeType.BSC_AGRICULTURE, DegreeType.MSC_AGRICULTURE]);
  });
  it('formatINR does not accept floats', () => expect(() => formatINR(1.5)).toThrow());
});

describe('time', () => {
  // 2026-03-10 10:00 IST = 04:30 UTC
  const t0 = new Date('2026-03-10T04:30:00Z');
  it('SLA deadline is end of day IST', () => {
    expect(slaDeadline(t0, 3).toISOString()).toBe('2026-03-13T18:29:59.999Z');
    expect(slaDeadline(t0, 2).toISOString()).toBe('2026-03-12T18:29:59.999Z');
    expect(slaDeadline(t0, 3, false).toISOString()).toBe('2026-03-13T04:30:00.000Z');
  });
  it('handles the IST date rollover near UTC midnight', () => {
    const late = new Date('2026-03-10T19:00:00Z'); // 00:30 IST on the 11th
    expect(istDateString(late)).toBe('2026-03-11');
    expect(slaDeadline(late, 2).toISOString()).toBe('2026-03-13T18:29:59.999Z');
  });
  it('inspection day and self-cert fallback', () => {
    expect(inspectionDay(t0, 3).toISOString()).toBe('2026-03-12T18:30:00.000Z');
    expect(selfCertFallbackAt(t0, 3).toISOString()).toBe('2026-03-11T18:30:00.000Z');
  });
  it('fallback never fires before T0', () => {
    const lateT0 = new Date('2026-03-10T18:00:00Z');
    expect(selfCertFallbackAt(lateT0, 1).getTime()).toBe(lateT0.getTime());
  });
});

describe('geo', () => {
  it('Guwahati to Jorhat is about 260-ish km by air', () => {
    const d = haversineMetres({ lat: 26.1445, lng: 91.7362 }, { lat: 26.7509, lng: 94.2037 });
    expect(d).toBeGreaterThan(240_000);
    expect(d).toBeLessThan(270_000);
  });
  it('radius', () => {
    const farm = { lat: 26.1445, lng: 91.7362 };
    expect(withinRadius(farm, { lat: 26.1465, lng: 91.7362 }, 500)).toBe(true);
    expect(withinRadius(farm, { lat: 26.16, lng: 91.7362 }, 500)).toBe(false);
  });
});

describe('grade readings', () => {
  const spec = [
    { key: 'moisture', label: 'Moisture', unit: '%', max: 14, required: true },
    { key: 'foreign', label: 'Foreign matter', unit: '%', max: 2, required: true },
    { key: 'count', label: 'Count', unit: '/kg', min: 10, max: 20, required: false },
  ];
  it('passes in spec', () => expect(checkReadings(spec, { moisture: 13, foreign: 1 }).ok).toBe(true));
  it('flags missing', () => expect(checkReadings(spec, { moisture: 13 }).missing).toEqual(['foreign']));
  it('flags out of spec', () => expect(checkReadings(spec, { moisture: 15, foreign: 1, count: 5 }).outOfSpec).toEqual(['moisture', 'count']));
  it('flags unknown keys so free-form data cannot sneak in', () => expect(checkReadings(spec, { moisture: 13, foreign: 1, notes: 1 }).invalid).toEqual(['notes']));
});
