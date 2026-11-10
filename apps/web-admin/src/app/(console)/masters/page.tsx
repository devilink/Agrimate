'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, Tabs } from '@/components/console';
import { Commodities } from '@/components/masters/commodities';
import { ConfigEditor } from '@/components/masters/config';
import { ContractEditor } from '@/components/masters/contract';
import { InspectionTiers, VehicleTiers } from '@/components/masters/tiers';

type Tab = 'commodities' | 'vehicles' | 'inspection' | 'config' | 'contract';
const TABS: { key: Tab; label: string }[] = [
  { key: 'commodities', label: 'Commodities and grades' }, { key: 'vehicles', label: 'Vehicle tier rates' }, { key: 'inspection', label: 'Inspection fee tiers' }, { key: 'config', label: 'Platform config' }, { key: 'contract', label: 'Contract terms' },
];

export default function MastersPage() {
  const router = useRouter();
  const p = useSearchParams().get('tab');
  const tab = (TABS.some((t) => t.key === p) ? p : 'commodities') as Tab;
  return (
    <>
      <PageHeader title="Masters" description="Reference data and platform settings. Every change is audited." />
      <Tabs label="Master data" value={tab} onChange={(k) => router.replace(`/masters?tab=${k}`)} items={TABS} />
      {tab === 'commodities' && <Commodities />}
      {tab === 'vehicles' && <VehicleTiers />}
      {tab === 'inspection' && <InspectionTiers />}
      {tab === 'config' && <ConfigEditor />}
      {tab === 'contract' && <ContractEditor />}
    </>
  );
}
