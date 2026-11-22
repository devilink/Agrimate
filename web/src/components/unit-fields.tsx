import { Field, Input, Select, cx } from '@/components/ui';
import { UNITS, type Unit } from '@/lib/units';

// Inputs that let people type a quantity or price in kg, quintals or tonnes. The server converts to kg and paise
// per kg (see quantityKg / pricePerKg in actions/market.ts). Plain form controls, so they work without JavaScript.

function UnitSelect({ name, defaultUnit, per }: { name: string; defaultUnit: Unit; per?: boolean }) {
  return (
    <Select name={name} defaultValue={defaultUnit} aria-label="Unit" className="w-[6.5rem] shrink-0">
      {UNITS.map((u) => <option key={u.id} value={u.id}>{per ? `/ ${u.short}` : u.short}</option>)}
    </Select>
  );
}

export function QuantityField({ name = 'quantity', label, hint, defaultKg, required = true, className }: {
  name?: string; label: string; hint?: string; defaultKg?: number | null; required?: boolean; className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <span className="flex gap-2">
        <Input name={name} inputMode="decimal" required={required} defaultValue={defaultKg ?? ''} placeholder="0" />
        <UnitSelect name={`${name}_unit`} defaultUnit="kg" />
      </span>
    </Field>
  );
}

export function PriceField({ name = 'price', label, hint, defaultPaisePerKg, required = true, unit = 'kg', className }: {
  name?: string; label: string; hint?: string; defaultPaisePerKg?: number | null; required?: boolean; unit?: Unit; className?: string;
}) {
  const factor = UNITS.find((u) => u.id === unit)!.kg;
  const value = defaultPaisePerKg ? (Number(defaultPaisePerKg) * factor) / 100 : '';
  return (
    <Field label={label} hint={hint} className={className}>
      <span className="flex gap-2">
        <span className="relative w-full">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-stone-400">₹</span>
          <Input name={name} inputMode="decimal" required={required} defaultValue={value} placeholder="0.00" className={cx('pl-7')} />
        </span>
        <UnitSelect name={`${name}_unit`} defaultUnit={unit} per />
      </span>
    </Field>
  );
}
