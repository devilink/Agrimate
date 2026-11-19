'use client';
import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { KnowledgeGraphView } from '@agrimate/api-client';
import { Alert, Skeleton } from '@agrimate/ui';
import { RangeTabs, VizCard } from '@agrimate/ui/viz';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { ErrorState } from '@/components/console';

const KnowledgeGraph = dynamic(() => import('@agrimate/ui/graph').then((m) => m.KnowledgeGraph), { ssr: false, loading: () => <Skeleton className="h-[640px] w-full" /> });
const RANGES = [{ value: 30, label: '30 days' }, { value: 90, label: '90 days' }, { value: 365, label: '1 year' }];

export default function NetworkPage() {
  const [days, setDays] = useState(90);
  const graph = useLoad(() => api.get<KnowledgeGraphView>(`/analytics/graph?days=${days}`), [days]);
  const last = useRef<KnowledgeGraphView | undefined>(undefined);
  if (graph.data) last.current = graph.data;
  const g = last.current;
  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Trade network</h1>
          <p className="text-sm text-slate-500">Buyers, farmers, crops, states, inspectors and transporters, and how they connect.</p>
        </div>
        <RangeTabs label="Period" value={days} options={RANGES} onChange={setDays} />
      </header>
      {graph.error != null && !g && <ErrorState title="The network could not be loaded" error={graph.error} onRetry={() => void graph.reload()} />}
      {g && (g.hiddenNodes > 0 || g.truncatedOrders) && <Alert tone="blue">Showing the largest {g.nodes.length} names{g.truncatedOrders ? ', from the 400 most recent orders' : ''}. {g.hiddenNodes > 0 ? `${g.hiddenNodes} smaller names are left out.` : ''}</Alert>}
      <VizCard title="Who trades what with whom" description="Bigger shapes carry more value, thicker lines more orders.">
        <div className={graph.loading && g ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {g ? <KnowledgeGraph height={640} nodes={g.nodes} links={g.links} orderHref={(id) => `/orders/${id}`} /> : !graph.error && <Skeleton className="h-[640px] w-full" />}
        </div>
      </VizCard>
    </div>
  );
}
