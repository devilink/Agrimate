/**
 * Master data shared by the seed script and the test suite. Idempotent.
 * Grade specs and vehicle rates are plausible PLACEHOLDERS, marked needs_domain_review in DECISIONS.md.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_INSPECTION_TIERS, GradeParameter } from '@agrimate/shared';

const p = (key: string, label: string, unit: string, bounds: { min?: number; max?: number }, required = true): GradeParameter => ({ key, label, unit, required, ...bounds });
const moisture = (max: number) => p('moisture', 'Moisture', '%', { max });
const foreign = (max: number) => p('foreignMatter', 'Foreign matter', '%', { max });
const damaged = (max: number) => p('damaged', 'Damaged / discoloured', '%', { max });

export const COMMODITIES: { code: string; name: string; names: Record<string, string>; grades: { code: string; name: string; parameters: GradeParameter[] }[] }[] = [
  { code: 'PADDY', name: 'Paddy', names: { hi: 'धान', as: 'ধান', bn: 'ধান' }, grades: [
    { code: 'A', name: 'Grade A', parameters: [moisture(14), foreign(1), damaged(3)] },
    { code: 'FAQ', name: 'FAQ', parameters: [moisture(17), foreign(2), damaged(5)] } ] },
  { code: 'RICE', name: 'Rice', names: { hi: 'चावल', as: 'চাউল', bn: 'চাল' }, grades: [
    { code: 'A', name: 'Grade A', parameters: [moisture(13), p('brokens', 'Brokens', '%', { max: 5 }), foreign(0.5)] },
    { code: 'B', name: 'Grade B', parameters: [moisture(14), p('brokens', 'Brokens', '%', { max: 25 }), foreign(1)] } ] },
  { code: 'POTATO', name: 'Potato', names: { hi: 'आलू', as: 'আলু', bn: 'আলু' }, grades: [
    { code: 'LARGE', name: 'Large (>55 mm)', parameters: [p('size', 'Tuber size', 'mm', { min: 55 }), damaged(3), p('greening', 'Greening', '%', { max: 2 })] },
    { code: 'MEDIUM', name: 'Medium (35-55 mm)', parameters: [p('size', 'Tuber size', 'mm', { min: 35, max: 55 }), damaged(5), p('greening', 'Greening', '%', { max: 3 })] } ] },
  { code: 'ONION', name: 'Onion', names: { hi: 'प्याज', as: 'পিঁয়াজ', bn: 'পেঁয়াজ' }, grades: [
    { code: 'A', name: 'Grade A (>55 mm)', parameters: [p('size', 'Bulb size', 'mm', { min: 55 }), damaged(3), p('sprouting', 'Sprouting', '%', { max: 2 })] },
    { code: 'B', name: 'Grade B (40-55 mm)', parameters: [p('size', 'Bulb size', 'mm', { min: 40, max: 55 }), damaged(5), p('sprouting', 'Sprouting', '%', { max: 5 })] } ] },
  { code: 'TEA_LEAF', name: 'Green Tea Leaf', names: { hi: 'हरी चाय पत्ती', as: 'সেউজীয়া চাহ পাত', bn: 'সবুজ চা পাতা' }, grades: [
    { code: 'FINE', name: 'Fine plucking', parameters: [p('fineLeaf', 'Fine leaf count', '%', { min: 65 }), p('coarseLeaf', 'Coarse leaf', '%', { max: 15 }), p('hoursSincePlucking', 'Hours since plucking', 'h', { max: 8 })] },
    { code: 'MEDIUM', name: 'Medium plucking', parameters: [p('fineLeaf', 'Fine leaf count', '%', { min: 45 }), p('coarseLeaf', 'Coarse leaf', '%', { max: 30 }), p('hoursSincePlucking', 'Hours since plucking', 'h', { max: 10 })] } ] },
  { code: 'GINGER', name: 'Ginger', names: { hi: 'अदरक', as: 'আদা', bn: 'আদা' }, grades: [
    { code: 'A', name: 'Grade A', parameters: [moisture(85), foreign(1), p('fibre', 'Fibre', '%', { max: 6 })] } ] },
  { code: 'TURMERIC', name: 'Turmeric', names: { hi: 'हल्दी', as: 'হালধি', bn: 'হলুদ' }, grades: [
    { code: 'A', name: 'Finger, polished', parameters: [moisture(12), p('curcumin', 'Curcumin', '%', { min: 3 }), foreign(1)] } ] },
  { code: 'MAIZE', name: 'Maize', names: { hi: 'मक्का', as: 'মাকৈ', bn: 'ভুট্টা' }, grades: [
    { code: 'A', name: 'Feed grade A', parameters: [moisture(14), foreign(1), damaged(3), p('aflatoxin', 'Aflatoxin', 'ppb', { max: 20 })] } ] },
  { code: 'MUSTARD', name: 'Mustard Seed', names: { hi: 'सरसों', as: 'সৰিয়হ', bn: 'সরিষা' }, grades: [
    { code: 'A', name: 'FAQ', parameters: [moisture(8), foreign(2), p('oilContent', 'Oil content', '%', { min: 38 })] } ] },
];

// Real Indian PINs, with approximate town-centre coordinates.
export const PINS: [string, string, string, number, number][] = [
  ['781001', 'Kamrup Metropolitan', 'Assam', 26.1833, 91.75], ['782001', 'Nagaon', 'Assam', 26.348, 92.684], ['785001', 'Jorhat', 'Assam', 26.7509, 94.2037], ['786001', 'Dibrugarh', 'Assam', 27.4728, 94.912],
  ['700001', 'Kolkata', 'West Bengal', 22.5726, 88.3639], ['713101', 'Purba Bardhaman', 'West Bengal', 23.2324, 87.8615], ['734001', 'Darjeeling', 'West Bengal', 26.7271, 88.3953], ['712101', 'Hooghly', 'West Bengal', 22.9, 88.39],
  ['400001', 'Mumbai', 'Maharashtra', 18.9388, 72.8354], ['411001', 'Pune', 'Maharashtra', 18.5204, 73.8567], ['422001', 'Nashik', 'Maharashtra', 19.9975, 73.7898], ['422306', 'Nashik', 'Maharashtra', 20.15, 74.2333],
  ['141001', 'Ludhiana', 'Punjab', 30.901, 75.8573], ['143001', 'Amritsar', 'Punjab', 31.634, 74.8723], ['147001', 'Patiala', 'Punjab', 30.3398, 76.3869],
];

export const CONTRACT_V1 = `Agrimate Trade Terms v1.0
1. ESCROW. Crediting the 30% advance to the order's virtual account legally binds this contract. All funds are held through an RBI-authorised payment aggregator. The balance 70% must reach escrow before dispatch.
2. SLA. RFQ orders: 3 days from advance credit. Catalog orders: 2 days. Deadline is the end of that day, IST.
3. QUALITY. Produce must meet the selected grade specification. An Agri-Inspector verifies it, or, when none is available, the farmer self-certifies with unedited in-app geo-tagged video, and this is shown clearly to the buyer.
4. TRANSIT SHRINKAGE. A natural moisture weight loss of up to 2.5% of dispatched weight is accepted. No weight dispute may be raised at or below 2.5%.
5. ORGANIC. Produce sold as organic must carry a verified, unexpired certificate. The buyer has the right to spot pesticide testing on delivery.
6. NO CO-LOADING. Carrying any other commercial goods with agricultural produce is strictly prohibited because of chemical contamination risk.
7. DEFAULT. If the farmer fails to deliver, the buyer is refunded 100% of everything paid into escrow, and the gateway processing fee is recorded against the farmer and recovered from future payouts.
8. FEES. Platform commission of 3% of GMV and a tiered inspection fee are deducted from the farmer's settlement. Freight carries a disclosed 8% platform markup.
This version requires legal review before production use.`;

export async function seedMasters(prisma: PrismaClient) {
  for (const c of COMMODITIES) {
    const row = await prisma.commodity.upsert({ where: { code: c.code }, create: { code: c.code, name: c.name, names: c.names }, update: { name: c.name, names: c.names } });
    for (const g of c.grades) {
      const parameters = g.parameters as unknown as Prisma.InputJsonValue;
      await prisma.grade.upsert({ where: { commodityId_code: { commodityId: row.id, code: g.code } }, create: { commodityId: row.id, code: g.code, name: g.name, parameters }, update: { name: g.name, parameters } });
    }
  }
  const tiers = [
    { code: 'PICKUP', name: 'Pickup (up to 2 t)', minKg: 0, maxKg: 2000, ratePaisePerKm: 2800n },
    { code: 'LCV', name: 'LCV (3-7 t)', minKg: 2001, maxKg: 7000, ratePaisePerKm: 3800n },
    { code: 'TEN_WHEELER', name: '10-wheeler (8-16 t)', minKg: 7001, maxKg: 16000, ratePaisePerKm: 5500n },
    { code: 'TWELVE_WHEELER', name: '12/14-wheeler (17-25 t)', minKg: 16001, maxKg: 25000, ratePaisePerKm: 7000n },
  ];
  for (const t of tiers) await prisma.vehicleTier.upsert({ where: { code: t.code }, create: t, update: {} });
  if (!(await prisma.inspectionFeeTier.count())) await prisma.inspectionFeeTier.createMany({ data: DEFAULT_INSPECTION_TIERS });
  await prisma.pinCode.createMany({ data: PINS.map(([pin, district, state, lat, lng]) => ({ pin, district, state, lat, lng })), skipDuplicates: true });
  await prisma.contractTerms.upsert({ where: { version: '1.0' }, create: { version: '1.0', body: CONTRACT_V1, active: true }, update: {} });
}
