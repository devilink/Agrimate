import { Field, Select } from '@/components/ui';
import { partyLabel } from '@/lib/data';
import type { Party } from '@/lib/types';

/** Admins acting for a party pick them here. */
export function PartySelect({ parties, label, name = 'party_id', required = true, defaultValue = '' }: {
  parties: Party[]; label: string; name?: string; required?: boolean; defaultValue?: string;
}) {
  return (
    <Field label={label}>
      <Select name={name} required={required} defaultValue={defaultValue}>
        <option value="">{required ? 'Choose…' : 'None'}</option>
        {parties.map((p) => (
          <option key={p.id} value={p.id}>{partyLabel(p)}{p.verified ? '' : ' (unverified)'}{p.user_id ? '' : ' · offline'}</option>
        ))}
      </Select>
    </Field>
  );
}
