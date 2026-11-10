import { Suspense } from 'react';
import { ListSkeleton } from '@/components/ui';
import { BidClient } from './bid-client';

export default function BidPage() {
  return <Suspense fallback={<ListSkeleton rows={2} />}><BidClient /></Suspense>;
}
