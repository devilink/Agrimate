'use client';

import { useState } from 'react';
import { Field, Select } from '@/components/ui';
import type { Commodity } from '@/lib/types';

/** Commodity picker whose grade list follows the chosen commodity. */
export function CommodityFields({ commodities }: { commodities: Commodity[] }) {
  const [id, setId] = useState('');
  const grades = commodities.find((c) => c.id === id)?.grades ?? [];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Commodity">
        <Select name="commodity_id" required value={id} onChange={(e) => setId(e.target.value)}>
          <option value="" disabled>Choose…</option>
          {commodities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Grade / variety">
        <Select name="grade" defaultValue="" key={id} disabled={grades.length === 0}>
          <option value="">{grades.length ? 'Any / not graded' : '—'}</option>
          {grades.map((g) => <option key={g} value={g}>{g}</option>)}
        </Select>
      </Field>
    </div>
  );
}
