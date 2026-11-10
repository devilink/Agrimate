import { Suspense } from 'react';
import { ListSkeleton } from '@/components/ui';
import { DetailClient } from './detail-client';

export default function OrderDetailPage() {
  return <Suspense fallback={<ListSkeleton />}><DetailClient /></Suspense>;
}
