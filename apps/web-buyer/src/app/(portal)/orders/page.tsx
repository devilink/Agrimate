'use client';
import type { OrderListItem } from '@agrimate/api-client';
import { OrderState } from '@agrimate/shared';
import { Button, EmptyState, Field, humanise, Select } from '@agrimate/ui';
import { useState } from 'react';
import { ErrorState, PageHeader, TableSkeleton } from '@/components/common';
import { HISTORY_HEAD, OrderHistoryTable } from '@/components/orders-table';
import { api } from '@/lib/api';
import { useResource } from '@/lib/hooks';

export default function OrdersPage() {
  const [state, setState] = useState('');
  const orders = useResource(() => api.get<OrderListItem[]>(`/orders${state ? `?state=${state}` : ''}`), [state]);

  return (
    <>
      <PageHeader title="Orders" description="Every order you have placed, newest first." />
      <div className="mb-4 max-w-xs">
        <Field label="State">
          <Select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            {Object.values(OrderState).map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
          </Select>
        </Field>
      </div>
      {orders.error && <div className="mb-4"><ErrorState message={orders.error} onRetry={() => void orders.reload()} /></div>}
      {orders.loading && !orders.data && <TableSkeleton head={HISTORY_HEAD} />}
      {orders.data?.length === 0 && (
        <EmptyState title={state ? 'No orders in this state' : 'No orders yet'}>
          {state ? <Button variant="secondary" size="sm" onClick={() => setState('')}>Show all orders</Button> : 'Orders appear here after you accept a bid or a catalog listing.'}
        </EmptyState>
      )}
      {!!orders.data?.length && <div className={orders.loading ? 'opacity-60' : undefined}><OrderHistoryTable orders={orders.data} /></div>}
    </>
  );
}
