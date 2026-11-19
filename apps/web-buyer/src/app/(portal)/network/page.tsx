'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { KnowledgeGraphView } from '@agrimate/api-client';
import { Skeleton } from '@agrimate/ui';
import { RangeTabs, VizCard } from '@agrimate/ui/viz';
import { ErrorState } from '@/components/common';
import { api } from '@/lib/api';
import { useResource } from '@/lib/hooks';

const KnowledgeGraph = dynamic(() => import('@agrimate/ui/graph').then((m) => m.KnowledgeGraph), { ssr: false, loading: () => <Skeleton className="h-[600px] w-full" /> });
const RANGES = [{ value: 30, label: '30 days' }, { value: 90, label: '90 days' }, { value: 365, label: '1 year' }];

export default function NetworkPage() {
  const [days, setDays] = useState(90);
  const r = useResource(() => api.get<KnowledgeGraphView>(`/analytics/graph?days=${days}`), [days]);
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">My supply network</h1>
          <p className="text-sm text-slate-500">The farmers, crops and states behind your orders.</p>
        </div>
        <RangeTabs label="Period" value={days} options={RANGES} onChange={setDays} />
      </header>
      {r.error && !r.data && <ErrorState message={r.error} onRetry={() => void r.reload()} />}
      <VizCard title="Who supplies what" description="Bigger shapes carry more value, thicker lines more orders.">
        <div className={r.loading && r.data ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {r.data ? <KnowledgeGraph height={600} nodes={r.data.nodes} links={r.data.links} orderHref={(id) => `/orders/${id}`} /> : !r.error && <Skeleton className="h-[600px] w-full" />}
        </div>
      </VizCard>
    </div>
  );
}
